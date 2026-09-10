import { MetricCard, MetricGrid } from "@/components/app-ui";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { formatMoney } from "@/lib/format";
import type { AcquisitionReport } from "@openengage/core/reports";
import { ACQUISITION_CHANNEL_LABELS } from "@openengage/core/web";

import { ReportTableCard } from "../report-widgets";

type SourceRow = AcquisitionReport["sources"][number];
export function AcquisitionReportView({ report }: { report: AcquisitionReport }) {
  const columns: DataTableColumn<SourceRow>[] = [
    {
      key: "channel",
      header: "チャネル",
      cell: (row) => ACQUISITION_CHANNEL_LABELS[row.channel],
      cellClassName: "px-4 whitespace-nowrap",
      headClassName: "px-4",
    },
    ...(
      [
        ["source", "流入元"],
        ["medium", "メディア"],
        ["campaign", "キャンペーン"],
      ] as const
    ).map(([key, header]) => ({
      key,
      header,
      cell: (row: SourceRow) => (
        <span className="block max-w-48 truncate" title={row[key]}>
          {row[key] || "—"}
        </span>
      ),
    })),
    ...(
      [
        ["pageViews", "PV"],
        ["visitors", "訪問者"],
        ["submissions", "フォーム送信"],
        ["submittingContacts", "送信者"],
        ["mql", "MQL到達"],
        ["dealsCreated", "商談作成"],
        ["won", "受注"],
      ] as const
    ).map(([key, header]) => ({
      key,
      header,
      cell: (row: SourceRow) => row[key].toLocaleString(),
      headClassName: "text-right whitespace-nowrap",
      cellClassName: "text-right tabular-nums",
    })),
    {
      key: "wonValue",
      header: "受注金額",
      cell: (row) => formatMoney(row.wonValue, report.currency),
      headClassName: "px-4 text-right",
      cellClassName: "px-4 text-right tabular-nums whitespace-nowrap",
    },
  ];
  return (
    <>
      <MetricGrid className="sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="訪問者" value={report.summary.visitors} />
        <MetricCard label="フォーム送信者" value={report.summary.submittingContacts} />
        <MetricCard label="MQL到達" value={report.summary.mql} />
        <MetricCard
          label="受注金額"
          value={formatMoney(report.summary.wonValue, report.currency)}
        />
      </MetricGrid>
      <div className="space-y-1 text-sm text-muted-foreground">
        <p>
          期間内の活動・成果を、保存中の履歴で最初に記録された流入元に集計しています。初回流入日が期間外でも、期間内の成果は含みます。
        </p>
        <p>
          訪問者は識別済みの同一人物をまとめた数です。MQLは実際の初回到達を数え、商談と受注は選択した通貨だけを集計します。受注も商談作成時点までの流入元に集計し、作成後の訪問元には移しません。
        </p>
        <p>
          同意のない訪問や削除・アーカイブ済みの履歴は復元できません。成果より前の流入情報がない場合は「不明」です。初回流入への集計は因果関係を示すものではありません。
        </p>
      </div>
      <ReportTableCard title="流入元別の成果">
        <DataTable
          columns={columns}
          rows={report.sources}
          rowKey={(row) => JSON.stringify([row.channel, row.source, row.medium, row.campaign])}
          caption="初回流入元別レポート"
          emptyTitle="この期間のデータはありません"
          emptyDescription="期間を変更するか、サイト計測やフォーム獲得後に確認してください。"
        />
      </ReportTableCard>
    </>
  );
}
