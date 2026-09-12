import { Link } from "@tanstack/react-router";
import { Activity, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";

import { MetricCard, MetricGrid } from "@/components/app-ui";
import { type DataTableColumn, DataTable } from "@/components/data-table";
import type { AutomationsReport } from "@/features/reports/report-api";

import { formatReportRate, formatReportRatio } from "../report-format";
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
      header: "参加（回）",
      cell: (automation) => automation.entries.toLocaleString(),
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    {
      key: "completions",
      header: "完了（回）",
      cell: (automation) => automation.completions.toLocaleString(),
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    {
      key: "activeContacts",
      header: "進行中（人）",
      cell: (automation) => automation.activeContacts.toLocaleString(),
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    {
      key: "sends",
      header: "送信（通）",
      cell: (automation) => automation.sends.toLocaleString(),
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    {
      key: "openRate",
      header: "開封率",
      cell: (automation) => formatReportRatio(automation.opens, automation.sends),
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    {
      key: "clickRate",
      header: "クリック率",
      cell: (automation) => formatReportRatio(automation.clicks, automation.sends),
      headClassName: "px-4 text-right",
      cellClassName: "px-4 text-right tabular-nums",
    },
  ];
  return (
    <>
      <MetricGrid className="sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <MetricCard
          label="オートメーション"
          value={`${report.summary.automationCount.toLocaleString()}件`}
        />
        <MetricCard label="参加" value={`${report.summary.entries.toLocaleString()}回`} />
        <MetricCard
          label="完了率"
          help="完了回数 ÷ 参加回数。参加数が0の場合は — を表示します。"
          value={formatReportRate(report.summary.completionRate, report.summary.entries)}
          icon={<TrendingUp />}
        />
        <MetricCard
          label="現在進行中"
          value={`${report.summary.activeContacts.toLocaleString()}人`}
          icon={<Activity />}
        />
        <MetricCard
          label="メール開封率"
          help="開封数 ÷ 送信数。送信数が0の場合は — を表示します。"
          value={formatReportRate(report.summary.openRate, report.summary.sends)}
        />
        <MetricCard
          label="メールクリック率"
          help="クリック数 ÷ 送信数。送信数が0の場合は — を表示します。"
          value={formatReportRate(report.summary.clickRate, report.summary.sends)}
        />
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
