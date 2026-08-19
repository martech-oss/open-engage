import { and, asc, count, eq, inArray, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import { subscriptionTopicRowSchema, type SubscriptionTopicRow } from "@openengage/core/consent";

import { contacts } from "../contacts/schema";
import { deliveries } from "../messaging/schema";
import { isConstraintError, nowIso } from "../shared/database-utils";
import { WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { consentEvents, contactSubscriptions, subscriptionTopics, suppressions } from "./schema";

export interface PreferenceCenterTopic {
  id: string;
  name: string;
  description: string;
  status: string;
}

export interface PreferenceCenterState {
  topics: PreferenceCenterTopic[];
  globallySuppressed: boolean;
}

export type TopicCreateOutcome = { kind: "conflict" } | { kind: "created"; id: string };

/** The raw reads behind the pre-send consent gate, one row (or count) each. */
export interface ConsentGateRows {
  contactStatus: string | null;
  suppressionReason: string | null;
  topicStatus: string | null;
  marketingSentInWindow: number;
}

/** Queries for subscription topics and consent state. */
export class ConsentRepository extends WorkspaceRepository {
  public async listTopics(): Promise<SubscriptionTopicRow[]> {
    const rows = await this.database.orm
      .select()
      .from(subscriptionTopics)
      .where(this.inWorkspace(subscriptionTopics))
      .orderBy(asc(subscriptionTopics.name));
    return rows.map((row) => subscriptionTopicRowSchema.parse(row));
  }

  public async createTopic(input: {
    name: string;
    slug: string;
    description: string;
    isDefault: boolean;
  }): Promise<TopicCreateOutcome> {
    const id = uuidv7();
    const now = nowIso();
    try {
      await this.database.orm.insert(subscriptionTopics).values({
        id,
        workspaceId: this.context.workspaceId,
        name: input.name,
        slug: input.slug,
        description: input.description,
        isDefault: input.isDefault,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      if (!isConstraintError(error)) throw error;
      // The only constraint on this insert is unique(workspace_id, slug).
      return { kind: "conflict" };
    }
    return { kind: "created", id };
  }

  /**
   * Loads everything the visitor-facing preference center renders in one
   * atomic D1 batch: every topic joined to this contact's subscription status
   * (defaulting to "unsubscribed" when no row exists), and whether the
   * contact is globally suppressed.
   */
  public async readPreferenceCenterState(contactId: string): Promise<PreferenceCenterState> {
    const workspaceId = this.context.workspaceId;
    const orm = this.database.orm;
    const [topicRows, suppressionRows] = await orm.batch([
      orm
        .select({
          id: subscriptionTopics.id,
          name: subscriptionTopics.name,
          description: subscriptionTopics.description,
          status: sql<string>`coalesce(${contactSubscriptions.status}, 'unsubscribed')`,
        })
        .from(subscriptionTopics)
        .leftJoin(
          contactSubscriptions,
          and(
            eq(contactSubscriptions.workspaceId, subscriptionTopics.workspaceId),
            eq(contactSubscriptions.topicId, subscriptionTopics.id),
            eq(contactSubscriptions.contactId, contactId),
          ),
        )
        .where(eq(subscriptionTopics.workspaceId, workspaceId))
        .orderBy(asc(subscriptionTopics.name)),
      orm
        .select({ id: suppressions.id })
        .from(suppressions)
        .where(
          and(
            eq(suppressions.workspaceId, workspaceId),
            eq(suppressions.contactId, contactId),
            eq(suppressions.reason, "global_unsubscribe"),
          ),
        )
        .limit(1),
    ]);
    return { topics: topicRows, globallySuppressed: suppressionRows.length > 0 };
  }

  /**
   * Applies a one-click unsubscribe atomically (one D1 batch): a
   * global-unsubscribe suppression (ignored if one already exists — nothing
   * else on this table is unique for this insert, matching the prior
   * `INSERT OR IGNORE`) plus the consent-event record.
   */
  public async applyOneClickUnsubscribe(contactId: string): Promise<void> {
    const workspaceId = this.context.workspaceId;
    const now = nowIso();
    const orm = this.database.orm;
    await orm.batch([
      orm
        .insert(suppressions)
        .values({
          id: uuidv7(),
          workspaceId,
          contactId,
          reason: "global_unsubscribe",
          createdAt: now,
        })
        .onConflictDoNothing(),
      orm.insert(consentEvents).values({
        id: uuidv7(),
        workspaceId,
        contactId,
        action: "unsubscribed",
        source: "one_click",
        createdAt: now,
      }),
    ]);
  }

  /**
   * Applies a preference-center save atomically (one D1 batch): one
   * upsert per workspace topic (subscribed/unsubscribed per the selection),
   * the global suppression insert-or-delete, and the consent-event record.
   */
  public async applyPreferenceCenterUpdate(input: {
    contactId: string;
    selectedTopicIds: string[];
    globalStop: boolean;
  }): Promise<void> {
    const workspaceId = this.context.workspaceId;
    const now = nowIso();
    const orm = this.database.orm;
    const selected = new Set(input.selectedTopicIds);
    const topics = await this.listTopics();
    const statements: BatchItem<"sqlite">[] = [];
    for (const topic of topics) {
      const status = selected.has(topic.id) ? "subscribed" : "unsubscribed";
      statements.push(
        orm
          .insert(contactSubscriptions)
          .values({
            workspaceId,
            contactId: input.contactId,
            topicId: topic.id,
            status,
            source: "preference_center",
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              contactSubscriptions.workspaceId,
              contactSubscriptions.contactId,
              contactSubscriptions.topicId,
            ],
            set: { status, source: "preference_center", updatedAt: now },
          }),
      );
    }
    statements.push(
      input.globalStop
        ? orm
            .insert(suppressions)
            .values({
              id: uuidv7(),
              workspaceId,
              contactId: input.contactId,
              reason: "global_unsubscribe",
              createdAt: now,
            })
            .onConflictDoNothing()
        : orm
            .delete(suppressions)
            .where(
              and(
                eq(suppressions.workspaceId, workspaceId),
                eq(suppressions.contactId, input.contactId),
                eq(suppressions.reason, "global_unsubscribe"),
              ),
            ),
    );
    statements.push(
      orm.insert(consentEvents).values({
        id: uuidv7(),
        workspaceId,
        contactId: input.contactId,
        action: input.globalStop ? "unsubscribed" : "granted",
        source: "preference_center",
        proof: JSON.stringify({ topics: [...selected] }),
        createdAt: now,
      }),
    );
    const [first, ...rest] = statements;
    if (first) await orm.batch([first, ...rest]);
  }

  /**
   * Loads everything the pre-send consent gate evaluates in one atomic D1
   * batch: contact status, any suppression (by contact or address), the topic
   * subscription, and the marketing sends of the trailing 24 hours. The
   * possibly-null contact and topic ids are compared as plain SQL templates so
   * a null binds NULL and simply matches nothing, exactly like the raw reads
   * this replaces.
   */
  public async readConsentGateRows(input: {
    contactId: string | null;
    recipient: string | null;
    topicId: string | null;
  }): Promise<ConsentGateRows> {
    const workspaceId = this.context.workspaceId;
    const orm = this.database.orm;
    const [contactRows, suppressionRows, subscriptionRows, frequencyRows] = await orm.batch([
      orm
        .select({ status: contacts.status })
        .from(contacts)
        .where(and(eq(contacts.workspaceId, workspaceId), sql`${contacts.id} = ${input.contactId}`))
        .limit(1),
      orm
        .select({ reason: suppressions.reason })
        .from(suppressions)
        .where(
          and(
            eq(suppressions.workspaceId, workspaceId),
            or(
              sql`${suppressions.contactId} = ${input.contactId}`,
              // Recipient can be null (PII scrubbed from an archived
              // contact's delivery) - "" never matches a real email, so this
              // deliberately falls through to contactId-only matching rather
              // than comparing against NULL, which SQL would never match
              // anyway but would read as intent to match unset emails.
              eq(suppressions.email, input.recipient ?? ""),
            ),
          ),
        )
        .limit(1),
      orm
        .select({ status: contactSubscriptions.status })
        .from(contactSubscriptions)
        .where(
          and(
            eq(contactSubscriptions.workspaceId, workspaceId),
            sql`${contactSubscriptions.contactId} = ${input.contactId}`,
            sql`${contactSubscriptions.topicId} = ${input.topicId}`,
          ),
        ),
      orm
        .select({ count: count() })
        .from(deliveries)
        .where(
          and(
            eq(deliveries.workspaceId, workspaceId),
            sql`${deliveries.contactId} = ${input.contactId}`,
            eq(deliveries.purpose, "marketing"),
            inArray(deliveries.status, ["accepted", "delivered"]),
            sql`${deliveries.createdAt} >= datetime('now', '-1 day')`,
          ),
        ),
    ]);
    return {
      contactStatus: contactRows[0]?.status ?? null,
      suppressionReason: suppressionRows[0]?.reason ?? null,
      topicStatus: subscriptionRows[0]?.status ?? null,
      marketingSentInWindow: frequencyRows[0]?.count ?? 0,
    };
  }
}
