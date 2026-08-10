import { and, count, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";

import {
  automationDefinitionSchema,
  type AutomationDefinition,
} from "@openengage/core/automations";

import { contacts } from "../contacts/schema";
import { deliveries, emailTemplates } from "../messaging/schema";
import { changedExactlyOne, didChange, isConstraintError, nowIso } from "../shared/database-utils";
import { defineJsonCodec } from "../shared/json-codec";
import { UNPAGINATED_LIST_LIMIT } from "../shared/pagination";
import { WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { projectItems } from "../web/schema";
import {
  automationEnrollments,
  automationJobs,
  automations,
  automationTriggers,
  automationVersions,
} from "./schema";

const graphCodec = defineJsonCodec(automationDefinitionSchema, "automation_versions.graph");

export interface AutomationAnalyticsRows {
  enrollments: Array<{ status: string; count: number }>;
  deliveries: Array<{ status: string; count: number }>;
}

/** Workspace-scoped automation store: admin CRUD, the publish pipeline and enrollment writes. */
export class AutomationRepository extends WorkspaceRepository {
  public async analytics(automationId: string): Promise<AutomationAnalyticsRows> {
    const workspaceId = this.context.workspaceId;
    const [enrollmentRows, deliveryRows] = await Promise.all([
      this.database.orm
        .select({ status: automationEnrollments.status, count: count() })
        .from(automationEnrollments)
        .where(
          and(
            eq(automationEnrollments.workspaceId, workspaceId),
            eq(automationEnrollments.automationId, automationId),
          ),
        )
        .groupBy(automationEnrollments.status),
      this.database.orm
        .select({ status: deliveries.status, count: count() })
        .from(deliveries)
        .innerJoin(
          automationEnrollments,
          and(
            eq(automationEnrollments.id, deliveries.enrollmentId),
            eq(automationEnrollments.workspaceId, deliveries.workspaceId),
          ),
        )
        .where(
          and(
            eq(deliveries.workspaceId, workspaceId),
            eq(automationEnrollments.automationId, automationId),
          ),
        )
        .groupBy(deliveries.status),
    ]);
    return { enrollments: enrollmentRows, deliveries: deliveryRows };
  }

  /** Automation list rows with enrollment counters and the published trigger source. */
  public async listAutomationsWithCounts(): Promise<
    Array<{
      id: string;
      name: string;
      description: string;
      status: string;
      triggerSource: string | null;
      enrollmentCount: number;
      activeCount: number;
      completedCount: number;
      updatedAt: string;
    }>
  > {
    // Correlated subqueries are embedded as builders: interpolating a plain
    // `${table.column}` into a select field renders it unqualified, which
    // would silently self-compare inside the subquery.
    const triggerSourceQuery = this.database.orm
      .select({ source: automationTriggers.source })
      .from(automationTriggers)
      .where(
        and(
          eq(automationTriggers.workspaceId, automations.workspaceId),
          eq(automationTriggers.automationVersionId, automations.publishedVersionId),
        ),
      );
    return await this.database.orm
      .select({
        id: automations.id,
        name: automations.name,
        description: automations.description,
        status: automations.status,
        triggerSource: sql<string | null>`${triggerSourceQuery}`.as("trigger_source"),
        enrollmentCount: this.enrollmentCountExpression().as("enrollment_count"),
        activeCount: this.enrollmentCountExpression("active").as("active_count"),
        completedCount: this.enrollmentCountExpression("completed").as("completed_count"),
        updatedAt: automations.updatedAt,
      })
      .from(automations)
      .where(this.inWorkspace(automations))
      .orderBy(desc(automations.updatedAt))
      .limit(UNPAGINATED_LIST_LIMIT);
  }

  /** Creates the automation shell plus its first draft version atomically. */
  public async createAutomation(input: {
    name: string;
    description: string;
    timezone: string;
    graph: AutomationDefinition;
    projectLink?: { projectId: string; briefRevision: number; addedByUserId: string } | undefined;
  }): Promise<{ id: string; draftVersionId: string }> {
    const id = uuidv7();
    const draftVersionId = uuidv7();
    const now = nowIso();
    const orm = this.database.orm;
    const insertAutomation = orm.insert(automations).values({
      id,
      workspaceId: this.context.workspaceId,
      name: input.name,
      description: input.description,
      status: "draft",
      draftVersionId,
      createdAt: now,
      updatedAt: now,
    });
    const insertVersion = orm.insert(automationVersions).values({
      id: draftVersionId,
      workspaceId: this.context.workspaceId,
      automationId: id,
      version: 1,
      status: "draft",
      timezone: input.timezone,
      graph: graphCodec.encode(input.graph),
      createdAt: now,
    });
    if (input.projectLink) {
      await orm.batch([
        insertAutomation,
        insertVersion,
        orm.insert(projectItems).values({
          workspaceId: this.context.workspaceId,
          projectId: input.projectLink.projectId,
          resourceType: "automation",
          resourceId: id,
          briefRevision: input.projectLink.briefRevision,
          addedByUserId: input.projectLink.addedByUserId,
          createdAt: now,
        }),
      ]);
    } else {
      await orm.batch([insertAutomation, insertVersion]);
    }
    return { id, draftVersionId };
  }

  /** The draft graph of one automation plus the automation status. */
  public async getDraft(
    automationId: string,
  ): Promise<{ graph: AutomationDefinition; status: string } | null> {
    const row = await this.database.orm
      .select({ graph: automationVersions.graph, status: automations.status })
      .from(automations)
      .innerJoin(
        automationVersions,
        and(
          eq(automationVersions.id, automations.draftVersionId),
          eq(automationVersions.workspaceId, automations.workspaceId),
        ),
      )
      .where(and(this.inWorkspace(automations), eq(automations.id, automationId)))
      .get();
    return row
      ? {
          ...row,
          graph: graphCodec.decode(row.graph),
        }
      : null;
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

  /** The automation's current draft version, if it is still publishable. */
  public async findPublishableDraft(
    automationId: string,
  ): Promise<{ draftVersionId: string; version: number; graph: AutomationDefinition } | null> {
    const row = await this.database.orm
      .select({
        draftVersionId: automationVersions.id,
        version: automationVersions.version,
        graph: automationVersions.graph,
      })
      .from(automations)
      .innerJoin(
        automationVersions,
        and(
          eq(automationVersions.id, automations.draftVersionId),
          eq(automationVersions.workspaceId, automations.workspaceId),
        ),
      )
      .where(
        and(
          this.inWorkspace(automations),
          eq(automations.id, automationId),
          eq(automationVersions.status, "draft"),
        ),
      )
      .get();
    return row
      ? {
          ...row,
          graph: graphCodec.decode(row.graph),
        }
      : null;
  }

  /** Of the given templates, those published locally and ready to send. */
  public async listPublishedTemplateIds(templateIds: string[]): Promise<string[]> {
    const rows = await this.database.orm
      .select({ id: emailTemplates.id })
      .from(emailTemplates)
      .where(
        and(
          this.inWorkspace(emailTemplates),
          isNull(emailTemplates.archivedAt),
          eq(emailTemplates.purpose, "transactional"),
          isNotNull(emailTemplates.publishedRevision),
          inArray(emailTemplates.id, templateIds),
        ),
      );
    return rows.map((row) => row.id);
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

  /** Published triggers of active automations listening for this event. */
  public async listActiveTriggersForEvent(
    eventType: string,
    resourceId: string | null,
  ): Promise<
    Array<{
      automationVersionId: string;
      automationId: string;
      sourceNodeId: string;
      reentry: string;
    }>
  > {
    // `resource_id = NULL` never matches, so a null event resource narrows
    // the raw `(resource_id IS NULL OR resource_id = ?)` to the IS NULL arm.
    const resourceCondition =
      resourceId === null
        ? isNull(automationTriggers.resourceId)
        : or(isNull(automationTriggers.resourceId), eq(automationTriggers.resourceId, resourceId));
    return await this.database.orm
      .select({
        automationVersionId: automationTriggers.automationVersionId,
        automationId: automationTriggers.automationId,
        sourceNodeId: automationTriggers.sourceNodeId,
        reentry: automationTriggers.reentry,
      })
      .from(automationTriggers)
      .innerJoin(
        automations,
        and(
          eq(automations.workspaceId, automationTriggers.workspaceId),
          eq(automations.id, automationTriggers.automationId),
        ),
      )
      .where(
        and(
          this.inWorkspace(automationTriggers),
          eq(automations.status, "active"),
          eq(automations.publishedVersionId, automationTriggers.automationVersionId),
          eq(automationTriggers.eventType, eventType),
          resourceCondition,
        ),
      );
  }

  /** The published version (id + graph) of one active automation. */
  public async findActivePublishedAutomation(
    automationId: string,
  ): Promise<{ publishedVersionId: string; graph: AutomationDefinition } | null> {
    const row = await this.database.orm
      .select({ publishedVersionId: automationVersions.id, graph: automationVersions.graph })
      .from(automations)
      .innerJoin(
        automationVersions,
        and(
          eq(automationVersions.id, automations.publishedVersionId),
          eq(automationVersions.workspaceId, automations.workspaceId),
        ),
      )
      .where(
        and(
          this.inWorkspace(automations),
          eq(automations.id, automationId),
          eq(automations.status, "active"),
        ),
      )
      .get();
    return row
      ? {
          ...row,
          graph: graphCodec.decode(row.graph),
        }
      : null;
  }

  /**
   * Enrolls a contact and creates the first job ('pending') in one atomic
   * batch. The enrollment row is inserted via SELECT so a missing or
   * archived contact inserts nothing and the job's FK aborts the batch; that
   * — like a duplicate (workspace, automation, contact, source event) — comes
   * back as a constraint violation and is reported as null. Note the
   * caller-provided sourceEventId may be the "once" re-entry sentinel.
   */
  public async enrollContact(input: {
    automationId: string;
    automationVersionId: string;
    sourceNodeId: string;
    contactId: string;
    sourceEventId: string;
  }): Promise<{ enrollmentId: string; jobId: string } | null> {
    const workspaceId = this.context.workspaceId;
    const enrollmentId = uuidv7();
    const jobId = uuidv7();
    const now = nowIso();
    const orm = this.database.orm;
    try {
      await orm.batch([
        // insert-from-select: drizzle emits the full column list in
        // declaration order, so the SELECT lists every automation_enrollments
        // column in exactly that order.
        orm.insert(automationEnrollments).select(
          orm
            .select({
              id: sql<string>`${enrollmentId}`.as("id"),
              workspaceId: contacts.workspaceId,
              automationId: sql<string>`${input.automationId}`.as("automation_id"),
              automationVersionId: sql<string>`${input.automationVersionId}`.as(
                "automation_version_id",
              ),
              contactId: contacts.id,
              sourceEventId: sql<string>`${input.sourceEventId}`.as("source_event_id"),
              status: sql<string>`'active'`.as("status"),
              currentNodeId: sql<string>`${input.sourceNodeId}`.as("current_nodeId"),
              enteredAt: sql<string>`${now}`.as("enteredAt"),
              completedAt: sql<string | null>`NULL`.as("completed_at"),
              updatedAt: sql<string>`${now}`.as("updated_at"),
            })
            .from(contacts)
            .where(
              and(
                eq(contacts.workspaceId, workspaceId),
                eq(contacts.id, input.contactId),
                ne(contacts.status, "archived"),
              ),
            ),
        ),
        orm.insert(automationJobs).values({
          id: jobId,
          workspaceId,
          enrollmentId,
          automationVersionId: input.automationVersionId,
          nodeId: input.sourceNodeId,
          contactId: input.contactId,
          idempotencyKey: `${enrollmentId}:${input.sourceNodeId}:${input.contactId}`,
          status: "pending",
          dueAt: now,
          createdAt: now,
          updatedAt: now,
        }),
      ]);
      return { enrollmentId, jobId };
    } catch (error) {
      if (isConstraintError(error)) return null;
      throw error;
    }
  }

  /** COUNT of this automation's enrollments, optionally narrowed to one status. */
  private enrollmentCountExpression(status?: "active" | "completed") {
    const conditions = [
      eq(automationEnrollments.workspaceId, automations.workspaceId),
      eq(automationEnrollments.automationId, automations.id),
    ];
    if (status) conditions.push(eq(automationEnrollments.status, status));
    return sql<number>`${this.database.orm.$count(automationEnrollments, and(...conditions))}`.mapWith(
      Number,
    );
  }
}
