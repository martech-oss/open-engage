import { sql } from "drizzle-orm";

import { automations } from "../automations/schema";
import { contactEvents, contacts } from "../contacts/schema";
import { deliveries } from "../messaging/schema";
import { projectBriefs, projects } from "../projects/schema";
import { ReportsBatchRepository } from "./batch-repository";
import type { DashboardSummaryData } from "./types";

export class DashboardReportsRepository extends ReportsBatchRepository {
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
          AND datetime(${projectBriefs.reviewAt}) < datetime('now')
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
