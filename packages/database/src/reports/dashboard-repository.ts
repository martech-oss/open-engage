import { sql } from "drizzle-orm";

import { automationEnrollments, automations } from "../automations/schema";
import { contactEvents, contacts } from "../contacts/schema";
import { deals, dealTasks } from "../deals/schema";
import { deliveries } from "../messaging/schema";
import { projectBriefs, projects } from "../projects/schema";
import { reportDaysCte, ReportsBatchRepository } from "./batch-repository";
import { emailDeliveredPredicate, emailSendPredicate } from "./email-metrics";
import type { DashboardSummaryData, ReportDateRange } from "./types";

export class DashboardReportsRepository extends ReportsBatchRepository {
  /** Only dashboard projections; no management lists or report breakdowns. */
  public async dashboardSummary(
    workspaceId: string,
    input: { totals: ReportDateRange; trend: ReportDateRange; asOf: string },
  ): Promise<DashboardSummaryData> {
    const { totals, trend, asOf } = input;
    const enrollmentCounts = sql`enrollment_counts AS (
      SELECT ${automationEnrollments.automationId} AS automation_id,
        COUNT(CASE WHEN ${automationEnrollments.status} = 'active' THEN 1 END) AS active,
        COUNT(CASE WHEN ${automationEnrollments.status} = 'completed' THEN 1 END) AS completed
      FROM ${automationEnrollments}
      WHERE ${automationEnrollments.workspaceId} = ${workspaceId}
      GROUP BY ${automationEnrollments.automationId}
    )`;
    const [
      contactRows,
      contactTrend,
      automationRows,
      topAutomations,
      briefRows,
      deliveryRows,
      deliveryTrend,
      dealRows,
      taskRows,
      eventRows,
    ] = await this.runBatch(
      sql`SELECT COUNT(*) AS count FROM ${contacts}
        WHERE ${contacts.workspaceId} = ${workspaceId} AND ${contacts.status} = 'active'`,
      sql`WITH ${reportDaysCte(trend)}
        SELECT report_days.day AS day, COUNT(*) AS added FROM report_days
        JOIN ${contacts} ON ${contacts.createdAt} >= report_days.from_timestamp
          AND ${contacts.createdAt} < report_days.to_exclusive_timestamp
        WHERE ${contacts.workspaceId} = ${workspaceId}
        GROUP BY report_days.day ORDER BY day`,
      sql`WITH ${enrollmentCounts}
        SELECT COUNT(CASE WHEN ${automations.status} = 'active' THEN 1 END) AS count,
          COUNT(CASE WHEN ${automations.status} = 'draft' THEN 1 END) AS draft_count,
          COALESCE(SUM(enrollment_counts.active), 0) AS enrolled_count
        FROM ${automations}
        LEFT JOIN enrollment_counts ON enrollment_counts.automation_id = ${automations.id}
        WHERE ${automations.workspaceId} = ${workspaceId}`,
      sql`WITH ${enrollmentCounts}
        SELECT ${automations.id}, ${automations.name}, ${automations.updatedAt},
          COALESCE(enrollment_counts.active, 0) AS active,
          COALESCE(enrollment_counts.completed, 0) AS completed
        FROM ${automations}
        LEFT JOIN enrollment_counts ON enrollment_counts.automation_id = ${automations.id}
        WHERE ${automations.workspaceId} = ${workspaceId} AND ${automations.status} = 'active'
        ORDER BY active DESC, ${automations.updatedAt} DESC, ${automations.id} ASC LIMIT 6`,
      sql`SELECT COUNT(*) AS overdue_reviews FROM ${projectBriefs}
        INNER JOIN ${projects} ON ${projects.id} = ${projectBriefs.projectId}
          AND ${projects.workspaceId} = ${projectBriefs.workspaceId}
        WHERE ${projectBriefs.workspaceId} = ${workspaceId}
          AND ${projectBriefs.status} = 'approved' AND ${projectBriefs.reviewAt} < ${asOf}
          AND ${projects.archivedAt} IS NULL`,
      sql`SELECT COUNT(*) AS sent,
          COUNT(CASE WHEN ${emailDeliveredPredicate()} THEN 1 END) AS delivered,
          COUNT(CASE WHEN ${deliveries.status} = 'failed' THEN 1 END) AS failed
        FROM ${deliveries} WHERE ${emailSendPredicate(workspaceId)}
          AND ${deliveries.createdAt} >= ${totals.fromTimestamp}
          AND ${deliveries.createdAt} < ${totals.toExclusiveTimestamp}`,
      sql`WITH ${reportDaysCte(trend)}
        SELECT report_days.day AS day, COUNT(*) AS sends,
          COUNT(CASE WHEN ${emailDeliveredPredicate()} THEN 1 END) AS delivered
        FROM report_days JOIN ${deliveries}
          ON ${deliveries.createdAt} >= report_days.from_timestamp
            AND ${deliveries.createdAt} < report_days.to_exclusive_timestamp
        WHERE ${emailSendPredicate(workspaceId)} GROUP BY report_days.day ORDER BY day`,
      sql`WITH default_currency AS (
          SELECT COALESCE(MIN(${deals.currency}), 'JPY') AS currency FROM ${deals}
          WHERE ${deals.workspaceId} = ${workspaceId} AND ${deals.archivedAt} IS NULL
        )
        SELECT default_currency.currency,
          COUNT(CASE WHEN ${deals.createdAt} >= ${totals.fromTimestamp}
            AND ${deals.createdAt} < ${totals.toExclusiveTimestamp} THEN 1 END) AS created,
          COUNT(CASE WHEN ${deals.status} = 'open' THEN 1 END) AS open_count,
          COALESCE(SUM(CASE WHEN ${deals.status} = 'open' THEN ${deals.value} ELSE 0 END), 0) AS open_value
        FROM default_currency LEFT JOIN ${deals}
          ON ${deals.workspaceId} = ${workspaceId} AND ${deals.archivedAt} IS NULL
            AND ${deals.currency} = default_currency.currency`,
      sql`SELECT COUNT(CASE WHEN ${dealTasks.status} = 'open' THEN 1 END) AS open_tasks,
          COUNT(CASE WHEN ${dealTasks.status} = 'open' AND ${dealTasks.dueAt} < ${asOf} THEN 1 END) AS overdue_tasks,
          COUNT(CASE WHEN ${dealTasks.completedAt} >= ${totals.fromTimestamp}
            AND ${dealTasks.completedAt} < ${totals.toExclusiveTimestamp} THEN 1 END) AS completed_tasks
        FROM ${dealTasks} WHERE ${dealTasks.workspaceId} = ${workspaceId}`,
      sql`SELECT ${contactEvents.type}, ${contactEvents.occurredAt}, ${contactEvents.contactId}, ${contactEvents.properties}
        FROM ${contactEvents} WHERE ${contactEvents.workspaceId} = ${workspaceId}
        ORDER BY ${contactEvents.occurredAt} DESC LIMIT 20`,
    );
    return {
      contacts: contactRows[0] ?? {},
      contactTrend,
      automations: automationRows[0] ?? {},
      topAutomations,
      briefs: briefRows[0] ?? {},
      deliveries: deliveryRows[0] ?? {},
      deliveryTrend,
      deals: dealRows[0] ?? {},
      tasks: taskRows[0] ?? {},
      events: eventRows,
    };
  }
}
