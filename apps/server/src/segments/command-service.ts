import type { SegmentDefinition, SegmentFilter } from "@openengage/core/segments";
import type { WorkspaceContext } from "@openengage/core/shared";
import type { OpenEngageDatabase } from "@openengage/database/client";
import { writeAuditLog } from "@openengage/database/platform";
import { ProjectBriefLinkConflictError } from "@openengage/database/projects";
import { SegmentRepository } from "@openengage/database/segments";
import { isUniqueConstraintError } from "@openengage/database/shared";

import {
  resolveCommandBrief,
  type CommandBriefReference,
  type CommandBriefResolution,
} from "../projects/brief-resolution";
import { availableSlug } from "../workspaces/slug-service";
import { refreshSegmentMemberships } from "./membership-service";
import { validateSegmentFilter } from "./validation-service";

const SEGMENT_SLUG_UNIQUE_COLUMNS = ["segments.workspace_id", "segments.slug"] as const;

export type SegmentCreateInput = CommandBriefReference & {
  name: string;
  slug?: string | undefined;
  description: string;
  kind: "static" | "dynamic";
  filter?: SegmentFilter | undefined;
  membershipSource?: string | null | undefined;
};

export type SegmentUpdateInput = SegmentDefinition & { id: string };

interface SegmentCommandRepositoryPort {
  isSlugAvailable(slug: string): Promise<boolean>;
  createSegment(input: {
    name: string;
    slug: string;
    description: string;
    kind: "static" | "dynamic";
    filter?: SegmentFilter | undefined;
    membershipSource?: string | null | undefined;
    projectLink?: { projectId: string; briefRevision: number; addedByUserId: string } | undefined;
  }): Promise<{ id: string; createdAt: string; updatedAt: string }>;
  updateSegment(
    id: string,
    input: {
      name: string;
      slug: string;
      description: string;
      kind: "static" | "dynamic";
      filter?: SegmentFilter | undefined;
      membershipSource?: string | null | undefined;
    },
  ): Promise<{ filterVersion: number } | null>;
  findSegmentDefinition(
    id: string,
  ): Promise<{ kind: "static" | "dynamic"; filterVersion: number } | null>;
  setEvaluationState(
    id: string,
    state: "pending",
    error: null,
    expected: { kind: "dynamic"; filterVersion: number },
  ): Promise<unknown>;
}

type SegmentAuditAction = "segment.create" | "segment.update" | "segment.refresh";

export interface SegmentCommandPorts {
  repository: SegmentCommandRepositoryPort;
  validateFilter(filter: SegmentFilter): Promise<{ valid: boolean }>;
  resolveBrief(reference: CommandBriefReference): Promise<CommandBriefResolution>;
  nextAvailableSlug(name: string, isAvailable: (slug: string) => Promise<boolean>): Promise<string>;
  classifyWriteError(error: unknown): "brief_conflict" | "slug_conflict" | undefined;
  refreshMemberships(segmentId: string, filterVersion: number): Promise<void>;
  enqueueRefresh(input: {
    workspaceId: string;
    segmentId: string;
    filterVersion: number;
  }): Promise<void>;
  writeAudit(input: {
    action: SegmentAuditAction;
    resourceType: "segment";
    resourceId: string;
  }): Promise<void>;
  defer(promise: Promise<unknown>): void;
}

type BriefFailure = Exclude<CommandBriefResolution, { kind: "ok" }>;

export type SegmentCreateOutcome =
  | BriefFailure
  | { kind: "filter_required" }
  | { kind: "invalid_segment_filter" }
  | { kind: "segment_conflict"; cause: unknown }
  | {
      kind: "ok";
      segment: {
        id: string;
        name: string;
        slug: string;
        kind: "static" | "dynamic";
        createdAt: string;
        updatedAt: string;
      };
    };

export type SegmentUpdateOutcome =
  | { kind: "invalid_segment_filter" }
  | { kind: "segment_conflict"; cause: unknown }
  | { kind: "segment_not_found" }
  | { kind: "ok"; segment: { filterVersion: number } };

export type SegmentRefreshOutcome = { kind: "segment_not_found" } | { kind: "ok" };

export class SegmentCommandService {
  public constructor(
    private readonly workspace: Pick<WorkspaceContext, "workspaceId" | "userId">,
    private readonly ports: SegmentCommandPorts,
  ) {}

  public async create(input: SegmentCreateInput): Promise<SegmentCreateOutcome> {
    if (input.kind === "dynamic" && !input.filter) return { kind: "filter_required" };
    if (input.kind === "dynamic" && input.filter) {
      const validation = await this.ports.validateFilter(input.filter);
      if (!validation.valid) return { kind: "invalid_segment_filter" };
    }

    const brief = await this.ports.resolveBrief({
      projectId: input.projectId,
      briefRevision: input.briefRevision,
    });
    if (brief.kind !== "ok") return brief;

    const { projectId: _projectId, briefRevision: _briefRevision, ...definition } = input;
    let slug =
      input.slug ??
      (await this.ports.nextAvailableSlug(input.name, (candidate) =>
        this.ports.repository.isSlugAvailable(candidate),
      ));
    let created: Awaited<ReturnType<SegmentCommandRepositoryPort["createSegment"]>>;

    for (;;) {
      try {
        created = await this.ports.repository.createSegment({
          ...definition,
          slug,
          membershipSource:
            input.kind === "static" ? (input.membershipSource ?? "Manual selection") : null,
          ...(brief.brief
            ? {
                projectLink: {
                  projectId: brief.brief.projectId,
                  briefRevision: brief.brief.revision,
                  addedByUserId: this.workspace.userId,
                },
              }
            : {}),
        });
        break;
      } catch (error) {
        const classification = this.ports.classifyWriteError(error);
        if (classification === "brief_conflict") return { kind: "brief_revision_conflict" };
        if (classification !== "slug_conflict") throw error;
        if (input.slug) return { kind: "segment_conflict", cause: error };
        slug = await this.ports.nextAvailableSlug(input.name, (candidate) =>
          this.ports.repository.isSlugAvailable(candidate),
        );
      }
    }

    if (input.kind === "dynamic") await this.ports.refreshMemberships(created.id, 1);
    if (!brief.brief) this.audit("segment.create", created.id);
    return {
      kind: "ok",
      segment: {
        id: created.id,
        name: input.name,
        slug,
        kind: input.kind,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      },
    };
  }

  public async update(input: SegmentUpdateInput): Promise<SegmentUpdateOutcome> {
    if (input.kind === "dynamic" && input.filter) {
      const validation = await this.ports.validateFilter(input.filter);
      if (!validation.valid) return { kind: "invalid_segment_filter" };
    }
    const { id, filter, ...definition } = input;
    let updated: { filterVersion: number } | null;
    try {
      updated = await this.ports.repository.updateSegment(id, {
        ...definition,
        ...(filter ? { filter } : {}),
      });
    } catch (error) {
      if (this.ports.classifyWriteError(error) === "slug_conflict") {
        return { kind: "segment_conflict", cause: error };
      }
      throw error;
    }
    if (!updated) return { kind: "segment_not_found" };
    if (input.kind === "dynamic") {
      await this.ports.enqueueRefresh({
        workspaceId: this.workspace.workspaceId,
        segmentId: id,
        filterVersion: updated.filterVersion,
      });
    }
    this.audit("segment.update", id);
    return { kind: "ok", segment: updated };
  }

  public async refresh(id: string): Promise<SegmentRefreshOutcome> {
    const definition = await this.ports.repository.findSegmentDefinition(id);
    if (!definition) return { kind: "segment_not_found" };
    if (definition.kind === "dynamic") {
      await this.ports.repository.setEvaluationState(id, "pending", null, {
        kind: "dynamic",
        filterVersion: definition.filterVersion,
      });
    }
    await this.ports.enqueueRefresh({
      workspaceId: this.workspace.workspaceId,
      segmentId: id,
      filterVersion: definition.filterVersion,
    });
    this.audit("segment.refresh", id);
    return { kind: "ok" };
  }

  private audit(action: SegmentAuditAction, resourceId: string): void {
    this.ports.defer(this.ports.writeAudit({ action, resourceType: "segment", resourceId }));
  }
}

export function createSegmentCommandService(input: {
  database: OpenEngageDatabase;
  workspace: WorkspaceContext;
  queue: {
    send(message: {
      kind: "segment_full_refresh";
      workspaceId: string;
      segmentId: string;
      filterVersion: number;
    }): Promise<unknown>;
  };
  defer(promise: Promise<unknown>): void;
}): SegmentCommandService {
  const repository = new SegmentRepository(input.database, input.workspace);
  return new SegmentCommandService(input.workspace, {
    repository,
    validateFilter: (filter) => validateSegmentFilter(input.database, input.workspace, filter),
    resolveBrief: (reference) => resolveCommandBrief(input.database, input.workspace, reference),
    nextAvailableSlug: (name, isAvailable) => availableSlug(name, "segment", isAvailable),
    classifyWriteError: (error) => {
      if (error instanceof ProjectBriefLinkConflictError) return "brief_conflict";
      if (isUniqueConstraintError(error, SEGMENT_SLUG_UNIQUE_COLUMNS)) return "slug_conflict";
      return undefined;
    },
    refreshMemberships: async (segmentId, filterVersion) => {
      await refreshSegmentMemberships(
        input.database,
        input.workspace.workspaceId,
        segmentId,
        filterVersion,
      );
    },
    enqueueRefresh: async ({ workspaceId, segmentId, filterVersion }) => {
      await input.queue.send({
        kind: "segment_full_refresh",
        workspaceId,
        segmentId,
        filterVersion,
      });
    },
    writeAudit: (audit) => writeAuditLog(input.database, input.workspace, audit),
    defer: (promise) => input.defer(promise),
  });
}
