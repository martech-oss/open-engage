import {
  validateAutomation,
  pinAutomationDependencies,
  type AutomationExecutionSnapshot,
  type ApplyEmailSequenceResult,
  type AutomationDefinition,
  type AutomationValidationIssue,
  type EmailSequenceProposal,
} from "@openengage/core/automations";
import type { WorkspaceContext } from "@openengage/core/shared";
import {
  AutomationQueryRepository,
  AutomationCommandRepository,
  AutomationPublicationRepository,
  AutomationPublicationConflictError,
} from "@openengage/database/automations";
import type { OpenEngageDatabase } from "@openengage/database/client";
import { writeAuditLog } from "@openengage/database/platform";
import { ProjectBriefLinkConflictError } from "@openengage/database/projects";

import {
  resolveCommandBrief,
  type CommandBriefReference,
  type CommandBriefResolution,
} from "../projects/brief-resolution";
import { resolveProjectVariables } from "../projects/variable-service";
import { applyEmailSequence, EmailSequenceError } from "./email-sequence-service";
import {
  loadAutomationResourceContext,
  validateAutomationResources,
  type AutomationResourceValidationIssue,
} from "./resource-validation";
import { automationTrigger } from "./triggers";

export type AutomationCreateInput = AutomationDefinition & CommandBriefReference;
export type AutomationSequenceInput = EmailSequenceProposal & CommandBriefReference;
export type AutomationSaveDraftInput = AutomationDefinition & { id: string };

interface AutomationCommandRepositoryPort {
  createAutomation(input: {
    name: string;
    description: string;
    timezone: string;
    graph: AutomationDefinition;
    projectLink?: { projectId: string; briefRevision: number; addedByUserId: string } | undefined;
  }): Promise<{ id: string; draftVersionId: string }>;
  saveDraft(
    automationId: string,
    input: {
      name: string;
      description: string;
      timezone: string;
      graph: AutomationDefinition;
    },
  ): Promise<boolean>;
  publishDraft(input: {
    automationId: string;
    draftVersionId: string;
    currentVersion: number;
    timezone: string;
    graph: AutomationDefinition;
    snapshot?: AutomationExecutionSnapshot;
    expectedGraph?: string;
    trigger: {
      sourceNodeId: string;
      source: string;
      eventType: string | null;
      resourceId: string | null;
      reentry: "once" | "every_time" | "cooldown";
      inactivityDays: number | null;
    };
  }): Promise<{ draftVersionId: string }>;
  setAutomationStatus(automationId: string, status: "active" | "paused"): Promise<boolean>;
}

interface AutomationQueryPort {
  findPublishableDraft(automationId: string): Promise<{
    draftVersionId: string;
    version: number;
    graph: AutomationDefinition;
    rawGraph?: string;
  } | null>;
}

export interface AutomationCommandPorts {
  preparePublication?(
    id: string,
    definition: AutomationDefinition,
  ): Promise<AutomationExecutionSnapshot>;
  commands: AutomationCommandRepositoryPort;
  queries: AutomationQueryPort;
  resolveBrief(reference: CommandBriefReference): Promise<CommandBriefResolution>;
  classifyWriteError(
    error: unknown,
  ): "brief_conflict" | "sequence_conflict" | "invalid_sequence" | undefined;
  loadResourceIssues(
    definition: AutomationDefinition,
  ): Promise<AutomationResourceValidationIssue[]>;
  applySequence(
    proposal: EmailSequenceProposal,
    projectLink?: { projectId: string; briefRevision: number; addedByUserId: string },
  ): Promise<{ created: boolean; result: ApplyEmailSequenceResult }>;
  writeAudit(input: {
    action: "email_sequence.create";
    resourceType: "automation";
    resourceId: string;
  }): Promise<void>;
  defer(promise: Promise<unknown>): void;
}

type BriefFailure = Exclude<CommandBriefResolution, { kind: "ok" }>;

export type AutomationCreateOutcome =
  | BriefFailure
  | { kind: "ok"; automation: { id: string; draftVersionId: string } };

export type AutomationSaveDraftOutcome = { kind: "draft_not_editable" } | { kind: "ok" };

export type AutomationPublishOutcome =
  | { kind: "draft_not_found" }
  | {
      kind: "invalid_graph";
      message: string | undefined;
      issues: AutomationValidationIssue[] | AutomationResourceValidationIssue[];
    }
  | {
      kind: "ok";
      automation: { publishedVersionId: string; draftVersionId: string };
    };

export type AutomationStatusOutcome =
  | { kind: "not_changeable" }
  | { kind: "ok"; status: "active" | "paused" };

export type AutomationSequenceOutcome =
  | BriefFailure
  | { kind: "sequence_conflict" }
  | { kind: "invalid_sequence" }
  | { kind: "ok"; sequence: ApplyEmailSequenceResult };

export class AutomationCommandService {
  public constructor(
    private readonly actor: Pick<WorkspaceContext, "userId">,
    private readonly ports: AutomationCommandPorts,
  ) {}

  public async create(input: AutomationCreateInput): Promise<AutomationCreateOutcome> {
    const brief = await this.ports.resolveBrief({
      projectId: input.projectId,
      briefRevision: input.briefRevision,
    });
    if (brief.kind !== "ok") return brief;
    const { projectId: _projectId, briefRevision: _briefRevision, ...definition } = input;
    try {
      const created = await this.ports.commands.createAutomation({
        name: definition.name,
        description: definition.description,
        timezone: definition.timezone,
        graph: definition,
        ...(brief.brief
          ? {
              projectLink: {
                projectId: brief.brief.projectId,
                briefRevision: brief.brief.revision,
                addedByUserId: this.actor.userId,
              },
            }
          : {}),
      });
      return { kind: "ok", automation: created };
    } catch (error) {
      if (this.ports.classifyWriteError(error) === "brief_conflict") {
        return { kind: "brief_revision_conflict" };
      }
      throw error;
    }
  }

  public async saveDraft(input: AutomationSaveDraftInput): Promise<AutomationSaveDraftOutcome> {
    const { id, ...definition } = input;
    const saved = await this.ports.commands.saveDraft(id, {
      name: definition.name,
      description: definition.description,
      timezone: definition.timezone,
      graph: definition,
    });
    return saved ? { kind: "ok" } : { kind: "draft_not_editable" };
  }

  public async publish(id: string): Promise<AutomationPublishOutcome> {
    const row = await this.ports.queries.findPublishableDraft(id);
    if (!row) return { kind: "draft_not_found" };

    const definition = row.graph;
    const graphIssues = validateAutomation(definition);
    if (graphIssues.length > 0) {
      return { kind: "invalid_graph", message: undefined, issues: graphIssues };
    }
    const resourceIssues = await this.ports.loadResourceIssues(definition);
    if (resourceIssues.length > 0) {
      return {
        kind: "invalid_graph",
        message: "利用できないワークスペースリソースを参照しているノードがあります",
        issues: resourceIssues,
      };
    }
    const source = definition.nodes.find((node) => node.type === "source");
    if (!source) {
      return { kind: "invalid_graph", message: "開始条件がありません", issues: [] };
    }
    const trigger = automationTrigger(source.config);
    let snapshot: AutomationExecutionSnapshot | undefined;
    try {
      snapshot = await this.ports.preparePublication?.(id, definition);
    } catch (error) {
      return {
        kind: "invalid_graph",
        message: error instanceof Error ? error.message : String(error),
        issues: [],
      };
    }
    let published: { draftVersionId: string };
    try {
      published = await this.ports.commands.publishDraft({
        automationId: id,
        draftVersionId: row.draftVersionId,
        currentVersion: row.version,
        timezone: definition.timezone,
        graph: row.graph,
        ...(row.rawGraph ? { expectedGraph: row.rawGraph } : {}),
        ...(snapshot ? { snapshot } : {}),
        trigger: {
          sourceNodeId: source.id,
          source: source.config.source,
          eventType: trigger.eventType,
          resourceId: trigger.resourceId,
          reentry: source.config.reentry,
          inactivityDays: trigger.inactivityDays,
        },
      });
    } catch (error) {
      if (error instanceof AutomationPublicationConflictError)
        return { kind: "invalid_graph", message: error.message, issues: [] };
      throw error;
    }
    return {
      kind: "ok",
      automation: {
        publishedVersionId: row.draftVersionId,
        draftVersionId: published.draftVersionId,
      },
    };
  }

  public async setStatus(
    id: string,
    status: "active" | "paused",
  ): Promise<AutomationStatusOutcome> {
    const changed = await this.ports.commands.setAutomationStatus(id, status);
    return changed ? { kind: "ok", status } : { kind: "not_changeable" };
  }

  public async applyEmailSequence(
    input: AutomationSequenceInput,
  ): Promise<AutomationSequenceOutcome> {
    const brief = await this.ports.resolveBrief({
      projectId: input.projectId,
      briefRevision: input.briefRevision,
    });
    if (brief.kind !== "ok") return brief;
    const { projectId: _projectId, briefRevision: _briefRevision, ...proposal } = input;
    try {
      const application = await this.ports.applySequence(
        proposal,
        brief.brief
          ? {
              projectId: brief.brief.projectId,
              briefRevision: brief.brief.revision,
              addedByUserId: this.actor.userId,
            }
          : undefined,
      );
      if (!brief.brief && application.created) {
        this.ports.defer(
          this.ports.writeAudit({
            action: "email_sequence.create",
            resourceType: "automation",
            resourceId: application.result.automationId,
          }),
        );
      }
      return { kind: "ok", sequence: application.result };
    } catch (error) {
      switch (this.ports.classifyWriteError(error)) {
        case "brief_conflict":
          return { kind: "brief_revision_conflict" };
        case "sequence_conflict":
          return { kind: "sequence_conflict" };
        case "invalid_sequence":
          return { kind: "invalid_sequence" };
        case undefined:
          throw error;
      }
    }
  }
}

export function createAutomationCommandService(input: {
  database: OpenEngageDatabase;
  workspace: WorkspaceContext;
  defer(promise: Promise<unknown>): void;
}): AutomationCommandService {
  return new AutomationCommandService(input.workspace, {
    queries: new AutomationQueryRepository(input.database, input.workspace),
    commands: new AutomationCommandRepository(input.database, input.workspace),
    preparePublication: async (id, definition) =>
      pinAutomationDependencies(
        id,
        definition,
        await resolveProjectVariables(
          input.database,
          input.workspace.workspaceId,
          definition.variableProjectId ?? null,
        ),
        (childId) =>
          new AutomationPublicationRepository(input.database, input.workspace).publishedDependency(
            childId,
          ),
        async (graph) => {
          const issues = await validateAutomationResources(
            graph,
            await loadAutomationResourceContext(input.database, input.workspace),
          );
          if (issues.length) throw new Error(issues.map((issue) => issue.message).join("; "));
        },
      ),
    resolveBrief: (reference) => resolveCommandBrief(input.database, input.workspace, reference),
    classifyWriteError: (error) => {
      if (error instanceof ProjectBriefLinkConflictError) return "brief_conflict";
      if (error instanceof EmailSequenceError) {
        return error.kind === "conflict" ? "sequence_conflict" : "invalid_sequence";
      }
      return undefined;
    },
    loadResourceIssues: async (definition) =>
      validateAutomationResources(
        definition,
        await loadAutomationResourceContext(input.database, input.workspace),
      ),
    applySequence: (proposal, projectLink) =>
      applyEmailSequence(input.database, input.workspace, proposal, projectLink),
    writeAudit: (audit) => writeAuditLog(input.database, input.workspace, audit),
    defer: (promise) => input.defer(promise),
  });
}
