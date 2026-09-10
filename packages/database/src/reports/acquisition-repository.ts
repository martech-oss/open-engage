import { eq, sql } from "drizzle-orm";

import { stringArraySchema } from "@openengage/core/shared";

import { decodeJson } from "../shared/json-codec";
import { DatabaseRepository } from "../shared/repository-base";
import { siteTrackingSettings } from "../web/schema";
import type { ReportDateRange, ReportRow } from "./types";

/** Period activity attributed to the first retained page/form touch for each person. */
export class AcquisitionReportsRepository extends DatabaseRepository {
  public async internalDomains(workspaceId: string): Promise<string[]> {
    const row = await this.database.orm
      .select({ domains: siteTrackingSettings.allowedDomains })
      .from(siteTrackingSettings)
      .where(eq(siteTrackingSettings.workspaceId, workspaceId))
      .get();
    return row
      ? decodeJson(row.domains, stringArraySchema, "site_tracking_settings.allowed_domains")
      : [];
  }

  public sourceMetrics(
    workspaceId: string,
    range: ReportDateRange,
    currency: string,
  ): Promise<ReportRow[]> {
    return this.database.orm.all<ReportRow>(sql`
      WITH events AS (
        SELECT e.id, e.type, e.occurred_at,
          CASE WHEN COALESCE(e.contact_id,b.contact_id) IS NOT NULL
            THEN 'c:'||COALESCE(e.contact_id,b.contact_id)
            WHEN e.visitor_id IS NOT NULL THEN 'v:'||e.visitor_id ELSE 'e:'||e.id END AS person,
          CASE WHEN json_valid(e.properties) THEN e.properties ELSE '{}' END AS properties,
          e.resource_id
        FROM contact_events e
        LEFT JOIN visitor_bindings b ON b.workspace_id=e.workspace_id AND b.visitor_id=e.visitor_id
        WHERE e.workspace_id=${workspaceId} AND e.type IN ('page_viewed','form_submitted')
          AND e.archived_at IS NULL AND e.occurred_at<${range.toExclusiveTimestamp}
      ), forms AS (
        SELECT f.id, f.created_at AS occurred_at,
          CASE WHEN COALESCE(f.contact_id,b.contact_id) IS NOT NULL
            THEN 'c:'||COALESCE(f.contact_id,b.contact_id)
            WHEN f.visitor_id IS NOT NULL THEN 'v:'||f.visitor_id ELSE 'f:'||f.id END AS person
        FROM form_submissions f
        LEFT JOIN visitor_bindings b ON b.workspace_id=f.workspace_id AND b.visitor_id=f.visitor_id
        WHERE f.workspace_id=${workspaceId} AND f.created_at<${range.toExclusiveTimestamp}
      ), candidates AS (
        SELECT id, occurred_at, person, 0 AS priority,
          CASE WHEN json_type(properties,'$.source')='object' THEN json_extract(properties,'$.source')
            ELSE json_object('url',COALESCE(json_extract(properties,'$.url'),resource_id),
                             'referrer',json_extract(properties,'$.referrer')) END AS source
        FROM events
        UNION ALL SELECT id, occurred_at, person, 1, '{}' FROM forms
      ), ranked AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY person ORDER BY occurred_at,priority,id) AS position
        FROM candidates
      ), first_sources AS (
        SELECT person, occurred_at, source FROM ranked WHERE position=1
      ), activity AS (
        SELECT person, occurred_at AS attribution_at, 'page' AS kind, id, 0 AS value
        FROM events WHERE type='page_viewed' AND occurred_at>=${range.fromTimestamp}
        UNION ALL SELECT person, occurred_at, 'form', id, 0 FROM forms WHERE occurred_at>=${range.fromTimestamp}
        UNION ALL SELECT 'c:'||contact_id, reached_at, 'mql', contact_id, 0
        FROM contact_lifecycle_history WHERE workspace_id=${workspaceId} AND stage='mql'
          AND reached_at>=${range.fromTimestamp} AND reached_at<${range.toExclusiveTimestamp}
        UNION ALL SELECT 'c:'||contact_id, created_at, 'deal', id, 0
        FROM deals WHERE workspace_id=${workspaceId} AND currency=${currency} AND archived_at IS NULL
          AND created_at>=${range.fromTimestamp} AND created_at<${range.toExclusiveTimestamp}
        UNION ALL SELECT 'c:'||contact_id, created_at, 'won', id, value
        FROM deals WHERE workspace_id=${workspaceId} AND currency=${currency} AND archived_at IS NULL AND status='won'
          AND won_at>=${range.fromTimestamp} AND won_at<${range.toExclusiveTimestamp}
      ), attributed AS (
        SELECT a.*, COALESCE(s.source,'{}') AS source
        FROM activity a LEFT JOIN first_sources s ON s.person=a.person AND s.occurred_at<=a.attribution_at
      )
      SELECT source,
        SUM(CASE WHEN kind='page' THEN 1 ELSE 0 END) AS pageViews,
        COUNT(DISTINCT CASE WHEN kind='page' THEN person END) AS visitors,
        SUM(CASE WHEN kind='form' THEN 1 ELSE 0 END) AS submissions,
        COUNT(DISTINCT CASE WHEN kind='form' AND person LIKE 'c:%' THEN person END) AS submittingContacts,
        SUM(CASE WHEN kind='mql' THEN 1 ELSE 0 END) AS mql,
        SUM(CASE WHEN kind='deal' THEN 1 ELSE 0 END) AS dealsCreated,
        SUM(CASE WHEN kind='won' THEN 1 ELSE 0 END) AS won,
        SUM(value) AS wonValue
      FROM attributed GROUP BY source
    `);
  }
}
