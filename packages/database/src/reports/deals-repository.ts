import { sql } from "drizzle-orm";

import { user } from "../auth/schema";
import { dealStages, dealTasks, deals } from "../deals/schema";
import { nowIso } from "../shared/database-utils";
import { reportDaysCte, ReportsBatchRepository } from "./batch-repository";
import type { DealsSummaryData, ReportDateRange } from "./types";

export class DealsReportsRepository extends ReportsBatchRepository {
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
    const reportDays = reportDaysCte(range);
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
        WITH ${reportDays}, activity AS (
          SELECT report_days.day AS day, 1 AS created, 0 AS won, 0 AS lost
          FROM report_days
          JOIN ${deals}
            ON ${deals.createdAt} >= report_days.from_timestamp
              AND ${deals.createdAt} < report_days.to_exclusive_timestamp
          WHERE ${deals.workspaceId} = ${workspaceId} AND ${deals.archivedAt} IS NULL AND ${deals.currency} = ${currency}
          UNION ALL
          SELECT report_days.day AS day, 0 AS created, 1 AS won, 0 AS lost
          FROM report_days
          JOIN ${deals}
            ON ${deals.wonAt} >= report_days.from_timestamp
              AND ${deals.wonAt} < report_days.to_exclusive_timestamp
          WHERE ${deals.workspaceId} = ${workspaceId} AND ${deals.archivedAt} IS NULL AND ${deals.currency} = ${currency}
          UNION ALL
          SELECT report_days.day AS day, 0 AS created, 0 AS won, 1 AS lost
          FROM report_days
          JOIN ${deals}
            ON ${deals.lostAt} >= report_days.from_timestamp
              AND ${deals.lostAt} < report_days.to_exclusive_timestamp
          WHERE ${deals.workspaceId} = ${workspaceId} AND ${deals.archivedAt} IS NULL AND ${deals.currency} = ${currency}
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
}
