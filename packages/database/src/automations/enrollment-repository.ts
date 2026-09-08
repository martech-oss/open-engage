import { and, eq, isNull, ne, notExists, or, sql } from "drizzle-orm";

import {
  automationDefinitionSchema,
  type AutomationDefinition,
} from "@openengage/core/automations";

import { contacts } from "../contacts/schema";
import { isConstraintError, nowIso } from "../shared/database-utils";
import { defineJsonCodec } from "../shared/json-codec";
import { WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import {
  automationRunTargets,
  automationEnrollments,
  automationJobs,
  automations,
  automationTriggers,
  automationVersions,
} from "./schema";

const graphCodec = defineJsonCodec(automationDefinitionSchema, "automation_versions.graph");

export class AutomationEnrollmentRepository extends WorkspaceRepository {
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
   * caller-provided sourceEventId preserves the original event identity.
   */
  public async enrollContact(input: {
    automationId: string;
    automationVersionId: string;
    sourceNodeId: string;
    contactId: string;
    sourceEventId: string;
    reentry?: "once" | "every_time" | "cooldown";
    cooldownMinutes?: number;
    now?: string;
    runId?: string;
  }): Promise<{ enrollmentId: string; jobId: string } | null> {
    const workspaceId = this.context.workspaceId;
    const enrollmentId = uuidv7();
    const jobId = uuidv7();
    const now = input.now ?? nowIso();
    const version = await this.database.orm
      .select({ graph: automationVersions.graph })
      .from(automationVersions)
      .where(
        and(
          this.inWorkspace(automationVersions),
          eq(automationVersions.id, input.automationVersionId),
          eq(automationVersions.automationId, input.automationId),
          eq(automationVersions.status, "published"),
        ),
      )
      .get();
    if (!version) return null;
    const source = graphCodec.decode(version.graph).nodes.find((node) => node.type === "source");
    if (!source || source.id !== input.sourceNodeId) return null;
    const reentry = input.reentry ?? source.config.reentry;
    const cooldown = input.cooldownMinutes ?? source.config.cooldownMinutes;
    if (reentry === "cooldown" && (!cooldown || cooldown <= 0))
      throw new Error("Cooldown requires a positive duration");
    const cutoff = new Date(Date.parse(now) - (cooldown ?? 0) * 60_000).toISOString();
    const prior = this.database.orm
      .select({ id: automationEnrollments.id })
      .from(automationEnrollments)
      .where(
        and(
          this.inWorkspace(automationEnrollments),
          eq(automationEnrollments.automationId, input.automationId),
          eq(automationEnrollments.contactId, input.contactId),
          isNull(automationEnrollments.parentJobId),
          ...(reentry === "cooldown" ? [sql`${automationEnrollments.enteredAt} > ${cutoff}`] : []),
        ),
      );
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
              parentJobId: sql<string | null>`NULL`.as("parent_job_id"),
              projectId: sql<
                string | null
              >`${graphCodec.decode(version.graph).variableProjectId ?? null}`.as("project_id"),
              executionSnapshot: sql<string | null>`NULL`.as("execution_snapshot"),
            })
            .from(contacts)
            .where(
              and(
                eq(contacts.workspaceId, workspaceId),
                eq(contacts.id, input.contactId),
                ne(contacts.status, "archived"),
                ...(reentry === "every_time" ? [] : [notExists(prior)]),
                ...(input.runId
                  ? [
                      sql`EXISTS(SELECT 1 FROM automation_runs r JOIN automation_run_targets t ON t.run_id=r.id WHERE r.workspace_id=${workspaceId} AND r.id=${input.runId} AND r.status='enrolling' AND t.contact_id=${input.contactId} AND t.status='pending')`,
                    ]
                  : []),
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
        ...(input.runId
          ? [
              orm
                .update(automationRunTargets)
                .set({ status: "enrolled", enrollmentId, updatedAt: now })
                .where(
                  and(
                    eq(automationRunTargets.workspaceId, workspaceId),
                    eq(automationRunTargets.runId, input.runId),
                    eq(automationRunTargets.contactId, input.contactId),
                    eq(automationRunTargets.status, "pending"),
                  ),
                ),
            ]
          : []),
      ]);
      return { enrollmentId, jobId };
    } catch (error) {
      if (isConstraintError(error)) return null;
      throw error;
    }
  }
}
