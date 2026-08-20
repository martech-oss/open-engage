import { sql } from "drizzle-orm";

import { contactEvents } from "../contacts/schema";
import { formSubmissions, forms, siteMessages } from "../web/schema";
import { ReportsBatchRepository } from "./batch-repository";
import type { ReportDateRange, SiteSummaryData } from "./types";

export class SiteReportsRepository extends ReportsBatchRepository {
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
}
