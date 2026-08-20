import { and, eq, exists, sql } from "drizzle-orm";

import { type SegmentFilter } from "@openengage/core/segments";

import { conditionalAudit } from "../projects/project-brief-persistence";
import {
  approvedProjectLinkPrecondition,
  authenticatedProjectActorId,
  ProjectBriefLinkConflictError,
  type ApprovedProjectLink,
} from "../projects/project-resource-guard";
import { projectBriefs, projectItems } from "../projects/schema";
import { nowIso } from "../shared/database-utils";
import { WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { SegmentEvaluationRepository } from "./evaluation-repository";
import { SegmentQueryRepository } from "./query-repository";
import { segmentMemberships, segments } from "./schema";
import { filterAstCodec } from "./support";

export class SegmentCommandRepository extends WorkspaceRepository {
  private readonly queries = new SegmentQueryRepository(this.database, this.context);
  private readonly evaluation = new SegmentEvaluationRepository(this.database, this.context);

  public async createSegment(input: {
    name: string;
    slug: string;
    description?: string | undefined;
    kind: "static" | "dynamic";
    filter?: SegmentFilter | undefined;
    membershipSource?: string | null | undefined;
    projectLink?: ApprovedProjectLink | undefined;
  }): Promise<{ id: string; createdAt: string; updatedAt: string }> {
    const id = uuidv7();
    const now = nowIso();
    const segmentValues = {
      id,
      workspaceId: this.context.workspaceId,
      name: input.name,
      slug: input.slug,
      description: input.description ?? "",
      kind: input.kind,
      filterAst: input.filter ? filterAstCodec.encode(input.filter) : null,
      membershipSource: input.kind === "static" ? (input.membershipSource ?? null) : null,
      evaluationStatus: input.kind === "dynamic" ? "pending" : "ready",
      createdAt: now,
      updatedAt: now,
    };
    if (input.projectLink) {
      const link = input.projectLink;
      const precondition = approvedProjectLinkPrecondition(
        this.database.orm,
        this.context.workspaceId,
        authenticatedProjectActorId(this.context),
        link,
      );
      const [created] = await this.database.orm.batch([
        this.database.orm.insert(segments).select(
          sql`SELECT
            ${id}, ${this.context.workspaceId}, ${segmentValues.name}, ${segmentValues.slug},
            ${segmentValues.description}, ${segmentValues.kind}, ${segmentValues.filterAst},
            ${segmentValues.membershipSource}, 1, 0, NULL, ${segmentValues.evaluationStatus},
            NULL, ${now}, ${now}
          WHERE ${exists(precondition)}`,
        ),
        this.database.orm.insert(projectItems).select(
          sql`SELECT
            ${this.context.workspaceId}, ${link.projectId}, 'segment', ${id},
            ${link.briefRevision}, ${link.addedByUserId}, ${now}
          WHERE ${exists(precondition)}`,
        ),
        conditionalAudit(
          this.database.orm,
          this.context,
          link.addedByUserId,
          { action: "segment.create", resourceType: "segment", resourceId: id },
          precondition,
          now,
        ),
        conditionalAudit(
          this.database.orm,
          this.context,
          link.addedByUserId,
          {
            action: "project.item.add",
            resourceType: "project",
            resourceId: link.projectId,
            metadata: {
              resourceType: "segment",
              resourceId: id,
              briefRevision: link.briefRevision,
            },
          },
          precondition,
          now,
        ),
        this.database.orm
          .update(projectBriefs)
          .set({ rowVersion: sql`${projectBriefs.rowVersion} + 1`, updatedAt: now })
          .where(
            and(
              eq(projectBriefs.workspaceId, this.context.workspaceId),
              eq(projectBriefs.projectId, link.projectId),
              exists(precondition),
            ),
          ),
      ]);
      if (created.meta.changes !== 1) throw new ProjectBriefLinkConflictError();
    } else {
      await this.database.orm.insert(segments).values(segmentValues);
    }
    return { id, createdAt: now, updatedAt: now };
  }

  public async updateSegment(
    id: string,
    input: {
      name: string;
      slug: string;
      description: string;
      kind: "static" | "dynamic";
      filter?: SegmentFilter | undefined;
      membershipSource?: string | null | undefined;
    },
  ): Promise<{ filterVersion: number } | null> {
    const current = await this.queries.getSegment(id);
    if (!current) return null;
    const filterVersion = current.filterVersion + 1;
    await this.database.orm
      .update(segments)
      .set({
        name: input.name,
        slug: input.slug,
        description: input.description,
        kind: input.kind,
        filterAst: input.filter ? filterAstCodec.encode(input.filter) : null,
        membershipSource: input.kind === "static" ? (input.membershipSource ?? null) : null,
        filterVersion,
        evaluationStatus: input.kind === "dynamic" ? "pending" : "ready",
        evaluationError: null,
        evaluatedAt: input.kind === "dynamic" ? current.evaluatedAt : null,
        updatedAt: nowIso(),
      })
      .where(and(this.inWorkspace(segments), eq(segments.id, id)));
    if (current.kind !== input.kind) {
      await this.database.orm
        .delete(segmentMemberships)
        .where(and(this.inWorkspace(segmentMemberships), eq(segmentMemberships.segmentId, id)));
      await this.evaluation.updateMemberCount(id);
    }
    return { filterVersion };
  }
}
