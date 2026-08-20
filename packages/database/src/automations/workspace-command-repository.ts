import { and, eq, exists, inArray, isNotNull, sql } from "drizzle-orm";

import {
  automationDefinitionSchema,
  type AutomationDefinition,
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
            ${draftVersionId}, NULL, ${now}, ${now}
          WHERE ${exists(precondition)}`,
        ),
        orm.insert(automationVersions).select(
          sql`SELECT
            ${draftVersionId}, ${this.context.workspaceId}, ${id}, 1, 'draft',
            ${input.timezone}, ${versionValues.graph}, NULL, ${now}
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
    trigger: {
      sourceNodeId: string;
      source: string;
      eventType: string | null;
      resourceId: string | null;
      reentry: "once" | "every_time";
      inactivityDays: number | null;
    };
  }): Promise<{ draftVersionId: string }> {
    const workspaceId = this.context.workspaceId;
    const nextDraftId = uuidv7();
    const now = nowIso();
    const orm = this.database.orm;
    await orm.batch([
      orm
        .update(automationVersions)
        .set({ status: "published", publishedAt: now })
        .where(
          and(
            eq(automationVersions.workspaceId, workspaceId),
            eq(automationVersions.id, input.draftVersionId),
            eq(automationVersions.status, "draft"),
          ),
        ),
      orm.insert(automationVersions).values({
        id: nextDraftId,
        workspaceId,
        automationId: input.automationId,
        version: input.currentVersion + 1,
        status: "draft",
        timezone: input.timezone,
        graph: graphCodec.encode(input.graph),
        createdAt: now,
      }),
      orm
        .update(automations)
        .set({
          status: "active",
          publishedVersionId: input.draftVersionId,
          draftVersionId: nextDraftId,
          updatedAt: now,
        })
        .where(
          and(eq(automations.workspaceId, workspaceId), eq(automations.id, input.automationId)),
        ),
      orm
        .delete(automationTriggers)
        .where(
          and(
            eq(automationTriggers.workspaceId, workspaceId),
            eq(automationTriggers.automationId, input.automationId),
          ),
        ),
      orm.insert(automationTriggers).values({
        automationVersionId: input.draftVersionId,
        workspaceId,
        automationId: input.automationId,
        sourceNodeId: input.trigger.sourceNodeId,
        source: input.trigger.source,
        eventType: input.trigger.eventType,
        resourceId: input.trigger.resourceId,
        reentry: input.trigger.reentry,
        inactivityDays: input.trigger.inactivityDays,
        createdAt: now,
      }),
    ]);
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
