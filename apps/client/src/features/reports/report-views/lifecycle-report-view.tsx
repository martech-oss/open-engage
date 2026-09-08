import { MetricCard, MetricGrid } from "@/components/app-ui";
import { DataTable, type DataTableColumn } from "@/components/data-table";

import { type LifecycleReport } from "../report-api";
import { ReportTableCard } from "../report-widgets";

type Cohort = LifecycleReport["cohorts"][number];
const days = (value: number | null) => (value === null ? "算出不可" : `${value.toFixed(1)}日`);
export function LifecycleReportView({ report }: { report: LifecycleReport }) {
  const columns: DataTableColumn<Cohort>[] = [
    { key: "day", header: "見込み客登録日", cell: (row) => row.day },
    { key: "leads", header: "見込み客", cell: (row) => row.leads },
    { key: "mql", header: "MQL到達", cell: (row) => `${row.mql} (${row.mqlRate}%)` },
    { key: "sql", header: "SQL到達", cell: (row) => `${row.sql} (${row.sqlRate}%)` },
    {
      key: "customer",
      header: "顧客到達",
      cell: (row) => `${row.customer} (${row.customerRate}%)`,
    },
    { key: "skippedMql", header: "MQL通過なし", cell: (row) => row.skippedMql },
    { key: "skippedSql", header: "SQL通過なし", cell: (row) => row.skippedSql },
    {
      key: "medianLeadToMqlDays",
      header: "見込み客→MQL 中央値",
      cell: (row) => days(row.medianLeadToMqlDays),
    },
    {
      key: "medianMqlToSqlDays",
      header: "MQL→SQL 中央値",
      cell: (row) => days(row.medianMqlToSqlDays),
    },
    {
      key: "medianSqlToCustomerDays",
      header: "SQL→顧客 中央値",
      cell: (row) => days(row.medianSqlToCustomerDays),
    },
  ];
  return (
    <div className="space-y-6">
      <MetricGrid>
        {(
          [
            ["見込み客", "leads"],
            ["MQL", "mql"],
            ["SQL", "sql"],
            ["顧客", "customer"],
          ] as const
        ).map(([label, key]) => (
          <MetricCard key={key} label={label} value={report.summary[key].toLocaleString()} />
        ))}
      </MetricGrid>
      <p className="text-sm text-muted-foreground">
        登録日のコホートを、集計時点まで追跡しています。到達率の分母は登録人数です。飛び越した段階の日時は補完せず、順番に到達した実績だけから所要日数を計算します。プロジェクト条件は集計時点までの接点、担当者条件は現在の担当者を使います。
      </p>
      <div className="flex flex-wrap gap-6 text-sm">
        <span>見込み客→MQL: {days(report.summary.medianLeadToMqlDays)}</span>
        <span>MQL→SQL: {days(report.summary.medianMqlToSqlDays)}</span>
        <span>SQL→顧客: {days(report.summary.medianSqlToCustomerDays)}</span>
      </div>
      <ReportTableCard title="登録日別の進捗">
        <DataTable
          emptyTitle="データがありません"
          rows={report.cohorts}
          columns={columns}
          rowKey={(row) => row.day}
          caption="進捗コホート"
        />
      </ReportTableCard>
    </div>
  );
}
