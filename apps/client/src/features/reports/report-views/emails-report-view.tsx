import { Send } from "lucide-react";
import type { ReactNode } from "react";

import { MetricCard, MetricGrid } from "@/components/app-ui";
import { type DataTableColumn, DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import type { EmailsReport } from "@/features/reports/report-api";
import { formatPercent } from "@/lib/format";

import { ReportTableCard, sourceTypeLabel, TrendCard } from "../report-widgets";

export function EmailsReportView({ report }: { report: EmailsReport }): ReactNode {
  const emailSourceColumns: DataTableColumn<EmailsReport["sources"][number]>[] = [
    {
      key: "name",
      header: "配信元",
      cell: (source) => source.name,
      headClassName: "px-4",
      cellClassName: "px-4 font-medium",
    },
    {
      key: "type",
      header: "種別",
      cell: (source) => <Badge variant="outline">{sourceTypeLabel(source.type)}</Badge>,
    },
    {
      key: "sends",
      header: "送信",
      cell: (source) => source.sends.toLocaleString(),
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    {
      key: "delivered",
      header: "到達",
      cell: (source) => source.delivered.toLocaleString(),
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    {
      key: "openRate",
      header: "開封率",
      cell: (source) => formatPercent(source.openRate),
      headClassName: "text-right",
      cellClassName: "text-right",
    },
    {
      key: "clickRate",
      header: "クリック率",
      cell: (source) => formatPercent(source.clickRate),
      headClassName: "text-right",
      cellClassName: "text-right",
    },
    {
      key: "bounces",
      header: "バウンス",
      cell: (source) => source.bounces.toLocaleString(),
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    {
      key: "unsubscribes",
      header: "配信停止",
      cell: (source) => source.unsubscribes.toLocaleString(),
      headClassName: "px-4 text-right",
      cellClassName: "px-4 text-right tabular-nums",
    },
  ];
  return (
    <>
      <MetricGrid className="sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="送信" value={report.summary.sends} icon={<Send />} />
        <MetricCard label="到達率" value={formatPercent(report.summary.deliveryRate)} />
        <MetricCard label="開封率" value={formatPercent(report.summary.openRate)} />
        <MetricCard label="クリック率" value={formatPercent(report.summary.clickRate)} />
        <MetricCard label="CTOR" value={formatPercent(report.summary.clickToOpenRate)} />
        <MetricCard label="バウンス率" value={formatPercent(report.summary.bounceRate)} />
      </MetricGrid>
      <TrendCard
        title="メールパフォーマンス"
        description="送信・到達・ユニーク開封・ユニーククリック"
        data={report.trend}
        series={[
          { key: "sends", label: "送信", color: "var(--color-chart-5)" },
          { key: "delivered", label: "到達", color: "var(--color-chart-1)" },
          { key: "opens", label: "開封", color: "var(--color-chart-4)" },
          { key: "clicks", label: "クリック", color: "var(--color-chart-2)" },
        ]}
      />
      <ReportTableCard title="キャンペーン／オートメーション別">
        <DataTable
          columns={emailSourceColumns}
          rows={report.sources}
          rowKey={(source) => `${source.type}-${source.id}`}
          caption="メール配信元別レポート"
          emptyTitle="この期間のデータはありません"
          emptyDescription="期間を変更するか、データが蓄積されてから確認してください。"
        />
      </ReportTableCard>
    </>
  );
}
