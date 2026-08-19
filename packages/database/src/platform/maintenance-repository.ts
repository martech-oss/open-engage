import { and, asc, eq, isNull, lt, ne, sql } from "drizzle-orm";

import { contactEventOutbox, contactEvents, contacts } from "../contacts/schema";
import { deliveryEvents } from "../messaging/schema";
import { dailyMetrics } from "../reports/schema";
import { scoreEvents } from "../scoring/schema";
import { DatabaseRepository } from "../shared/repository-base";
import { idempotencyKeys } from "./schema";

/** Repository for the daily maintenance cron: event archival, metric rollup, key cleanup. */
export class MaintenanceRepository extends DatabaseRepository {
  public async findEventsToArchive(
    cutoff: string,
    limit = 1000,
  ): Promise<Array<Record<string, unknown>>> {
    const rows = await this.database.orm
      .select({
        id: contactEvents.id,
        workspaceId: contactEvents.workspaceId,
        contactId: contactEvents.contactId,
        visitorId: contactEvents.visitorId,
        type: contactEvents.type,
        resourceType: contactEvents.resourceType,
        resourceId: contactEvents.resourceId,
        properties: contactEvents.properties,
        occurredAt: contactEvents.occurredAt,
      })
      .from(contactEvents)
      .where(and(lt(contactEvents.occurredAt, cutoff), isNull(contactEvents.archivedAt)))
      .orderBy(asc(contactEvents.occurredAt))
      .limit(limit);
    return rows;
  }

  public async archiveEvents(eventIds: string[], now: string): Promise<void> {
    if (eventIds.length === 0) return;
    const [first, ...rest] = eventIds.map((id) =>
      this.database.orm
        .update(contactEvents)
        .set({ archivedAt: now })
        .where(and(eq(contactEvents.id, id), isNull(contactEvents.archivedAt))),
    );
    await this.database.orm.batch([first!, ...rest]);
  }

  /**
   * Rolls delivery_events for `day` up into daily_metrics, one row per
   * workspace. Identifiers are ${table.col} interpolations so renames stay
   * compiler-driven; the GROUP BY + upsert shape isn't expressible via the
   * query builder alone.
   */
  public async rollupDailyMetrics(day: string): Promise<void> {
    await this.database.orm.run(sql`
      INSERT INTO ${dailyMetrics}
        (${dailyMetrics.workspaceId}, ${dailyMetrics.metricDate}, ${dailyMetrics.dimensionType},
         ${dailyMetrics.dimensionId}, ${dailyMetrics.accepted}, ${dailyMetrics.delivered},
         ${dailyMetrics.opened}, ${dailyMetrics.clicked}, ${dailyMetrics.bounced},
         ${dailyMetrics.complained}, ${dailyMetrics.unsubscribed}, ${dailyMetrics.failed})
      SELECT ${deliveryEvents.workspaceId}, substr(${deliveryEvents.occurredAt}, 1, 10), 'workspace',
        ${deliveryEvents.workspaceId},
        SUM(${deliveryEvents.type} = 'accepted'), SUM(${deliveryEvents.type} = 'delivered'),
        SUM(${deliveryEvents.type} = 'opened'), SUM(${deliveryEvents.type} = 'clicked'),
        SUM(${deliveryEvents.type} = 'bounced'), SUM(${deliveryEvents.type} = 'complained'),
        SUM(${deliveryEvents.type} = 'unsubscribed'), SUM(${deliveryEvents.type} = 'failed')
      FROM ${deliveryEvents}
      WHERE substr(${deliveryEvents.occurredAt}, 1, 10) = ${day}
      GROUP BY ${deliveryEvents.workspaceId}, substr(${deliveryEvents.occurredAt}, 1, 10)
      ON CONFLICT(${dailyMetrics.workspaceId}, ${dailyMetrics.metricDate}, ${dailyMetrics.dimensionType}, ${dailyMetrics.dimensionId})
      DO UPDATE SET
        ${dailyMetrics.accepted} = excluded.accepted, ${dailyMetrics.delivered} = excluded.delivered,
        ${dailyMetrics.opened} = excluded.opened, ${dailyMetrics.clicked} = excluded.clicked,
        ${dailyMetrics.bounced} = excluded.bounced, ${dailyMetrics.complained} = excluded.complained,
        ${dailyMetrics.unsubscribed} = excluded.unsubscribed, ${dailyMetrics.failed} = excluded.failed
    `);
  }

  public async purgeExpiredIdempotencyKeys(now: string): Promise<void> {
    await this.database.orm.delete(idempotencyKeys).where(lt(idempotencyKeys.expiresAt, now));
  }

  public async purgeProcessedContactEventWork(cutoff: string): Promise<void> {
    await this.database.orm
      .delete(contactEventOutbox)
      .where(
        and(eq(contactEventOutbox.status, "processed"), lt(contactEventOutbox.processedAt, cutoff)),
      );
  }

  /**
   * Recomputes contacts.score from SUM(score_events.delta) for any contact
   * where the two have drifted, and returns how many rows were corrected.
   * contacts.score is the materialized total; score_events is an append-only
   * delta log with no stored running total of its own. The manual score-adjust
   * write path is two statements (not one atomic batch), so a concurrent
   * writer can in principle leave them inconsistent - this sweep is the
   * safety net. Contacts with no score events cannot have drifted from their
   * default 0, so the drift comparison alone already skips them.
   */
  public async reconcileContactScores(now: string): Promise<number> {
    const total = sql<number>`(SELECT COALESCE(SUM(${scoreEvents.delta}), 0) FROM ${scoreEvents}
      WHERE ${scoreEvents.workspaceId} = ${contacts.workspaceId}
        AND ${scoreEvents.contactId} = ${contacts.id})`;
    const result = await this.database.orm
      .update(contacts)
      .set({ score: total, updatedAt: now })
      .where(ne(contacts.score, total));
    return result.meta.changes;
  }
}
