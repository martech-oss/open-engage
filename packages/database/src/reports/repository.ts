import { sql, type SQL } from "drizzle-orm";

import type { ReportDateRange as CoreReportDateRange } from "@openengage/core/reports";

import { user } from "../auth/schema";
import { automationEnrollments, automations } from "../automations/schema";
import { contactEvents, contacts, contactTags, tags } from "../contacts/schema";
import { dealStages, dealTasks, deals } from "../deals/schema";
import { deliveries, deliveryEvents, emailTemplates } from "../messaging/schema";
import { segmentMemberships, segments } from "../segments/schema";
import { nowIso } from "../shared/database-utils";
import { DatabaseRepository } from "../shared/repository-base";
import { formSubmissions, forms, projectBriefs, projects, siteMessages } from "../web/schema";

/**
 * Every report query in this repository is composed with drizzle's `sql`
 * tagged template using `${table.column}` / `${table}` interpolations for
 * every physical identifier, never string literals - so a future column or
 * table rename (via drizzle-kit) shows up here as a type error instead of a
 * silently-wrong query.
 *
 * Two things are deliberately NOT interpolated as schema references:
 *  - Output aliases (`AS created`, `AS won_value`, CTE-local names like
 *    `day`) and later references to those aliases in GROUP BY / ORDER BY -
 *    they are not physical columns, so there is nothing to make rename-safe.
 *  - Hardcoded SQL string/number literals that were never bound as `?`
 *    params in the original hand-written SQL (e.g. `= 'open'`,
 *    `'unassigned'`, `LIMIT 20`) stay inline for a byte-identical query;
 *    values that WERE bound (workspace id, date ranges, currency) become
 *    `${value}` interpolations, which drizzle parameter-binds exactly like
 *    the original `.bind()` calls did.
 *
 * None of these queries alias their tables (`deals d`, `user u`, ...); every
 * reference uses the table's real name instead. This sidesteps a documented
 * drizzle@0.45 pitfall where builder-shape column references (e.g. fields
 * produced by `.select({ x: sql\`...\`.as(...) })` or CTE/subquery builder
 * columns) can render unqualified. Plain `${table.column}` interpolation in a
 * hand-composed `sql` template does not: drizzle's chunk renderer qualifies a
 * `Column` chunk using that column's own declared table, unconditionally,
 * regardless of where in the query it appears - verified directly against
 * this repo's drizzle-orm@0.45.2 by inspecting `SQLiteRaw.getQuery()` output
 * for representative joins, a 3-way UNION ALL CTE, and (as a diagnostic) a
 * correlated scalar subquery in SELECT-column position; all rendered fully
 * table-qualified. Since none of these reports self-join a table, dropping
 * aliases entirely and always referencing the real table name is both safe
 * and simpler than reproducing per-query aliases.
 *
 * Every query below executes as a standalone `database.orm.all(sql\`...\`)` -
 * never through `OpenEngageDatabase.prepare()`/`.batch()`/`nativeStatement()` -
 * because those exist only to run hand-typed `?`-placeholder SQL strings and
 * are being retired once nothing depends on them (see
 * apps/server/test/no-raw-sql.test.ts). `runBatch()` below fires several such
 * queries with `Promise.all`, which is NOT the same atomic unit the original
 * `database.batch([...])` call was: D1 runs a real `.batch()` as one
 * sequential, all-or-nothing unit, while `Promise.all` just runs independent
 * requests concurrently. This is a deliberate, disclosed trade rather than an
 * oversight: `database.orm.batch([...])` - the drizzle-native batch entry
 * point - cannot run these queries at all. drizzle-orm@0.45.2's D1 session
 * `batch()` assumes every item's `._prepare()` returns a query-builder-
 * produced `D1PreparedQuery` (which carries a `.stmt`); a raw sql-tag
 * `.all(...)`/`.get(...)`/`.run(...)` call instead returns a `SQLiteRaw`
 * whose `._prepare()` is an identity no-op with no `.stmt`, so
 * `session.batch()` throws "Cannot read properties of undefined (reading
 * 'bind')" the moment any batched item is a raw `sql` statement carrying a
 * bound param - reproduced here against this repo's real D1 binding
 * (vitest-pool-workers), for every query in this file. The query-builder
 * (`.select().from()...`) doesn't have that bug and other repositories in
 * this codebase batch through it freely, but it can't stand in for
 * hand-composed CTEs/UNION ALL without either losing rename-safe identifiers
 * or wrapping each query with an explicit, hand-maintained output-column
 * list (`.from(sql\`(...)\`)` alone compiles to an empty, invalid select
 * list - confirmed directly). Since these are read-only reporting queries,
 * not writes, losing D1's cross-statement atomicity is an acceptable,
 * bounded trade for staying on supported APIs; a follow-up could revisit
 * this if per-report round-trip count ever matters.
 */
type ReportRow = Record<string, unknown>;

/** The core `{ from, to }` range, plus the timestamp bounds these SQL templates bind directly. */
export interface ReportDateRange extends CoreReportDateRange {
  fromTimestamp: string;
  toExclusiveTimestamp: string;
}

export interface DealsSummaryData {
  summary: ReportRow;
  trend: ReportRow[];
  owners: ReportRow[];
  forecast: ReportRow[];
  taskSummary: ReportRow;
}

export interface ContactsSummaryData {
  summary: ReportRow;
  trend: ReportRow[];
  topTags: ReportRow[];
  topSegments: ReportRow[];
}

export interface AutomationsSummaryData {
  automations: ReportRow[];
  trend: ReportRow[];
}

export interface EmailsSummaryData {
  summary: ReportRow;
  trend: ReportRow[];
  sources: ReportRow[];
}

export interface SiteSummaryData {
  pageSummary: ReportRow;
  formSummary: ReportRow;
  trend: ReportRow[];
  topPages: ReportRow[];
  forms: ReportRow[];
  messages: ReportRow[];
}

export interface DashboardSummaryData {
  contacts: ReportRow;
  automations: ReportRow;
  briefs: ReportRow;
  deliveries: ReportRow;
  events: ReportRow[];
}

/** Cross-domain read-only aggregation queries backing `/reports/*` and `/dashboard`. */
export class ReportsRepository extends DatabaseRepository {
  /**
   * Runs several independent read-only queries concurrently. Generic over the
   * tuple of queries passed in so each destructured result is `ReportRow[]`
   * (not `ReportRow[] | undefined`) - the array length is fixed at every call
   * site, so callers can safely destructure by position. See the class-level
   * comment for why this is `Promise.all`, not a `database.orm.batch(...)`.
   */
  private async runBatch<T extends readonly SQL[]>(
    ...queries: T
  ): Promise<{ [K in keyof T]: ReportRow[] }> {
    const results = await Promise.all(
      queries.map((query) => this.database.orm.all<ReportRow>(query)),
    );
    return results as unknown as { [K in keyof T]: ReportRow[] };
  }

  /** Distinct currencies in use, for the currency picker and default selection. */
  public async listDealCurrencies(workspaceId: string): Promise<Array<{ currency: string }>> {
    return await this.database.orm.all<{ currency: string }>(sql`
      SELECT DISTINCT ${deals.currency} AS currency
      FROM ${deals}
      WHERE ${deals.workspaceId} = ${workspaceId} AND ${deals.archivedAt} IS NULL
      ORDER BY ${deals.currency}
    `);
  }

  /**
   * Summary, trend, owner breakdown, stage forecast, and task counters for one
   * workspace/currency/date-range - the same 5 statements the original
   * `database.batch([...])` call ran, now issued as 5 concurrent queries.
   */
  public async dealsSummary(
    workspaceId: string,
    range: ReportDateRange,
    currency: string,
  ): Promise<DealsSummaryData> {
    const now = nowIso();
    const [summaryRows, trendRows, ownerRows, forecastRows, taskRows] = await this.runBatch(
      sql`
        SELECT
          COUNT(CASE WHEN ${deals.createdAt} >= ${range.fromTimestamp} AND ${deals.createdAt} < ${range.toExclusiveTimestamp} THEN 1 END) AS created,
          COUNT(CASE WHEN ${deals.wonAt} >= ${range.fromTimestamp} AND ${deals.wonAt} < ${range.toExclusiveTimestamp} THEN 1 END) AS won,
          COUNT(CASE WHEN ${deals.lostAt} >= ${range.fromTimestamp} AND ${deals.lostAt} < ${range.toExclusiveTimestamp} THEN 1 END) AS lost,
          COALESCE(SUM(CASE WHEN ${deals.wonAt} >= ${range.fromTimestamp} AND ${deals.wonAt} < ${range.toExclusiveTimestamp} THEN ${deals.value} ELSE 0 END), 0)
            AS won_value,
          COUNT(CASE WHEN ${deals.status} = 'open' THEN 1 END) AS open_count,
          COALESCE(SUM(CASE WHEN ${deals.status} = 'open' THEN ${deals.value} ELSE 0 END), 0) AS open_value
        FROM ${deals}
        WHERE ${deals.workspaceId} = ${workspaceId} AND ${deals.archivedAt} IS NULL AND ${deals.currency} = ${currency}
      `,
      sql`
        WITH activity AS (
          SELECT date(${deals.createdAt}) AS day, 1 AS created, 0 AS won, 0 AS lost
          FROM ${deals}
          WHERE ${deals.workspaceId} = ${workspaceId} AND ${deals.archivedAt} IS NULL AND ${deals.currency} = ${currency}
            AND ${deals.createdAt} >= ${range.fromTimestamp} AND ${deals.createdAt} < ${range.toExclusiveTimestamp}
          UNION ALL
          SELECT date(${deals.wonAt}) AS day, 0 AS created, 1 AS won, 0 AS lost
          FROM ${deals}
          WHERE ${deals.workspaceId} = ${workspaceId} AND ${deals.archivedAt} IS NULL AND ${deals.currency} = ${currency}
            AND ${deals.wonAt} >= ${range.fromTimestamp} AND ${deals.wonAt} < ${range.toExclusiveTimestamp}
          UNION ALL
          SELECT date(${deals.lostAt}) AS day, 0 AS created, 0 AS won, 1 AS lost
          FROM ${deals}
          WHERE ${deals.workspaceId} = ${workspaceId} AND ${deals.archivedAt} IS NULL AND ${deals.currency} = ${currency}
            AND ${deals.lostAt} >= ${range.fromTimestamp} AND ${deals.lostAt} < ${range.toExclusiveTimestamp}
        )
        SELECT day, SUM(created) AS created, SUM(won) AS won, SUM(lost) AS lost
        FROM activity
        GROUP BY day
        ORDER BY day
      `,
      sql`
        SELECT
          COALESCE(${user.id}, 'unassigned') AS owner_id,
          COALESCE(${user.name}, '未設定') AS owner_name,
          COUNT(CASE WHEN ${deals.createdAt} >= ${range.fromTimestamp} AND ${deals.createdAt} < ${range.toExclusiveTimestamp} THEN 1 END) AS created,
          COUNT(CASE WHEN ${deals.wonAt} >= ${range.fromTimestamp} AND ${deals.wonAt} < ${range.toExclusiveTimestamp} THEN 1 END) AS won,
          COUNT(CASE WHEN ${deals.lostAt} >= ${range.fromTimestamp} AND ${deals.lostAt} < ${range.toExclusiveTimestamp} THEN 1 END) AS lost,
          COALESCE(SUM(CASE
            WHEN ${deals.wonAt} >= ${range.fromTimestamp} AND ${deals.wonAt} < ${range.toExclusiveTimestamp} THEN ${deals.value} ELSE 0
          END), 0) AS won_value,
          COUNT(CASE WHEN ${deals.status} = 'open' THEN 1 END) AS open_count
        FROM ${deals}
        LEFT JOIN ${user} ON ${user.id} = ${deals.ownerUserId}
        WHERE ${deals.workspaceId} = ${workspaceId} AND ${deals.archivedAt} IS NULL AND ${deals.currency} = ${currency}
        GROUP BY owner_id, owner_name
        ORDER BY won_value DESC, won DESC, owner_name ASC
      `,
      sql`
        SELECT
          ${dealStages.id} AS stage_id,
          ${dealStages.name} AS stage_name,
          ${dealStages.color},
          ${dealStages.probability},
          COUNT(${deals.id}) AS deal_count,
          COALESCE(SUM(${deals.value}), 0) AS deal_value,
          COALESCE(SUM(${deals.value} * ${dealStages.probability} / 100.0), 0) AS weighted_value
        FROM ${dealStages}
        JOIN ${deals}
          ON ${deals.workspaceId} = ${dealStages.workspaceId} AND ${deals.stageId} = ${dealStages.id}
        WHERE ${deals.workspaceId} = ${workspaceId} AND ${deals.archivedAt} IS NULL
          AND ${deals.status} = 'open' AND ${deals.currency} = ${currency}
          AND ${deals.expectedCloseDate} >= ${range.from} AND ${deals.expectedCloseDate} <= ${range.to}
        GROUP BY ${dealStages.id}
        ORDER BY ${dealStages.position}
      `,
      sql`
        SELECT
          COUNT(CASE WHEN ${dealTasks.status} = 'open' THEN 1 END) AS open_tasks,
          COUNT(CASE WHEN ${dealTasks.status} = 'open' AND ${dealTasks.dueAt} < ${now} THEN 1 END) AS overdue_tasks,
          COUNT(CASE WHEN ${dealTasks.completedAt} >= ${range.fromTimestamp} AND ${dealTasks.completedAt} < ${range.toExclusiveTimestamp} THEN 1 END)
            AS completed_tasks
        FROM ${dealTasks}
        WHERE ${dealTasks.workspaceId} = ${workspaceId}
      `,
    );
    return {
      summary: summaryRows[0] ?? {},
      trend: trendRows,
      owners: ownerRows,
      forecast: forecastRows,
      taskSummary: taskRows[0] ?? {},
    };
  }

  /** Summary, trend, top tags, and top static segments - 4 independent queries run concurrently. */
  public async contactsSummary(
    workspaceId: string,
    range: ReportDateRange,
  ): Promise<ContactsSummaryData> {
    const [summaryRows, trendRows, topTagRows, topSegmentRows] = await this.runBatch(
      sql`
        SELECT
          COUNT(*) AS total_contacts,
          COUNT(CASE WHEN ${contacts.status} = 'active' THEN 1 END) AS active_contacts,
          COUNT(CASE WHEN ${contacts.status} != 'active' THEN 1 END) AS inactive_contacts,
          COUNT(CASE WHEN ${contacts.status} = 'anonymous' THEN 1 END) AS anonymous_contacts,
          COUNT(CASE WHEN ${contacts.createdAt} >= ${range.fromTimestamp} AND ${contacts.createdAt} < ${range.toExclusiveTimestamp} THEN 1 END) AS new_contacts,
          COUNT(CASE WHEN ${contacts.archivedAt} >= ${range.fromTimestamp} AND ${contacts.archivedAt} < ${range.toExclusiveTimestamp} THEN 1 END) AS archived_contacts
        FROM ${contacts}
        WHERE ${contacts.workspaceId} = ${workspaceId}
      `,
      sql`
        WITH contact_changes AS (
          SELECT date(${contacts.createdAt}) AS day, 1 AS added, 0 AS archived
          FROM ${contacts}
          WHERE ${contacts.workspaceId} = ${workspaceId} AND ${contacts.createdAt} >= ${range.fromTimestamp} AND ${contacts.createdAt} < ${range.toExclusiveTimestamp}
          UNION ALL
          SELECT date(${contacts.archivedAt}) AS day, 0 AS added, 1 AS archived
          FROM ${contacts}
          WHERE ${contacts.workspaceId} = ${workspaceId} AND ${contacts.archivedAt} >= ${range.fromTimestamp} AND ${contacts.archivedAt} < ${range.toExclusiveTimestamp}
        )
        SELECT day, SUM(added) AS added, SUM(archived) AS archived
        FROM contact_changes
        GROUP BY day
        ORDER BY day
      `,
      sql`
        SELECT ${tags.id}, ${tags.name}, ${tags.color},
               COUNT(${contacts.id}) AS contact_count
        FROM ${tags}
        LEFT JOIN ${contactTags}
          ON ${contactTags.workspaceId} = ${tags.workspaceId} AND ${contactTags.tagId} = ${tags.id}
        LEFT JOIN ${contacts}
          ON ${contacts.workspaceId} = ${contactTags.workspaceId} AND ${contacts.id} = ${contactTags.contactId}
             AND ${contacts.status} = 'active'
        WHERE ${tags.workspaceId} = ${workspaceId}
        GROUP BY ${tags.id}
        ORDER BY contact_count DESC, ${tags.name} ASC
        LIMIT 10
      `,
      sql`
        SELECT ${segments.id}, ${segments.name}, '#64748b' AS color,
               COUNT(CASE WHEN ${contacts.status} = 'active' THEN 1 END) AS contact_count
        FROM ${segments}
        LEFT JOIN ${segmentMemberships}
          ON ${segmentMemberships.workspaceId} = ${segments.workspaceId} AND ${segmentMemberships.segmentId} = ${segments.id}
            AND ${segmentMemberships.source} = 'static'
        LEFT JOIN ${contacts}
          ON ${contacts.workspaceId} = ${segmentMemberships.workspaceId} AND ${contacts.id} = ${segmentMemberships.contactId}
        WHERE ${segments.workspaceId} = ${workspaceId} AND ${segments.kind} = 'static'
        GROUP BY ${segments.id}
        ORDER BY contact_count DESC, ${segments.name} ASC
        LIMIT 10
      `,
    );
    return {
      summary: summaryRows[0] ?? {},
      trend: trendRows,
      topTags: topTagRows,
      topSegments: topSegmentRows,
    };
  }

  /** Per-automation funnel plus entries/completions trend - 2 independent queries run concurrently. */
  public async automationsSummary(
    workspaceId: string,
    range: ReportDateRange,
  ): Promise<AutomationsSummaryData> {
    const [automationRows, trendRows] = await this.runBatch(
      sql`
        SELECT
          ${automations.id}, ${automations.name}, ${automations.status},
          COUNT(DISTINCT CASE
            WHEN ${automationEnrollments.enteredAt} >= ${range.fromTimestamp} AND ${automationEnrollments.enteredAt} < ${range.toExclusiveTimestamp} THEN ${automationEnrollments.id}
          END) AS entries,
          COUNT(DISTINCT CASE
            WHEN ${automationEnrollments.completedAt} >= ${range.fromTimestamp} AND ${automationEnrollments.completedAt} < ${range.toExclusiveTimestamp} THEN ${automationEnrollments.id}
          END) AS completions,
          COUNT(DISTINCT CASE
            WHEN ${automationEnrollments.status} = 'active' THEN ${automationEnrollments.id}
          END) AS active_contacts,
          COUNT(DISTINCT CASE
            WHEN ${deliveries.createdAt} >= ${range.fromTimestamp} AND ${deliveries.createdAt} < ${range.toExclusiveTimestamp} AND ${deliveries.channel} = 'email'
              AND ${deliveries.status} IN ('accepted', 'delivered', 'failed') THEN ${deliveries.id}
          END) AS sends,
          COUNT(DISTINCT CASE
            WHEN ${deliveries.createdAt} >= ${range.fromTimestamp} AND ${deliveries.createdAt} < ${range.toExclusiveTimestamp}
              AND ${deliveries.channel} = 'email'
              AND ${deliveries.status} IN ('accepted', 'delivered', 'failed')
              AND ${deliveryEvents.type} = 'opened' THEN ${deliveries.id}
          END) AS opens,
          COUNT(DISTINCT CASE
            WHEN ${deliveries.createdAt} >= ${range.fromTimestamp} AND ${deliveries.createdAt} < ${range.toExclusiveTimestamp}
              AND ${deliveries.channel} = 'email'
              AND ${deliveries.status} IN ('accepted', 'delivered', 'failed')
              AND ${deliveryEvents.type} = 'clicked' THEN ${deliveries.id}
          END) AS clicks
        FROM ${automations}
        LEFT JOIN ${automationEnrollments}
          ON ${automationEnrollments.workspaceId} = ${automations.workspaceId} AND ${automationEnrollments.automationId} = ${automations.id}
        LEFT JOIN ${deliveries}
          ON ${deliveries.workspaceId} = ${automationEnrollments.workspaceId} AND ${deliveries.enrollmentId} = ${automationEnrollments.id}
        LEFT JOIN ${deliveryEvents}
          ON ${deliveryEvents.workspaceId} = ${deliveries.workspaceId} AND ${deliveryEvents.deliveryId} = ${deliveries.id}
        WHERE ${automations.workspaceId} = ${workspaceId} AND ${automations.status} != 'archived'
        GROUP BY ${automations.id}
        ORDER BY entries DESC, ${automations.updatedAt} DESC
      `,
      sql`
        WITH activity AS (
          SELECT date(${automationEnrollments.enteredAt}) AS day, 1 AS entries, 0 AS completions
          FROM ${automationEnrollments}
          WHERE ${automationEnrollments.workspaceId} = ${workspaceId} AND ${automationEnrollments.enteredAt} >= ${range.fromTimestamp} AND ${automationEnrollments.enteredAt} < ${range.toExclusiveTimestamp}
          UNION ALL
          SELECT date(${automationEnrollments.completedAt}) AS day, 0 AS entries, 1 AS completions
          FROM ${automationEnrollments}
          WHERE ${automationEnrollments.workspaceId} = ${workspaceId} AND ${automationEnrollments.completedAt} >= ${range.fromTimestamp} AND ${automationEnrollments.completedAt} < ${range.toExclusiveTimestamp}
        )
        SELECT day, SUM(entries) AS entries, SUM(completions) AS completions
        FROM activity
        GROUP BY day
        ORDER BY day
      `,
    );
    return { automations: automationRows, trend: trendRows };
  }

  /** Summary, trend, and per-source breakdown - 3 independent queries run concurrently. */
  public async emailsSummary(
    workspaceId: string,
    range: ReportDateRange,
  ): Promise<EmailsSummaryData> {
    const [summaryRows, trendRows, sourceRows] = await this.runBatch(
      sql`
        SELECT
          COUNT(DISTINCT ${deliveries.id}) AS sends,
          COUNT(DISTINCT CASE
            WHEN ${deliveries.status} = 'delivered' OR ${deliveryEvents.type} = 'delivered' THEN ${deliveries.id}
          END) AS delivered,
          COUNT(DISTINCT CASE WHEN ${deliveryEvents.type} = 'opened' THEN ${deliveries.id} END) AS opens,
          COUNT(DISTINCT CASE WHEN ${deliveryEvents.type} = 'clicked' THEN ${deliveries.id} END) AS clicks,
          COUNT(DISTINCT CASE WHEN ${deliveryEvents.type} = 'bounced' THEN ${deliveries.id} END) AS bounces,
          COUNT(DISTINCT CASE WHEN ${deliveryEvents.type} = 'unsubscribed' THEN ${deliveries.id} END) AS unsubscribes,
          COUNT(DISTINCT CASE WHEN ${deliveryEvents.type} = 'complained' THEN ${deliveries.id} END) AS complaints
        FROM ${deliveries}
        LEFT JOIN ${deliveryEvents}
          ON ${deliveryEvents.workspaceId} = ${deliveries.workspaceId} AND ${deliveryEvents.deliveryId} = ${deliveries.id}
        WHERE ${deliveries.workspaceId} = ${workspaceId} AND ${deliveries.channel} = 'email'
          AND ${deliveries.status} IN ('accepted', 'delivered', 'failed')
          AND ${deliveries.createdAt} >= ${range.fromTimestamp} AND ${deliveries.createdAt} < ${range.toExclusiveTimestamp}
      `,
      sql`
        SELECT
          date(${deliveries.createdAt}) AS day,
          COUNT(DISTINCT ${deliveries.id}) AS sends,
          COUNT(DISTINCT CASE
            WHEN ${deliveries.status} = 'delivered' OR ${deliveryEvents.type} = 'delivered' THEN ${deliveries.id}
          END) AS delivered,
          COUNT(DISTINCT CASE WHEN ${deliveryEvents.type} = 'opened' THEN ${deliveries.id} END) AS opens,
          COUNT(DISTINCT CASE WHEN ${deliveryEvents.type} = 'clicked' THEN ${deliveries.id} END) AS clicks
        FROM ${deliveries}
        LEFT JOIN ${deliveryEvents}
          ON ${deliveryEvents.workspaceId} = ${deliveries.workspaceId} AND ${deliveryEvents.deliveryId} = ${deliveries.id}
        WHERE ${deliveries.workspaceId} = ${workspaceId} AND ${deliveries.channel} = 'email'
          AND ${deliveries.status} IN ('accepted', 'delivered', 'failed')
          AND ${deliveries.createdAt} >= ${range.fromTimestamp} AND ${deliveries.createdAt} < ${range.toExclusiveTimestamp}
        GROUP BY date(${deliveries.createdAt})
        ORDER BY day
      `,
      sql`
        SELECT
          COALESCE(${automations.id}, ${emailTemplates.id}, 'other') AS source_id,
          COALESCE(${automations.name}, ${emailTemplates.name}, 'その他のメール') AS source_name,
          CASE
            WHEN ${automations.id} IS NOT NULL THEN 'automation'
            ELSE 'transactional'
          END AS source_type,
          COUNT(DISTINCT ${deliveries.id}) AS sends,
          COUNT(DISTINCT CASE
            WHEN ${deliveries.status} = 'delivered' OR ${deliveryEvents.type} = 'delivered' THEN ${deliveries.id}
          END) AS delivered,
          COUNT(DISTINCT CASE WHEN ${deliveryEvents.type} = 'opened' THEN ${deliveries.id} END) AS opens,
          COUNT(DISTINCT CASE WHEN ${deliveryEvents.type} = 'clicked' THEN ${deliveries.id} END) AS clicks,
          COUNT(DISTINCT CASE WHEN ${deliveryEvents.type} = 'bounced' THEN ${deliveries.id} END) AS bounces,
          COUNT(DISTINCT CASE WHEN ${deliveryEvents.type} = 'unsubscribed' THEN ${deliveries.id} END) AS unsubscribes
        FROM ${deliveries}
        LEFT JOIN ${deliveryEvents}
          ON ${deliveryEvents.workspaceId} = ${deliveries.workspaceId} AND ${deliveryEvents.deliveryId} = ${deliveries.id}
        LEFT JOIN ${automationEnrollments}
          ON ${automationEnrollments.workspaceId} = ${deliveries.workspaceId} AND ${automationEnrollments.id} = ${deliveries.enrollmentId}
        LEFT JOIN ${automations}
          ON ${automations.workspaceId} = ${automationEnrollments.workspaceId} AND ${automations.id} = ${automationEnrollments.automationId}
        LEFT JOIN ${emailTemplates}
          ON ${emailTemplates.workspaceId} = ${deliveries.workspaceId} AND ${emailTemplates.id} = ${deliveries.templateId}
        WHERE ${deliveries.workspaceId} = ${workspaceId} AND ${deliveries.channel} = 'email'
          AND ${deliveries.status} IN ('accepted', 'delivered', 'failed')
          AND ${deliveries.createdAt} >= ${range.fromTimestamp} AND ${deliveries.createdAt} < ${range.toExclusiveTimestamp}
        GROUP BY source_id, source_name, source_type
        ORDER BY sends DESC, source_name ASC
        LIMIT 100
      `,
    );
    return { summary: summaryRows[0] ?? {}, trend: trendRows, sources: sourceRows };
  }

  /** Page/form summaries, trend, top pages, forms, and site messages - 6 independent queries run concurrently. */
  public async siteSummary(workspaceId: string, range: ReportDateRange): Promise<SiteSummaryData> {
    const [pageSummaryRows, formSummaryRows, trendRows, topPageRows, formRows, messageRows] =
      await this.runBatch(
        sql`
          SELECT
            COUNT(*) AS page_views,
            COUNT(DISTINCT COALESCE(${contactEvents.visitorId}, ${contactEvents.contactId})) AS unique_visitors,
            COUNT(DISTINCT ${contactEvents.contactId}) AS identified_contacts
          FROM ${contactEvents}
          WHERE ${contactEvents.workspaceId} = ${workspaceId} AND ${contactEvents.type} = 'page_viewed'
            AND ${contactEvents.occurredAt} >= ${range.fromTimestamp} AND ${contactEvents.occurredAt} < ${range.toExclusiveTimestamp}
        `,
        sql`
          SELECT COUNT(*) AS submissions,
                 COUNT(DISTINCT ${formSubmissions.contactId}) AS submitting_contacts
          FROM ${formSubmissions}
          WHERE ${formSubmissions.workspaceId} = ${workspaceId} AND ${formSubmissions.createdAt} >= ${range.fromTimestamp} AND ${formSubmissions.createdAt} < ${range.toExclusiveTimestamp}
        `,
        sql`
          WITH activity AS (
            SELECT date(${contactEvents.occurredAt}) AS day, 1 AS page_views, 0 AS submissions
            FROM ${contactEvents}
            WHERE ${contactEvents.workspaceId} = ${workspaceId} AND ${contactEvents.type} = 'page_viewed'
              AND ${contactEvents.occurredAt} >= ${range.fromTimestamp} AND ${contactEvents.occurredAt} < ${range.toExclusiveTimestamp}
            UNION ALL
            SELECT date(${formSubmissions.createdAt}) AS day, 0 AS page_views, 1 AS submissions
            FROM ${formSubmissions}
            WHERE ${formSubmissions.workspaceId} = ${workspaceId} AND ${formSubmissions.createdAt} >= ${range.fromTimestamp} AND ${formSubmissions.createdAt} < ${range.toExclusiveTimestamp}
          )
          SELECT day, SUM(page_views) AS page_views, SUM(submissions) AS submissions
          FROM activity
          GROUP BY day
          ORDER BY day
        `,
        sql`
          SELECT
            ${contactEvents.resourceId} AS url,
            COUNT(*) AS views,
            COUNT(DISTINCT COALESCE(${contactEvents.visitorId}, ${contactEvents.contactId})) AS unique_visitors,
            COUNT(DISTINCT ${contactEvents.contactId}) AS identified_contacts
          FROM ${contactEvents}
          WHERE ${contactEvents.workspaceId} = ${workspaceId} AND ${contactEvents.type} = 'page_viewed'
            AND ${contactEvents.occurredAt} >= ${range.fromTimestamp} AND ${contactEvents.occurredAt} < ${range.toExclusiveTimestamp}
            AND ${contactEvents.resourceId} IS NOT NULL
          GROUP BY ${contactEvents.resourceId}
          ORDER BY views DESC
          LIMIT 20
        `,
        sql`
          SELECT
            ${forms.id}, ${forms.name}, ${forms.status},
            COUNT(${formSubmissions.id}) AS submissions,
            COUNT(DISTINCT ${formSubmissions.contactId}) AS contacts
          FROM ${forms}
          LEFT JOIN ${formSubmissions}
            ON ${formSubmissions.workspaceId} = ${forms.workspaceId} AND ${formSubmissions.formId} = ${forms.id}
               AND ${formSubmissions.createdAt} >= ${range.fromTimestamp} AND ${formSubmissions.createdAt} < ${range.toExclusiveTimestamp}
          WHERE ${forms.workspaceId} = ${workspaceId} AND ${forms.status} != 'archived'
          GROUP BY ${forms.id}
          ORDER BY submissions DESC, ${forms.name} ASC
        `,
        sql`
          SELECT ${siteMessages.id}, ${siteMessages.name}, ${siteMessages.status}, ${siteMessages.impressionCount}, ${siteMessages.clickCount}
          FROM ${siteMessages}
          WHERE ${siteMessages.workspaceId} = ${workspaceId} AND ${siteMessages.status} != 'archived'
          ORDER BY ${siteMessages.impressionCount} DESC, ${siteMessages.name} ASC
        `,
      );
    return {
      pageSummary: pageSummaryRows[0] ?? {},
      formSummary: formSummaryRows[0] ?? {},
      trend: trendRows,
      topPages: topPageRows,
      forms: formRows,
      messages: messageRows,
    };
  }

  /** Feeds the `dashboard.get` procedure - independent read queries run concurrently. */
  public async dashboardSummary(workspaceId: string): Promise<DashboardSummaryData> {
    const [contactRows, automationRows, briefRows, deliveryRows, eventRows] = await this.runBatch(
      sql`
        SELECT COUNT(*) AS count FROM ${contacts} WHERE ${contacts.workspaceId} = ${workspaceId} AND ${contacts.status} = 'active'
      `,
      sql`
        SELECT COUNT(*) AS count FROM ${automations} WHERE ${automations.workspaceId} = ${workspaceId} AND ${automations.status} = 'active'
      `,
      sql`
        SELECT COUNT(*) AS overdue_reviews
        FROM ${projectBriefs}
        INNER JOIN ${projects} ON ${projects.id} = ${projectBriefs.projectId} AND ${projects.workspaceId} = ${projectBriefs.workspaceId}
        WHERE ${projectBriefs.workspaceId} = ${workspaceId}
          AND ${projectBriefs.status} = 'approved'
          AND ${projectBriefs.reviewAt} < datetime('now')
          AND ${projects.archivedAt} IS NULL
      `,
      sql`
        SELECT COUNT(*) AS sent,
               SUM(CASE WHEN ${deliveries.status} = 'delivered' THEN 1 ELSE 0 END) AS delivered,
               SUM(CASE WHEN ${deliveries.status} = 'failed' THEN 1 ELSE 0 END) AS failed
        FROM ${deliveries} WHERE ${deliveries.workspaceId} = ${workspaceId} AND ${deliveries.createdAt} >= datetime('now', '-30 day')
      `,
      sql`
        SELECT ${contactEvents.type}, ${contactEvents.occurredAt}, ${contactEvents.contactId}, ${contactEvents.properties} FROM ${contactEvents}
        WHERE ${contactEvents.workspaceId} = ${workspaceId} ORDER BY ${contactEvents.occurredAt} DESC LIMIT 20
      `,
    );
    return {
      contacts: contactRows[0] ?? {},
      automations: automationRows[0] ?? {},
      briefs: briefRows[0] ?? {},
      deliveries: deliveryRows[0] ?? {},
      events: eventRows,
    };
  }
}
