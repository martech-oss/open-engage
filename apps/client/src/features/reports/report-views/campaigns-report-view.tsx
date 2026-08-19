import { Handshake, Megaphone, MousePointerClick, UsersRound } from "lucide-react";
import type { ReactNode } from "react";

import { MetricCard, MetricGrid } from "@/components/app-ui";
import { type DataTableColumn, DataTable } from "@/components/data-table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { CampaignsReport } from "@/features/reports/report-api";
import { formatMoney } from "@/lib/format";

import { ReportTableCard } from "../report-widgets";

type CampaignRow = CampaignsReport["campaigns"][number];

export function CampaignsReportView({ report }: { report: CampaignsReport }): ReactNode {
  const columns: DataTableColumn<CampaignRow>[] = [
    {
      key: "name",
      header: "キャンペーン",
      cell: (row) => (
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: row.color }}
          />
          <span className="font-medium">{row.name}</span>
        </div>
      ),
      headClassName: "px-4",
      cellClassName: "px-4",
    },
    {
      key: "touches",
      header: "接点",
      cell: (row) => row.touches.toLocaleString(),
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    {
      key: "contacts",
      header: "連絡先",
      cell: (row) => row.contacts.toLocaleString(),
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    {
      key: "influencedDeals",
      header: "関与商談",
      cell: (row) => row.influencedDeals.toLocaleString(),
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    {
      key: "influencedValue",
      header: "関与金額",
      cell: (row) => formatMoney(row.influencedValue, report.currency),
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    {
      key: "firstTouchValue",
      header: "初回接点",
      cell: (row) => formatMoney(row.firstTouchValue, report.currency),
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    {
      key: "lastTouchValue",
      header: "最終接点",
      cell: (row) => formatMoney(row.lastTouchValue, report.currency),
      headClassName: "px-4 text-right",
      cellClassName: "px-4 text-right tabular-nums",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <MetricGrid>
        <MetricCard
          label="キャンペーン"
          value={report.summary.campaigns.toLocaleString()}
          description={
            <div className="flex items-center gap-2 text-sm">
              <Megaphone />
              接点のあるもの {report.summary.activeCampaigns.toLocaleString()} 件
            </div>
          }
        />
        <MetricCard
          label="接点"
          value={report.summary.touches.toLocaleString()}
          description={
            <div className="flex items-center gap-2 text-sm">
              <MousePointerClick />
              期間内に記録された接触
            </div>
          }
        />
        <MetricCard
          label="接触した連絡先"
          value={report.summary.contacts.toLocaleString()}
          description={
            <div className="flex items-center gap-2 text-sm">
              <UsersRound />
              キャンペーンごとの延べ人数
            </div>
          }
        />
        <MetricCard
          label="最終接点の売上"
          value={formatMoney(report.summary.lastTouchValue, report.currency)}
          description={
            <div className="flex items-center gap-2 text-sm">
              <Handshake />
              受注 {report.summary.influencedDeals.toLocaleString()} 件に関与
            </div>
          }
        />
      </MetricGrid>
      <Alert>
        <Megaphone />
        <AlertTitle>3つの金額は足し合わせないでください</AlertTitle>
        <AlertDescription>
          「関与金額」は受注に接触したすべてのキャンペーンに同じ金額を計上するため、合計は売上を超えます。
          「初回接点」「最終接点」はそれぞれ売上を重複なく1回だけ配分します。
          接点は、プロジェクトに紐付けたメール・フォーム・セグメント・計測用リンクへの反応から記録されます。
        </AlertDescription>
      </Alert>
      <ReportTableCard title="キャンペーン別のアトリビューション">
        <DataTable
          columns={columns}
          rows={report.campaigns}
          rowKey={(row) => row.id}
          caption="キャンペーン別のアトリビューション"
          emptyTitle="キャンペーンの接点がありません"
          emptyDescription="プロジェクトにメールやフォームを紐付けると、そこへの反応が接点として記録されます。"
        />
      </ReportTableCard>
    </div>
  );
}
