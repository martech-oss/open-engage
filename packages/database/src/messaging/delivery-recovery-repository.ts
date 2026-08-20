import { and, asc, eq, isNull, lt, lte, or, sql } from "drizzle-orm";

import { channelMessageSchema, type ChannelMessage } from "@openengage/core/messaging";

import { suppressions } from "../consent/schema";
import { changedExactlyOne, nowIso } from "../shared/database-utils";
import { decodeJson } from "../shared/json-codec";
import { DatabaseRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { deliveries, deliveryEvents } from "./schema";

const DELIVERY_ATTEMPT_LIMIT = 5;
const DUE_DELIVERY_SCAN_LIMIT = 100;

export interface DeliveryLeaseRecord {
  id: string;
  workspaceId: string;
  contactId: string | null;
  channel: "email" | "webhook";
  purpose: "transactional" | "marketing";
  provider: "cloudflare" | "webhook";
  recipient: string | null;
  topicId: string | null;
  idempotencyKey: string;
  payload: ChannelMessage;
  attempts: number;
  leaseId: string;
}

/** Exact-lease state transitions and stale-send recovery for deliveries. */
export class DeliveryRecoveryRepository extends DatabaseRepository {
  public async claimDelivery(
    deliveryId: string,
    now = nowIso(),
    leaseExpiresAt = new Date(Date.now() + 5 * 60_000).toISOString(),
  ): Promise<DeliveryLeaseRecord | null> {
    const leaseId = uuidv7();
    const [row] = await this.database.orm
      .update(deliveries)
      .set({
        status: "sending",
        attempts: sql`${deliveries.attempts} + 1`,
        leaseId,
        leaseExpiresAt,
        nextAttemptAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(deliveries.id, deliveryId),
          eq(deliveries.status, "queued"),
          lt(deliveries.attempts, DELIVERY_ATTEMPT_LIMIT),
          or(isNull(deliveries.nextAttemptAt), lte(deliveries.nextAttemptAt, now)),
        ),
      )
      .returning({
        id: deliveries.id,
        workspaceId: deliveries.workspaceId,
        contactId: deliveries.contactId,
        channel: deliveries.channel,
        purpose: deliveries.purpose,
        provider: deliveries.provider,
        recipient: deliveries.recipient,
        topicId: deliveries.topicId,
        idempotencyKey: deliveries.idempotencyKey,
        payload: deliveries.payload,
        attempts: deliveries.attempts,
      });
    if (!row) return null;
    return {
      ...row,
      channel: row.channel as DeliveryLeaseRecord["channel"],
      purpose: row.purpose as DeliveryLeaseRecord["purpose"],
      provider: row.provider as DeliveryLeaseRecord["provider"],
      payload: decodeJson(row.payload, channelMessageSchema, "deliveries.payload"),
      leaseId,
    };
  }

  public async markSuppressed(
    deliveryId: string,
    leaseId: string,
    reason: string,
  ): Promise<boolean> {
    const result = await this.database.orm
      .update(deliveries)
      .set({
        status: "suppressed",
        lastError: reason,
        nextAttemptAt: null,
        leaseId: null,
        leaseExpiresAt: null,
        updatedAt: nowIso(),
      })
      .where(exactDeliveryLease(deliveryId, leaseId));
    return changedExactlyOne(result);
  }

  public async markProviderSuppressed(deliveryId: string, leaseId: string): Promise<boolean> {
    const now = nowIso();
    const exactLease = exactDeliveryLease(deliveryId, leaseId);
    const orm = this.database.orm;
    const [, result] = await orm.batch([
      orm
        .insert(suppressions)
        .select(
          orm
            .select({
              id: sql<string>`${uuidv7()}`.as("id"),
              workspaceId: deliveries.workspaceId,
              contactId: deliveries.contactId,
              email: deliveries.recipient,
              reason: sql<string>`'provider'`.as("reason"),
              provider: sql<string>`'cloudflare'`.as("provider"),
              createdAt: sql<string>`${now}`.as("created_at"),
            })
            .from(deliveries)
            .where(exactLease),
        )
        .onConflictDoNothing(),
      orm
        .update(deliveries)
        .set({
          status: "suppressed",
          lastError: "provider_suppressed",
          nextAttemptAt: null,
          leaseId: null,
          leaseExpiresAt: null,
          updatedAt: now,
        })
        .where(exactLease),
    ]);
    return changedExactlyOne(result);
  }

  /** Accepted state and its event commit together, and only for this lease. */
  public async markAccepted(input: {
    deliveryId: string;
    leaseId: string;
    providerMessageId: string;
    acceptedAt: string;
  }): Promise<boolean> {
    const now = nowIso();
    const exactLease = exactDeliveryLease(input.deliveryId, input.leaseId);
    const orm = this.database.orm;
    const [, result] = await orm.batch([
      orm
        .insert(deliveryEvents)
        .select(
          orm
            .select({
              id: sql<string>`${uuidv7()}`.as("id"),
              workspaceId: deliveries.workspaceId,
              deliveryId: deliveries.id,
              provider: deliveries.provider,
              providerEventId: sql<string>`${`accepted:${input.deliveryId}`}`.as(
                "provider_event_id",
              ),
              providerMessageId: sql<string>`${input.providerMessageId}`.as("provider_message_id"),
              type: sql<string>`'accepted'`.as("type"),
              occurredAt: sql<string>`${input.acceptedAt}`.as("occurred_at"),
              metadata: sql<string>`'{}'`.as("metadata"),
              archivedAt: sql<string | null>`NULL`.as("archived_at"),
              createdAt: sql<string>`${now}`.as("created_at"),
            })
            .from(deliveries)
            .where(exactLease),
        )
        .onConflictDoNothing(),
      orm
        .update(deliveries)
        .set({
          status: "accepted",
          providerMessageId: input.providerMessageId,
          lastError: null,
          nextAttemptAt: null,
          leaseId: null,
          leaseExpiresAt: null,
          updatedAt: now,
        })
        .where(exactLease),
    ]);
    return changedExactlyOne(result);
  }

  public async recordFailure(
    deliveryId: string,
    leaseId: string,
    input: { status: "queued" | "failed"; nextAttemptAt: string | null; lastError: string },
  ): Promise<boolean> {
    const result = await this.database.orm
      .update(deliveries)
      .set({
        status: input.status,
        nextAttemptAt: input.nextAttemptAt,
        lastError: input.lastError,
        leaseId: null,
        leaseExpiresAt: null,
        updatedAt: nowIso(),
      })
      .where(exactDeliveryLease(deliveryId, leaseId));
    return changedExactlyOne(result);
  }

  public async recoverExpiredDeliveries(now: string): Promise<void> {
    const orm = this.database.orm;
    await orm.batch([
      orm
        .update(deliveries)
        .set({
          status: "queued",
          nextAttemptAt: null,
          lastError: "lease_expired",
          leaseId: null,
          leaseExpiresAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(deliveries.status, "sending"),
            eq(deliveries.channel, "webhook"),
            lt(deliveries.attempts, DELIVERY_ATTEMPT_LIMIT),
            lte(deliveries.leaseExpiresAt, now),
          ),
        ),
      orm
        .update(deliveries)
        .set({
          status: "failed",
          nextAttemptAt: null,
          lastError: "attempts_exhausted",
          leaseId: null,
          leaseExpiresAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(deliveries.status, "sending"),
            eq(deliveries.channel, "webhook"),
            lte(deliveries.leaseExpiresAt, now),
          ),
        ),
      orm
        .update(deliveries)
        .set({
          status: "failed",
          nextAttemptAt: null,
          lastError: "outcome_unknown",
          leaseId: null,
          leaseExpiresAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(deliveries.status, "sending"),
            eq(deliveries.channel, "email"),
            lte(deliveries.leaseExpiresAt, now),
          ),
        ),
    ]);
  }

  public async scanDueDeliveries(now: string): Promise<Array<{ id: string }>> {
    return this.database.orm
      .select({ id: deliveries.id })
      .from(deliveries)
      .where(
        and(
          eq(deliveries.status, "queued"),
          lt(deliveries.attempts, DELIVERY_ATTEMPT_LIMIT),
          or(isNull(deliveries.nextAttemptAt), lte(deliveries.nextAttemptAt, now)),
        ),
      )
      .orderBy(asc(deliveries.createdAt))
      .limit(DUE_DELIVERY_SCAN_LIMIT);
  }
}

function exactDeliveryLease(deliveryId: string, leaseId: string) {
  return and(
    eq(deliveries.id, deliveryId),
    eq(deliveries.status, "sending"),
    eq(deliveries.leaseId, leaseId),
  );
}
