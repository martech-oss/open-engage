import { Globe2, UserCheck } from "lucide-react";
import type { ReactNode } from "react";

import { MetricCard, MetricGrid } from "@/components/app-ui";
import { type DataTableColumn, DataTable } from "@/components/data-table";
import type { SiteReport } from "@/features/reports/report-api";

import { formatReportRate } from "../report-format";
import { ReportStatusBadge, ReportTableCard, TrendCard } from "../report-widgets";

export function SiteReportView({ report }: { report: SiteReport }): ReactNode {
  const topPageColumns: DataTableColumn<SiteReport["topPages"][number]>[] = [
    {
      key: "url",
      header: "URL",
      cell: (page) => (
        <span className="block max-w-72 truncate" title={page.url}>
          {page.url}
        </span>
      ),
      headClassName: "px-4",
      cellClassName: "px-4 font-medium",
    },
    {
      key: "views",
      header: "PV（回）",
      cell: (page) => page.views.toLocaleString(),
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    {
      key: "uniqueVisitors",
      header: "訪問者（人）",
      cell: (page) => page.uniqueVisitors.toLocaleString(),
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    {
      key: "identifiedContacts",
      header: "特定済み（人）",
      cell: (page) => page.identifiedContacts.toLocaleString(),
      headClassName: "px-4 text-right",
      cellClassName: "px-4 text-right tabular-nums",
    },
  ];
  const formColumns: DataTableColumn<SiteReport["forms"][number]>[] = [
    {
      key: "name",
      header: "フォーム",
      cell: (form) => form.name,
      headClassName: "px-4",
      cellClassName: "px-4 font-medium",
    },
    {
      key: "status",
      header: "状態",
      cell: (form) => <ReportStatusBadge status={form.status} />,
    },
    {
      key: "submissions",
      header: "送信（件）",
      cell: (form) => form.submissions.toLocaleString(),
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    {
      key: "contacts",
      header: "連絡先（人）",
      cell: (form) => form.contacts.toLocaleString(),
      headClassName: "px-4 text-right",
      cellClassName: "px-4 text-right tabular-nums",
    },
  ];
  const messageColumns: DataTableColumn<SiteReport["messages"][number]>[] = [
    {
      key: "name",
      header: "メッセージ",
      cell: (message) => message.name,
      headClassName: "px-4",
      cellClassName: "px-4 font-medium",
    },
    {
      key: "status",
      header: "状態",
      cell: (message) => <ReportStatusBadge status={message.status} />,
    },
    {
      key: "impressions",
      header: "表示（回）",
      cell: (message) => message.impressions.toLocaleString(),
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    {
      key: "clicks",
      header: "クリック（回）",
      cell: (message) => message.clicks.toLocaleString(),
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    {
      key: "clickRate",
      header: "クリック率",
      cell: (message) => formatReportRate(message.clickRate, message.impressions),
      headClassName: "px-4 text-right",
      cellClassName: "px-4 text-right tabular-nums",
    },
  ];
  return (
    <>
      <MetricGrid className="sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <MetricCard
          label="ページビュー"
          value={`${report.summary.pageViews.toLocaleString()}回`}
          icon={<Globe2 />}
        />
        <MetricCard
          label="ユニーク訪問者"
          value={`${report.summary.uniqueVisitors.toLocaleString()}人`}
        />
        <MetricCard
          label="特定済み率"
          help="特定済み連絡先数 ÷ ユニーク訪問者数。訪問者数が0の場合は — を表示します。"
          value={formatReportRate(report.summary.identificationRate, report.summary.uniqueVisitors)}
          icon={<UserCheck />}
        />
        <MetricCard
          label="フォーム送信"
          value={`${report.summary.submissions.toLocaleString()}件`}
        />
        <MetricCard
          label="メッセージ表示"
          value={`${report.summary.messageImpressions.toLocaleString()}回`}
        />
        <MetricCard
          label="メッセージクリック"
          value={`${report.summary.messageClicks.toLocaleString()}回`}
        />
      </MetricGrid>
      <TrendCard
        title="サイトアクティビティ"
        description="ページビューとフォーム送信"
        data={report.trend}
        series={[
          { key: "pageViews", label: "ページビュー", color: "var(--color-chart-4)" },
          { key: "submissions", label: "フォーム送信", color: "var(--color-chart-1)" },
        ]}
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <ReportTableCard title="上位ページ">
          <DataTable
            columns={topPageColumns}
            rows={report.topPages}
            rowKey={(page) => page.url}
            caption="ページ別サイトレポート"
            emptyTitle="この期間のデータはありません"
            emptyDescription="期間を変更するか、データが蓄積されてから確認してください。"
          />
        </ReportTableCard>
        <ReportTableCard title="フォームパフォーマンス">
          <DataTable
            columns={formColumns}
            rows={report.forms}
            rowKey={(form) => form.id}
            caption="フォーム別レポート"
            emptyTitle="この期間のデータはありません"
            emptyDescription="期間を変更するか、データが蓄積されてから確認してください。"
          />
        </ReportTableCard>
      </div>
      <ReportTableCard
        title="サイトメッセージ（累計）"
        help="クリック率はクリック数 ÷ 表示数です。表示数が0の場合は — を表示します。"
      >
        <DataTable
          columns={messageColumns}
          rows={report.messages}
          rowKey={(message) => message.id}
          caption="サイトメッセージ別レポート"
          emptyTitle="この期間のデータはありません"
          emptyDescription="期間を変更するか、データが蓄積されてから確認してください。"
        />
      </ReportTableCard>
    </>
  );
}
