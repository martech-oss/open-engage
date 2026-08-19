import {
  and,
  asc,
  eq,
  exists,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  notExists,
  or,
  sql,
} from "drizzle-orm";

import { automationDefinitionSchema } from "@openengage/core/automations";
import { jsonRecordSchema } from "@openengage/core/shared";

import type { DatabaseSource } from "../client";
import { contactEvents, contacts, contactTags, tags } from "../contacts/schema";
import { segmentMemberships } from "../segments/schema";
import { changedExactlyOne, didChange } from "../shared/database-utils";
import { decodeJson, defineJsonCodec } from "../shared/json-codec";
import { DatabaseRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { AutomationCompletionRepository } from "./completion-repository";
import {
  assertAutomationJobTransition,
  AUTOMATION_MAX_STARTS,
  AUTOMATION_CONTACT_COLUMNS,
  type AutomationContactColumn,
  type AutomationJobRow,
} from "./engine-support";
import {
  automationEnrollments,
  automationJobs,
  automations,
  automationTriggers,
  automationVersions,
} from "./schema";

export type {
  AutomationContactColumn,
  AutomationJobRow,
  AutomationJobStatus,
} from "./engine-support";
export { AUTOMATION_MAX_STARTS } from "./engine-support";

const graphCodec = defineJsonCodec(automationDefinitionSchema, "automation_versions.graph");

/**
 * Worker-side store for the automation engine. Deliberately unscoped: the
 * dispatcher scans and claims jobs across every workspace, and the queue
 * consumer locates a job by (id, lease id) alone — the workspace always comes
 * from the claimed row itself, never from a session.
 *
 * Contact/tag/segment mutations here implement automation-action semantics
 * (no archived-contact guard, membership source 'automation'), which is why
 * they exist alongside the stricter ContactResourceRepository methods.
 */
export class AutomationEngineRepository extends DatabaseRepository {
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
        graph: automationVersions.graph,
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

  /** Decision nodes: has the contact produced this event since this job began? */
  public async hasContactEventSince(
    workspaceId: string,
    contactId: string,
    type: string,
    since: string,
    resourceId: string | null,
  ): Promise<boolean> {
    const conditions = [
      eq(contactEvents.workspaceId, workspaceId),
      eq(contactEvents.contactId, contactId),
      eq(contactEvents.type, type),
      gte(contactEvents.occurredAt, since),
    ];
    if (resourceId !== null) conditions.push(eq(contactEvents.resourceId, resourceId));
    const row = await this.database.orm
      .select({ id: contactEvents.id })
      .from(contactEvents)
      .where(and(...conditions))
      .limit(1)
      .get();
    return row !== undefined;
  }

  /** New matching events make parked decision jobs immediately claimable. */
  public async wakeWaitingDecisionJobs(input: {
    workspaceId: string;
    contactId: string;
    eventType: string;
    resourceId: string | null;
    occurredAt: string;
    now: string;
  }): Promise<void> {
    const resourceMatches =
      input.resourceId === null
        ? isNull(automationJobs.waitResourceId)
        : or(
            isNull(automationJobs.waitResourceId),
            eq(automationJobs.waitResourceId, input.resourceId),
          );
    await this.database.orm
      .update(automationJobs)
      .set({
        dueAt: sql`CASE WHEN ${automationJobs.dueAt} > ${input.now} THEN ${input.now} ELSE ${automationJobs.dueAt} END`,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(automationJobs.status, "pending"),
          eq(automationJobs.workspaceId, input.workspaceId),
          eq(automationJobs.contactId, input.contactId),
          eq(automationJobs.waitEventType, input.eventType),
          lte(automationJobs.createdAt, input.occurredAt),
          resourceMatches,
        ),
      );
  }

  /** Condition nodes: does the contact carry a tag with this slug? */
  public async contactHasTagWithSlug(
    workspaceId: string,
    contactId: string,
    slug: string,
  ): Promise<boolean> {
    const row = await this.database.orm
      .select({ value: sql`1` })
      .from(contactTags)
      .innerJoin(tags, eq(tags.id, contactTags.tagId))
      .where(
        and(
          eq(contactTags.workspaceId, workspaceId),
          eq(contactTags.contactId, contactId),
          eq(tags.slug, slug),
        ),
      )
      .limit(1)
      .get();
    return row !== undefined;
  }

  /** add_tag action: links the tag, keeping an existing link as-is. */
  public async addContactTag(
    workspaceId: string,
    contactId: string,
    tagId: string,
    now: string,
  ): Promise<void> {
    await this.database.orm
      .insert(contactTags)
      .values({ workspaceId, contactId, tagId, createdAt: now })
      .onConflictDoNothing();
  }

  /** remove_tag action: unlinks the tag. */
  public async removeContactTag(
    workspaceId: string,
    contactId: string,
    tagId: string,
  ): Promise<void> {
    await this.database.orm
      .delete(contactTags)
      .where(
        and(
          eq(contactTags.workspaceId, workspaceId),
          eq(contactTags.contactId, contactId),
          eq(contactTags.tagId, tagId),
        ),
      );
  }

  /**
   * add_segment action: joins the contact with source 'automation'. Returns
   * whether a row was written, so the caller can emit `segment_joined` only
   * on a fresh membership.
   */
  public async addAutomationSegmentMembership(
    workspaceId: string,
    segmentId: string,
    contactId: string,
    now: string,
  ): Promise<boolean> {
    const result = await this.database.orm
      .insert(segmentMemberships)
      .values({ workspaceId, segmentId, contactId, source: "automation", joinedAt: now })
      .onConflictDoNothing();
    return changedExactlyOne(result);
  }

  /** remove_segment action: removes the membership regardless of its source. */
  public async removeSegmentMembership(
    workspaceId: string,
    segmentId: string,
    contactId: string,
  ): Promise<void> {
    await this.database.orm
      .delete(segmentMemberships)
      .where(
        and(
          eq(segmentMemberships.workspaceId, workspaceId),
          eq(segmentMemberships.segmentId, segmentId),
          eq(segmentMemberships.contactId, contactId),
        ),
      );
  }

  /** update_field action targeting one of the known contact columns. */
  public async updateContactColumn(
    workspaceId: string,
    contactId: string,
    column: AutomationContactColumn,
    value: string,
    now: string,
  ): Promise<void> {
    const assignments: {
      firstName?: string;
      lastName?: string;
      phone?: string;
      stage?: string;
      externalId?: string;
      updatedAt: string;
    } = { updatedAt: now };
    assignments[AUTOMATION_CONTACT_COLUMNS[column]] = value;
    await this.database.orm
      .update(contacts)
      .set(assignments)
      .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.id, contactId)));
  }

  /** update_field action targeting a custom field: stores the merged JSON. */
  public async replaceContactCustomFields(
    workspaceId: string,
    contactId: string,
    customFields: string,
    now: string,
  ): Promise<void> {
    await this.database.orm
      .update(contacts)
      .set({ customFields, updatedAt: now })
      .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.id, contactId)));
  }

  /**
   * Cross-workspace scan for 'contact_inactive' triggers: active contacts of
   * active automations whose latest event (or creation) is at least
   * `inactivity_days` before `now`, excluding contacts already enrolled via
   * the "once" sentinel.
   */
  public async listInactiveEnrollmentCandidates(
    now: string,
    limit: number,
  ): Promise<
    Array<{
      automationVersionId: string;
      automationId: string;
      sourceNodeId: string;
      reentry: string;
      workspaceId: string;
      contactId: string;
    }>
  > {
    const orm = this.database.orm;
    return await orm
      .select({
        automationVersionId: automationTriggers.automationVersionId,
        automationId: automationTriggers.automationId,
        sourceNodeId: automationTriggers.sourceNodeId,
        reentry: automationTriggers.reentry,
        workspaceId: contacts.workspaceId,
        contactId: contacts.id,
      })
      .from(automationTriggers)
      .innerJoin(
        automations,
        and(
          eq(automations.workspaceId, automationTriggers.workspaceId),
          eq(automations.id, automationTriggers.automationId),
        ),
      )
      .innerJoin(contacts, eq(contacts.workspaceId, automationTriggers.workspaceId))
      .where(
        and(
          eq(automationTriggers.source, "contact_inactive"),
          eq(automations.status, "active"),
          eq(automations.publishedVersionId, automationTriggers.automationVersionId),
          eq(contacts.status, "active"),
          sql`julianday(COALESCE((
            SELECT MAX(${contactEvents.occurredAt}) FROM ${contactEvents}
            WHERE ${contactEvents.workspaceId} = ${contacts.workspaceId}
              AND ${contactEvents.contactId} = ${contacts.id}
          ), ${contacts.createdAt})) <= julianday(${now}) - ${automationTriggers.inactivityDays}`,
          notExists(
            orm
              .select({ value: sql`1` })
              .from(automationEnrollments)
              .where(
                and(
                  eq(automationEnrollments.workspaceId, automationTriggers.workspaceId),
                  eq(automationEnrollments.automationId, automationTriggers.automationId),
                  eq(automationEnrollments.contactId, contacts.id),
                  eq(automationEnrollments.sourceEventId, "once"),
                ),
              ),
          ),
        ),
      )
      .orderBy(asc(contacts.updatedAt))
      .limit(limit);
  }
}

/**
 * Legacy free-function entry point for the dispatcher; claims due pending
 * jobs across (or within) workspaces. Delegates to
 * {@link AutomationEngineRepository.claimDueJobs}.
 */
export async function claimDueJobs(
  database: DatabaseSource,
  now: string,
  leaseUntil: string,
  limit = 100,
  workspaceId?: string,
): Promise<Array<{ id: string; leaseId: string }>> {
  return new AutomationEngineRepository(database).claimDueJobs(now, leaseUntil, limit, workspaceId);
}
