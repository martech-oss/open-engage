import { Link } from "@tanstack/react-router";
import { Activity, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";

import { MetricCard, MetricGrid } from "@/components/app-ui";
import { type DataTableColumn, DataTable } from "@/components/data-table";
import type { AutomationsReport } from "@/features/reports/report-api";
import { formatPercent, rate } from "@/lib/format";

import { ReportStatusBadge, ReportTableCard, TrendCard } from "../report-widgets";

export function AutomationsReportView({ report }: { report: AutomationsReport }): ReactNode {
  const automationColumns: DataTableColumn<AutomationsReport["automations"][number]>[] = [
    {
      key: "name",
      header: "オートメーション",
      cell: (automation) => (
        <Link to="/automations/$id" params={{ id: automation.id }} className="hover:underline">
          {automation.name}
        </Link>
      ),
      headClassName: "px-4",
      cellClassName: "px-4 font-medium",
    },
    {
      key: "status",
      header: "状態",
      cell: (automation) => <ReportStatusBadge status={automation.status} />,
    },
    {
      key: "entries",
      header: "参加",
      cell: (automation) => automation.entries.toLocaleString(),
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    {
      key: "completions",
      header: "完了",
      cell: (automation) => automation.completions.toLocaleString(),
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    {
      key: "activeContacts",
      header: "進行中",
      cell: (automation) => automation.activeContacts.toLocaleString(),
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    {
      key: "sends",
      header: "送信",
      cell: (automation) => automation.sends.toLocaleString(),
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    {
      key: "openRate",
      header: "開封率",
      cell: (automation) => formatPercent(rate(automation.opens, automation.sends)),
      headClassName: "text-right",
      cellClassName: "text-right",
    },
    {
      key: "clickRate",
      header: "クリック率",
      cell: (automation) => formatPercent(rate(automation.clicks, automation.sends)),
      headClassName: "px-4 text-right",
      cellClassName: "px-4 text-right",
    },
  ];
  return (
    <>
      <MetricGrid className="sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="オートメーション" value={report.summary.automationCount} />
        <MetricCard label="参加" value={report.summary.entries} />
        <MetricCard
          label="完了率"
          value={formatPercent(report.summary.completionRate)}
          icon={<TrendingUp />}
        />
        <MetricCard label="現在進行中" value={report.summary.activeContacts} icon={<Activity />} />
        <MetricCard label="メール開封率" value={formatPercent(report.summary.openRate)} />
        <MetricCard label="メールクリック率" value={formatPercent(report.summary.clickRate)} />
      </MetricGrid>
      <TrendCard
        title="参加と完了の推移"
        description="オートメーションへ入った回数と完了した回数"
        data={report.trend}
        series={[
          { key: "entries", label: "参加", color: "var(--color-chart-4)" },
          { key: "completions", label: "完了", color: "var(--color-chart-1)" },
        ]}
      />
      <ReportTableCard title="オートメーション別パフォーマンス">
        <DataTable
          columns={automationColumns}
          rows={report.automations}
          rowKey={(automation) => automation.id}
          caption="オートメーション別レポート"
          emptyTitle="この期間のデータはありません"
          emptyDescription="期間を変更するか、データが蓄積されてから確認してください。"
        />
      </ReportTableCard>
    </>
  );
}
