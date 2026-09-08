import { LifecycleReportRepository, type LifecycleCohortRow } from "@openengage/database/reports";

import { publicRange, rate, type ReportDatabase, type ReportRange } from "./shared";

const empty: Omit<LifecycleCohortRow, "day"> = {
  leads: 0,
  mql: 0,
  sql: 0,
  customer: 0,
  skippedMql: 0,
  skippedSql: 0,
  medianLeadToMqlDays: null,
  medianMqlToSqlDays: null,
  medianSqlToCustomerDays: null,
};
function metrics(row: Omit<LifecycleCohortRow, "day">) {
  return {
    ...row,
    mqlRate: rate(row.mql, row.leads),
    sqlRate: rate(row.sql, row.leads),
    customerRate: rate(row.customer, row.leads),
  };
}
export async function lifecycleReport(
  database: ReportDatabase,
  workspaceId: string,
  range: ReportRange,
  filters: { projectId?: string; ownerUserId?: string },
) {
  const asOf = new Date().toISOString();
  const rows = await new LifecycleReportRepository(database).cohorts(
    workspaceId,
    range,
    asOf,
    filters,
  );
  const summaryRow = rows.find((row) => row.day === "*");
  const { day: _day, ...summary } = summaryRow ?? { day: "*", ...empty };
  return {
    category: "lifecycle" as const,
    range: publicRange(range),
    asOf,
    summary: metrics(summary),
    cohorts: range.days.map((day) => ({
      day: day.day,
      ...metrics(rows.find((row) => row.day === day.day) ?? empty),
    })),
  };
}
