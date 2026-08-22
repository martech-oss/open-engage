import { sql } from "drizzle-orm";

import { automationEnrollments, automations } from "../automations/schema";
import { deliveries, deliveryEvents } from "../messaging/schema";
import { reportDaysCte, ReportsBatchRepository } from "./batch-repository";
import type { AutomationsSummaryData, ReportDateRange } from "./types";

export class AutomationsReportsRepository extends ReportsBatchRepository {
  /** Per-automation funnel plus entries/completions trend - 2 independent queries run concurrently. */
  public async automationsSummary(
    workspaceId: string,
    range: ReportDateRange,
  ): Promise<AutomationsSummaryData> {
    const reportDays = reportDaysCte(range);
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
        WITH ${reportDays}, activity AS (
          SELECT report_days.day AS day, 1 AS entries, 0 AS completions
          FROM report_days
          JOIN ${automationEnrollments}
            ON ${automationEnrollments.enteredAt} >= report_days.from_timestamp
              AND ${automationEnrollments.enteredAt} < report_days.to_exclusive_timestamp
          WHERE ${automationEnrollments.workspaceId} = ${workspaceId}
          UNION ALL
          SELECT report_days.day AS day, 0 AS entries, 1 AS completions
          FROM report_days
          JOIN ${automationEnrollments}
            ON ${automationEnrollments.completedAt} >= report_days.from_timestamp
              AND ${automationEnrollments.completedAt} < report_days.to_exclusive_timestamp
          WHERE ${automationEnrollments.workspaceId} = ${workspaceId}
        )
        SELECT day, SUM(entries) AS entries, SUM(completions) AS completions
        FROM activity
        GROUP BY day
        ORDER BY day
      `,
    );
    return { automations: automationRows, trend: trendRows };
  }
}
