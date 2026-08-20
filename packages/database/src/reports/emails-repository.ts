import { sql } from "drizzle-orm";

import { automationEnrollments, automations } from "../automations/schema";
import { deliveries, deliveryEvents, emailTemplates } from "../messaging/schema";
import { ReportsBatchRepository } from "./batch-repository";
import type { EmailsSummaryData, ReportDateRange } from "./types";

export class EmailsReportsRepository extends ReportsBatchRepository {
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
}
