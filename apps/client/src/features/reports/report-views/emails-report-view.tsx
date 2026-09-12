import { Send } from "lucide-react";
import type { ReactNode } from "react";

import { MetricCard, MetricGrid } from "@/components/app-ui";
import { type DataTableColumn, DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import type { EmailsReport } from "@/features/reports/report-api";

import { formatReportRate } from "../report-format";
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
      header: "送信（通）",
      cell: (source) => source.sends.toLocaleString(),
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    {
      key: "delivered",
      header: "到達（通）",
      cell: (source) => source.delivered.toLocaleString(),
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    {
      key: "openRate",
      header: "開封率",
      cell: (source) => formatReportRate(source.openRate, source.delivered),
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    {
      key: "clickRate",
      header: "クリック率",
      cell: (source) => formatReportRate(source.clickRate, source.delivered),
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    {
      key: "bounces",
      header: "バウンス（通）",
      cell: (source) => source.bounces.toLocaleString(),
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    {
      key: "unsubscribes",
      header: "配信停止（通）",
      cell: (source) => source.unsubscribes.toLocaleString(),
      headClassName: "px-4 text-right",
      cellClassName: "px-4 text-right tabular-nums",
    },
  ];
  return (
    <>
      <MetricGrid className="sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <MetricCard
          label="送信"
          value={`${report.summary.sends.toLocaleString()}通`}
          icon={<Send />}
        />
        <MetricCard
          label="到達率"
          help="到達数 ÷ 送信数。送信数が0の場合は — を表示します。"
          value={formatReportRate(report.summary.deliveryRate, report.summary.sends)}
        />
        <MetricCard
          label="開封率"
          help="ユニーク開封数 ÷ 到達数。到達数が0の場合は — を表示します。"
          value={formatReportRate(report.summary.openRate, report.summary.delivered)}
        />
        <MetricCard
          label="クリック率"
          help="ユニーククリック数 ÷ 到達数。到達数が0の場合は — を表示します。"
          value={formatReportRate(report.summary.clickRate, report.summary.delivered)}
        />
        <MetricCard
          label="CTOR"
          help="Click To Open Rate。ユニーククリック数 ÷ ユニーク開封数。開封数が0の場合は — を表示します。"
          value={formatReportRate(report.summary.clickToOpenRate, report.summary.opens)}
        />
        <MetricCard
          label="バウンス率"
          help="バウンス数 ÷ 送信数。送信数が0の場合は — を表示します。"
          value={formatReportRate(report.summary.bounceRate, report.summary.sends)}
        />
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
