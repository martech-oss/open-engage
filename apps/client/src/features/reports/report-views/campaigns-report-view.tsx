import { Handshake, Megaphone } from "lucide-react";
import type { ReactNode } from "react";

import { HelpTooltip, MetricCard, MetricGrid } from "@/components/app-ui";
import { type DataTableColumn, DataTable } from "@/components/data-table";
import type { CampaignsReport } from "@/features/reports/report-api";
import { formatMoney } from "@/lib/format";

import { CampaignCostsPanel } from "../campaign-costs-panel";
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
    { key: "cost", header: "期間費用", cell: (row) => formatMoney(row.cost, report.currency) },
    {
      key: "attributedValue",
      header: "配賦売上",
      cell: (row) => formatMoney(row.attributedValue, report.currency),
    },
    { key: "roi", header: "ROI", cell: (row) => (row.roi === null ? "—" : `${row.roi}%`) },
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
      header: "影響売上（参考）",
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
          help="期間内に記録された接触"
        />
        <MetricCard
          label="接触した連絡先"
          value={report.summary.contacts.toLocaleString()}
          help="キャンペーンごとの延べ人数"
        />
        <MetricCard
          label={
            report.attributionModel === "first_touch" ? "初回接点の配賦売上" : "最終接点の配賦売上"
          }
          value={formatMoney(report.summary.attributedValue, report.currency)}
          description={
            <div className="flex items-center gap-2 text-sm">
              <Handshake />
              受注 {report.summary.influencedDeals.toLocaleString()} 件に関与
            </div>
          }
        />
      </MetricGrid>
      <div className="flex flex-wrap gap-6 text-sm">
        <span>期間費用: {formatMoney(report.summary.cost, report.currency)}</span>
        <span className="inline-flex items-center gap-1">
          ROI: {report.summary.roi === null ? "—" : `${report.summary.roi}%`}
          <HelpTooltip label="ROI">
            ROI = （配賦売上 − 費用）÷ 費用 × 100。費用が0の場合、ROIは —
            を表示します。選択期間の計上費用と受注売上を使い、通貨間の合算・換算は行いません。
          </HelpTooltip>
        </span>
      </div>
      <ReportTableCard
        title="キャンペーン別のアトリビューション"
        help={
          <>
            3つの金額は足し合わせないでください。
            「関与金額」は受注に接触したすべてのキャンペーンに同じ金額を計上するため、合計は売上を超えます。
            「初回接点」「最終接点」はそれぞれ売上を重複なく1回だけ配分します。
            接点は、プロジェクトに紐付けたメール・フォーム・セグメント・計測用リンクへの反応から記録されます。
          </>
        }
      >
        <DataTable
          columns={columns.map((column) =>
            column.key === "name"
              ? column
              : {
                  ...column,
                  headClassName: "text-right whitespace-nowrap",
                  cellClassName: "text-right tabular-nums whitespace-nowrap",
                },
          )}
          rows={report.campaigns}
          rowKey={(row) => row.id}
          caption="キャンペーン別のアトリビューション"
          emptyTitle="キャンペーンの接点がありません"
          emptyDescription="プロジェクトにメールやフォームを紐付けると、そこへの反応が接点として記録されます。"
        />
      </ReportTableCard>
      <CampaignCostsPanel campaigns={report.campaigns} currency={report.currency} />
    </div>
  );
}
