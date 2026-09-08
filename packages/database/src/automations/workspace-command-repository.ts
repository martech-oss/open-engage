import { and, eq, exists, inArray, isNotNull, sql } from "drizzle-orm";

import {
  automationDefinitionSchema,
  type AutomationDefinition,
  type AutomationExecutionSnapshot,
} from "@openengage/core/automations";

import { conditionalAudit } from "../projects/project-brief-persistence";
import {
  approvedProjectLinkPrecondition,
  authenticatedProjectActorId,
  ProjectBriefLinkConflictError,
  type ApprovedProjectLink,
} from "../projects/project-resource-guard";
import { projectBriefs, projectItems } from "../projects/schema";
import { changedExactlyOne, didChange, nowIso } from "../shared/database-utils";
import { defineJsonCodec } from "../shared/json-codec";
import { WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { automations, automationTriggers, automationVersions } from "./schema";

export class AutomationPublicationConflictError extends Error {
  constructor() {
    super("下書きが変更されました。最新の内容を確認して再公開してください");
  }
}

const graphCodec = defineJsonCodec(automationDefinitionSchema, "automation_versions.graph");

export class AutomationCommandRepository extends WorkspaceRepository {
  /** Creates the automation shell plus its first draft version atomically. */
  public async createAutomation(input: {
    name: string;
    description: string;
    timezone: string;
    graph: AutomationDefinition;
    projectLink?: ApprovedProjectLink | undefined;
  }): Promise<{ id: string; draftVersionId: string }> {
    const id = uuidv7();
    const draftVersionId = uuidv7();
    const now = nowIso();
    const orm = this.database.orm;
    const automationValues = {
      id,
      workspaceId: this.context.workspaceId,
      name: input.name,
      description: input.description,
      status: "draft",
      draftVersionId,
      variableProjectId: input.graph.variableProjectId ?? null,
      createdAt: now,
      updatedAt: now,
    } as const;
    const versionValues = {
      id: draftVersionId,
      workspaceId: this.context.workspaceId,
      automationId: id,
      version: 1,
      status: "draft",
      timezone: input.timezone,
      graph: graphCodec.encode(input.graph),
      createdAt: now,
    } as const;
    if (input.projectLink) {
      const link = input.projectLink;
      const precondition = approvedProjectLinkPrecondition(
        orm,
        this.context.workspaceId,
        authenticatedProjectActorId(this.context),
        link,
      );
      const [created] = await orm.batch([
        orm.insert(automations).select(
          sql`SELECT
            ${id}, ${this.context.workspaceId}, ${input.name}, ${input.description}, 'draft',
            ${draftVersionId}, NULL, ${now}, ${now}, ${input.graph.variableProjectId ?? null}
          WHERE ${exists(precondition)}`,
        ),
        orm.insert(automationVersions).select(
          sql`SELECT
            ${draftVersionId}, ${this.context.workspaceId}, ${id}, 1, 'draft',
            ${input.timezone}, ${versionValues.graph}, NULL, ${now}, NULL, '{}', NULL
          WHERE ${exists(precondition)}`,
        ),
        orm.insert(projectItems).select(
          sql`SELECT
            ${this.context.workspaceId}, ${link.projectId}, 'automation', ${id},
            ${link.briefRevision}, ${link.addedByUserId}, ${now}
          WHERE ${exists(precondition)}`,
        ),
        conditionalAudit(
          orm,
          this.context,
          link.addedByUserId,
          { action: "automation.create", resourceType: "automation", resourceId: id },
          precondition,
          now,
        ),
        conditionalAudit(
          orm,
          this.context,
          link.addedByUserId,
          {
            action: "project.item.add",
            resourceType: "project",
            resourceId: link.projectId,
            metadata: {
              resourceType: "automation",
              resourceId: id,
              briefRevision: link.briefRevision,
            },
          },
          precondition,
          now,
        ),
        orm
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
      await orm.batch([
        orm.insert(automations).values(automationValues),
        orm.insert(automationVersions).values(versionValues),
      ]);
    }
    return { id, draftVersionId };
  }

  /**
   * Stores the draft graph, then refreshes the automation metadata. Returns
   * false — without touching the metadata — when the automation has no
   * editable draft version.
   */
  public async saveDraft(
    automationId: string,
    input: { name: string; description: string; timezone: string; graph: AutomationDefinition },
  ): Promise<boolean> {
    const workspaceId = this.context.workspaceId;
    const orm = this.database.orm;
    const draftVersionOf = orm
      .select({ id: automations.draftVersionId })
      .from(automations)
      .where(and(eq(automations.workspaceId, workspaceId), eq(automations.id, automationId)));
    const result = await orm
      .update(automationVersions)
      .set({
        timezone: input.timezone,
        graph: graphCodec.encode(input.graph),
      })
      .where(
        and(
          eq(automationVersions.workspaceId, workspaceId),
          eq(automationVersions.id, draftVersionOf),
          eq(automationVersions.status, "draft"),
        ),
      );
    if (!didChange(result)) return false;
    await orm
      .update(automations)
      .set({
        name: input.name,
        description: input.description,
        variableProjectId: input.graph.variableProjectId ?? null,
        updatedAt: nowIso(),
      })
      .where(and(eq(automations.workspaceId, workspaceId), eq(automations.id, automationId)));
    return true;
  }

  /**
   * Publishes the draft in one atomic batch: publish the version, open the
   * next draft, point the automation at both versions, and replace the trigger
   * registration. Returns the id of the freshly opened draft.
   */
  public async publishDraft(input: {
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
  }): Promise<{ draftVersionId: string }> {
    const workspaceId = this.context.workspaceId;
    const nextDraftId = uuidv7();
    const now = nowIso();
    const orm = this.database.orm;
    // The freshly generated draft ID is this publication's transaction token.
    // Every following write requires it, so a failed source-graph CAS is a no-op.
    const authority = exists(
      orm
        .select({ id: automationVersions.id })
        .from(automationVersions)
        .innerJoin(
          automations,
          and(
            eq(automations.id, automationVersions.automationId),
            eq(automations.workspaceId, automationVersions.workspaceId),
          ),
        )
        .where(
          and(
            eq(automations.workspaceId, workspaceId),
            eq(automations.id, input.automationId),
            eq(automations.draftVersionId, input.draftVersionId),
            eq(automationVersions.id, input.draftVersionId),
            eq(automationVersions.status, "draft"),
            eq(automationVersions.version, input.currentVersion),
            eq(automationVersions.graph, input.expectedGraph ?? graphCodec.encode(input.graph)),
          ),
        ),
    );
    const committed = exists(
      orm
        .select({ id: automationVersions.id })
        .from(automationVersions)
        .where(
          and(
            eq(automationVersions.id, nextDraftId),
            eq(automationVersions.workspaceId, workspaceId),
          ),
        ),
    );
    const [created] = await orm.batch([
      orm
        .insert(automationVersions)
        .select(
          sql`SELECT ${nextDraftId},${workspaceId},${input.automationId},${input.currentVersion + 1},'draft',${input.timezone},${graphCodec.encode(input.graph)},NULL,${now},NULL,'{}',NULL WHERE ${authority}`,
        ),
      orm
        .update(automationVersions)
        .set({
          status: "published",
          publishedAt: now,
          resolvedGraph: input.snapshot ? graphCodec.encode(input.snapshot.graph) : null,
          dependencies: JSON.stringify(input.snapshot?.dependencies ?? {}),
          variableSnapshot: input.snapshot?.variableSnapshot
            ? JSON.stringify(input.snapshot.variableSnapshot)
            : null,
        })
        .where(
          and(
            eq(automationVersions.workspaceId, workspaceId),
            eq(automationVersions.id, input.draftVersionId),
            committed,
          ),
        ),
      orm
        .update(automations)
        .set({
          status: "active",
          publishedVersionId: input.draftVersionId,
          draftVersionId: nextDraftId,
          updatedAt: now,
        })
        .where(
          and(
            eq(automations.workspaceId, workspaceId),
            eq(automations.id, input.automationId),
            committed,
          ),
        ),
      orm
        .delete(automationTriggers)
        .where(
          and(
            eq(automationTriggers.workspaceId, workspaceId),
            eq(automationTriggers.automationId, input.automationId),
            committed,
          ),
        ),
      orm
        .insert(automationTriggers)
        .select(
          sql`SELECT ${input.draftVersionId},${workspaceId},${input.automationId},${input.trigger.sourceNodeId},${input.trigger.source},${input.trigger.eventType},${input.trigger.resourceId},${input.trigger.reentry},${input.trigger.inactivityDays},${now} WHERE ${committed}`,
        ),
    ]);
    if (created.meta.changes !== 1) throw new AutomationPublicationConflictError();
    return { draftVersionId: nextDraftId };
  }

  /** Pauses or resumes a published automation; false when nothing was changeable. */
  public async setAutomationStatus(
    automationId: string,
    status: "active" | "paused",
  ): Promise<boolean> {
    const result = await this.database.orm
      .update(automations)
      .set({ status, updatedAt: nowIso() })
      .where(
        and(
          this.inWorkspace(automations),
          eq(automations.id, automationId),
          isNotNull(automations.publishedVersionId),
          inArray(automations.status, ["active", "paused"]),
        ),
      );
    return changedExactlyOne(result);
  }
}
