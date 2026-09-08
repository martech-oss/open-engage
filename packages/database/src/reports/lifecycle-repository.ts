import { sql } from "drizzle-orm";

import { DatabaseRepository } from "../shared/repository-base";
import { reportDaysCte } from "./batch-repository";
import type { ReportDateRange } from "./types";

export interface LifecycleCohortRow {
  day: string;
  leads: number;
  mql: number;
  sql: number;
  customer: number;
  skippedMql: number;
  skippedSql: number;
  medianLeadToMqlDays: number | null;
  medianMqlToSqlDays: number | null;
  medianSqlToCustomerDays: number | null;
}

export class LifecycleReportRepository extends DatabaseRepository {
  public async cohorts(
    workspaceId: string,
    range: ReportDateRange,
    asOf: string,
    filters: { projectId?: string; ownerUserId?: string },
  ): Promise<LifecycleCohortRow[]> {
    const projectFilter = filters.projectId
      ? sql`AND EXISTS (SELECT 1 FROM campaign_touches t WHERE t.workspace_id=c.workspace_id AND t.contact_id=c.id AND t.project_id=${filters.projectId} AND t.occurred_at<=${asOf})`
      : sql``;
    const ownerFilter = filters.ownerUserId
      ? sql`AND c.owner_user_id=${filters.ownerUserId}`
      : sql``;
    return await this.database.orm.all<LifecycleCohortRow>(sql`
      WITH ${reportDaysCte(range)},
      arrivals AS (
        SELECT d.day, c.id, c.created_at AS lead_at,
          MIN(CASE WHEN h.stage='mql' THEN h.reached_at END) AS mql_at,
          MIN(CASE WHEN h.stage='sql' THEN h.reached_at END) AS sql_at,
          MIN(CASE WHEN h.stage='customer' THEN h.reached_at END) AS customer_at
        FROM report_days d JOIN contacts c ON c.created_at>=d.from_timestamp AND c.created_at<d.to_exclusive_timestamp
        LEFT JOIN contact_lifecycle_history h ON h.workspace_id=c.workspace_id AND h.contact_id=c.id AND h.reached_at<=${asOf}
        WHERE c.workspace_id=${workspaceId} AND c.created_at<=${asOf} ${projectFilter} ${ownerFilter}
        GROUP BY d.day,c.id
      ), expanded AS (
        SELECT * FROM arrivals UNION ALL SELECT '*',id,lead_at,mql_at,sql_at,customer_at FROM arrivals
      ), counts AS (
        SELECT day, COUNT(*) AS leads, COUNT(mql_at) AS mql, COUNT(sql_at) AS sql, COUNT(customer_at) AS customer,
          SUM(CASE WHEN (sql_at IS NOT NULL AND (mql_at IS NULL OR mql_at>sql_at)) OR (customer_at IS NOT NULL AND (mql_at IS NULL OR mql_at>customer_at)) THEN 1 ELSE 0 END) AS skippedMql,
          SUM(CASE WHEN customer_at IS NOT NULL AND (sql_at IS NULL OR sql_at>customer_at) THEN 1 ELSE 0 END) AS skippedSql
        FROM expanded GROUP BY day
      ), durations AS (
        SELECT day,'lead_mql' AS transition,julianday(mql_at)-julianday(lead_at) AS days FROM expanded WHERE mql_at>=lead_at
        UNION ALL SELECT day,'mql_sql',julianday(sql_at)-julianday(mql_at) FROM expanded WHERE sql_at>=mql_at
        UNION ALL SELECT day,'sql_customer',julianday(customer_at)-julianday(sql_at) FROM expanded WHERE customer_at>=sql_at
      ), ranked AS (
        SELECT *,ROW_NUMBER() OVER(PARTITION BY day,transition ORDER BY days) AS position,COUNT(*) OVER(PARTITION BY day,transition) AS total FROM durations
      ), medians AS (
        SELECT day,transition,AVG(days) AS median FROM ranked WHERE position IN ((total+1)/2,(total+2)/2) GROUP BY day,transition
      )
      SELECT counts.*,
        (SELECT median FROM medians m WHERE m.day=counts.day AND transition='lead_mql') AS medianLeadToMqlDays,
        (SELECT median FROM medians m WHERE m.day=counts.day AND transition='mql_sql') AS medianMqlToSqlDays,
        (SELECT median FROM medians m WHERE m.day=counts.day AND transition='sql_customer') AS medianSqlToCustomerDays
      FROM counts ORDER BY day
    `);
  }
}
