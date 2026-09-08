import { and, asc, eq, exists, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";

import { automationDefinitionSchema } from "@openengage/core/automations";
import { jsonRecordSchema } from "@openengage/core/shared";

import { contactEvents, contacts } from "../contacts/schema";
import { didChange } from "../shared/database-utils";
import { decodeJson, defineJsonCodec } from "../shared/json-codec";
import { DatabaseRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { AutomationCompletionRepository } from "./completion-repository";
import {
  assertAutomationJobTransition,
  AUTOMATION_MAX_STARTS,
  type AutomationJobRow,
} from "./engine-support";
import { automationEnrollments, automationJobs, automationVersions } from "./schema";

const graphCodec = defineJsonCodec(automationDefinitionSchema, "automation_versions.graph");

export class AutomationJobRepository extends DatabaseRepository {
  /** Workspaces holding due pending jobs, oldest due first (dispatch fan-out). */
  public async workspacesWithDueJobs(
    now: string,
    limit = 50,
  ): Promise<Array<{ workspaceId: string }>> {
    const oldest = sql<string>`MIN(${automationJobs.dueAt})`.as("oldest");
    const rows = await this.database.orm
      .select({ workspaceId: automationJobs.workspaceId, oldest })
      .from(automationJobs)
      .where(
        and(
          eq(automationJobs.status, "pending"),
          lte(automationJobs.dueAt, now),
          lt(automationJobs.attempts, AUTOMATION_MAX_STARTS),
        ),
      )
      .groupBy(automationJobs.workspaceId)
      .orderBy(asc(sql`oldest`))
      .limit(limit);
    return rows.map((row) => ({ workspaceId: row.workspaceId }));
  }

  /**
   * Leases due pending jobs (pending -> leased). The lease UPDATE re-checks
   * `status = 'pending'` and the lease expiry, so concurrent dispatchers can
   * race on the same candidates and only the winner of each row keeps it.
   */
  public async claimDueJobs(
    now: string,
    leaseUntil: string,
    limit = 100,
    workspaceId?: string,
  ): Promise<Array<{ id: string; leaseId: string }>> {
    const orm = this.database.orm;
    const conditions = [
      eq(automationJobs.status, "pending"),
      lte(automationJobs.dueAt, now),
      lt(automationJobs.attempts, AUTOMATION_MAX_STARTS),
      or(isNull(automationJobs.leaseUntil), lt(automationJobs.leaseUntil, now))!,
    ];
    if (workspaceId) conditions.push(eq(automationJobs.workspaceId, workspaceId));
    const candidates = await orm
      .select({ id: automationJobs.id })
      .from(automationJobs)
      .where(and(...conditions))
      .orderBy(asc(automationJobs.dueAt))
      .limit(limit);
    const claims = candidates.map((candidate) => ({ id: candidate.id, leaseId: uuidv7() }));
    const [first, ...rest] = claims.map((claim) =>
      orm
        .update(automationJobs)
        .set({ status: "leased", leaseId: claim.leaseId, leaseUntil, updatedAt: now })
        .where(
          and(
            eq(automationJobs.id, claim.id),
            eq(automationJobs.status, "pending"),
            lt(automationJobs.attempts, AUTOMATION_MAX_STARTS),
            or(isNull(automationJobs.leaseUntil), lt(automationJobs.leaseUntil, now)),
          ),
        ),
    );
    if (!first) return [];
    assertAutomationJobTransition("pending", "leased");
    const results = await orm.batch([first, ...rest]);
    return claims.filter((_, index) => results[index]?.meta.changes === 1);
  }

  /** Loads a leased/running job with its graph, enrollment and contact row. */
  public async findJobForProcessing(
    jobId: string,
    leaseId: string,
  ): Promise<AutomationJobRow | null> {
    const row = await this.database.orm
      .select({
        id: automationJobs.id,
        workspaceId: automationJobs.workspaceId,
        enrollmentId: automationJobs.enrollmentId,
        automationVersionId: automationJobs.automationVersionId,
        nodeId: automationJobs.nodeId,
        contactId: automationJobs.contactId,
        idempotencyKey: automationJobs.idempotencyKey,
        payload: automationJobs.payload,
        status: automationJobs.status,
        leaseId: automationJobs.leaseId,
        attempts: automationJobs.attempts,
        createdAt: automationJobs.createdAt,
        enteredAt: automationEnrollments.enteredAt,
        graph: sql<string>`coalesce(json_extract(${automationEnrollments.executionSnapshot},'$.graph'),${automationVersions.resolvedGraph},${automationVersions.graph})`,
        contactEmail: contacts.email,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        phone: contacts.phone,
        stage: contacts.stage,
        score: contacts.score,
        customFields: contacts.customFields,
      })
      .from(automationJobs)
      .innerJoin(
        automationVersions,
        and(
          eq(automationVersions.id, automationJobs.automationVersionId),
          eq(automationVersions.workspaceId, automationJobs.workspaceId),
        ),
      )
      .innerJoin(
        automationEnrollments,
        and(
          eq(automationEnrollments.id, automationJobs.enrollmentId),
          eq(automationEnrollments.workspaceId, automationJobs.workspaceId),
        ),
      )
      .innerJoin(
        contacts,
        and(
          eq(contacts.id, automationJobs.contactId),
          eq(contacts.workspaceId, automationJobs.workspaceId),
        ),
      )
      .where(
        and(
          eq(automationJobs.id, jobId),
          eq(automationJobs.leaseId, leaseId),
          inArray(automationJobs.status, ["leased", "running"]),
          eq(automationEnrollments.status, "active"),
        ),
      )
      .get();
    if (!row) return null;
    return {
      ...row,
      graph: graphCodec.decode(row.graph),
      payload: decodeJson(row.payload, jsonRecordSchema, "automation_jobs.payload"),
      customFields: decodeJson(row.customFields, jsonRecordSchema, "contacts.custom_fields"),
    };
  }

  /**
   * Marks a leased job running and counts the attempt (leased -> running).
   * Returns false when the row was not in 'leased' anymore — the caller then
   * decides whether it already owns a running row.
   */
  public async startLeasedJob(jobId: string, leaseId: string, now: string): Promise<boolean> {
    assertAutomationJobTransition("leased", "running");
    const result = await this.database.orm
      .update(automationJobs)
      .set({ status: "running", attempts: sql`${automationJobs.attempts} + 1`, updatedAt: now })
      .where(
        and(
          eq(automationJobs.id, jobId),
          eq(automationJobs.leaseId, leaseId),
          eq(automationJobs.status, "leased"),
          lt(automationJobs.attempts, AUTOMATION_MAX_STARTS),
        ),
      );
    return didChange(result);
  }

  /** Re-schedules a running job to wake at `dueAt` (running -> pending). */
  public async parkJobUntil(
    jobId: string,
    leaseId: string,
    input: {
      dueAt: string;
      payload: string;
      now: string;
      waitEventType?: string | null;
      waitResourceId?: string | null;
      waitStartedAt?: string | null;
    },
  ): Promise<void> {
    assertAutomationJobTransition("running", "pending");
    const orm = this.database.orm;
    const matchingEvent =
      input.waitEventType && input.waitStartedAt
        ? exists(
            orm
              .select({ id: contactEvents.id })
              .from(contactEvents)
              .where(
                and(
                  eq(contactEvents.workspaceId, automationJobs.workspaceId),
                  eq(contactEvents.contactId, automationJobs.contactId),
                  eq(contactEvents.type, input.waitEventType),
                  gte(contactEvents.occurredAt, input.waitStartedAt),
                  ...(input.waitResourceId === null || input.waitResourceId === undefined
                    ? []
                    : [eq(contactEvents.resourceId, input.waitResourceId)]),
                ),
              ),
          )
        : null;
    await orm
      .update(automationJobs)
      .set({
        status: "pending",
        attempts: 0,
        lastError: null,
        dueAt: matchingEvent
          ? sql`CASE WHEN ${matchingEvent} THEN ${input.now} ELSE ${input.dueAt} END`
          : input.dueAt,
        payload: input.payload,
        waitEventType: input.waitEventType ?? null,
        waitResourceId: input.waitResourceId ?? null,
        leaseId: null,
        leaseUntil: null,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(automationJobs.id, jobId),
          eq(automationJobs.leaseId, leaseId),
          eq(automationJobs.status, "running"),
        ),
      );
  }

  /**
   * Terminal node: succeeds the job and completes the enrollment in one
   * atomic batch (running -> succeeded). Every dependent write and the job
   * transition require the same current running lease.
   */
  public async completeJobClosingEnrollment(
    job: Pick<AutomationJobRow, "id" | "workspaceId" | "enrollmentId">,
    leaseId: string,
    now: string,
  ): Promise<void> {
    await new AutomationCompletionRepository(this.database).closeEnrollment(job, leaseId, now);
  }

  /**
   * Succeeds the job, inserts the follow-up job for the next node and moves
   * the enrollment cursor, atomically (running -> succeeded; the new job is
   * born 'pending'). The insert dedupes on the idempotency key so a replayed
   * completion never doubles the next step.
   */
  public async completeJobAdvancingEnrollment(
    job: Pick<
      AutomationJobRow,
      "id" | "workspaceId" | "enrollmentId" | "automationVersionId" | "contactId"
    >,
    leaseId: string,
    nextNodeId: string,
    now: string,
  ): Promise<void> {
    await new AutomationCompletionRepository(this.database).advanceEnrollment(
      job,
      leaseId,
      nextNodeId,
      now,
    );
  }
}
