import { useNavigate } from "@tanstack/react-router";
import { CircleDollarSign } from "lucide-react";
import type { ReactNode } from "react";

import { FormNativeSelect, FormSelectOption, MetricCard, MetricGrid } from "@/components/app-ui";
import { type DataTableColumn, DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DealsReport, ReportSearch } from "@/features/reports/report-api";
import { formatMoney, formatPercent } from "@/lib/format";

import { NoReportData, ProgressRow, ReportTableCard, TrendCard } from "../report-widgets";

export function DealsReportView({
  report,
  search,
}: {
  report: DealsReport;
  search: ReportSearch;
}): ReactNode {
  const navigate = useNavigate();
  const ownerColumns: DataTableColumn<DealsReport["owners"][number]>[] = [
    {
      key: "name",
      header: "担当者",
      cell: (owner) => owner.name,
      headClassName: "px-4",
      cellClassName: "px-4 font-medium",
    },
    {
      key: "created",
      header: "作成",
      cell: (owner) => owner.created.toLocaleString(),
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    {
      key: "won",
      header: "獲得",
      cell: (owner) => owner.won.toLocaleString(),
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    {
      key: "lost",
      header: "失注",
      cell: (owner) => owner.lost.toLocaleString(),
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    {
      key: "openCount",
      header: "進行中",
      cell: (owner) => owner.openCount.toLocaleString(),
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    {
      key: "wonValue",
      header: "獲得金額",
      cell: (owner) => formatMoney(owner.wonValue, report.currency),
      headClassName: "px-4 text-right",
      cellClassName: "px-4 text-right tabular-nums",
    },
  ];
  return (
    <>
      <div className="max-w-52">
        <FormNativeSelect
          label="通貨"
          name="reportCurrency"
          value={report.currency}
          onChange={(event) =>
            void navigate({
              to: "/reports",
              search: { ...search, currency: event.target.value },
            })
          }
        >
          {report.currencies.map((currency) => (
            <FormSelectOption key={currency} value={currency}>
              {currency}
            </FormSelectOption>
          ))}
        </FormNativeSelect>
      </div>
      <MetricGrid className="sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="作成" value={report.summary.created} />
        <MetricCard label="獲得" value={report.summary.won} />
        <MetricCard label="失注" value={report.summary.lost} />
        <MetricCard label="勝率" value={formatPercent(report.summary.winRate)} />
        <MetricCard
          label="獲得金額"
          value={formatMoney(report.summary.wonValue, report.currency)}
          icon={<CircleDollarSign />}
        />
        <MetricCard
          label="進行中金額"
          value={formatMoney(report.summary.openValue, report.currency)}
        />
      </MetricGrid>
      <TrendCard
        title="商談の推移"
        description="作成・獲得・失注になった商談数"
        data={report.trend}
        series={[
          { key: "created", label: "作成", color: "var(--color-chart-4)" },
          { key: "won", label: "獲得", color: "var(--color-chart-1)" },
          { key: "lost", label: "失注", color: "var(--color-chart-3)" },
        ]}
      />
      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <ReportTableCard title="担当者別セールスパフォーマンス">
          <DataTable
            columns={ownerColumns}
            rows={report.owners}
            rowKey={(owner) => owner.id}
            caption="担当者別商談レポート"
            emptyTitle="この期間のデータはありません"
            emptyDescription="期間を変更するか、データが蓄積されてから確認してください。"
          />
        </ReportTableCard>
        <Card>
          <CardHeader>
            <CardTitle>タスク概要</CardTitle>
            <CardDescription>現在の未完了と期間内の完了</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ProgressRow
              label="未完了"
              value={report.summary.openTasks}
              maximum={Math.max(report.summary.openTasks, report.summary.completedTasks, 1)}
            />
            <ProgressRow
              label="期限超過"
              value={report.summary.overdueTasks}
              maximum={Math.max(report.summary.openTasks, 1)}
              destructive
            />
            <ProgressRow
              label="期間内に完了"
              value={report.summary.completedTasks}
              maximum={Math.max(report.summary.openTasks, report.summary.completedTasks, 1)}
            />
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>商談フォーキャスト</CardTitle>
          <CardDescription>
            完了予定日が期間内にある進行中商談を、ステージ確度で加重
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {report.forecast.map((stage) => (
            <div key={stage.stageId} className="rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
                <span className="font-medium">{stage.stageName}</span>
                <Badge variant="secondary" className="ml-auto">
                  {stage.probability}%
                </Badge>
              </div>
              <p className="mt-3 text-lg font-medium tabular-nums">
                {formatMoney(stage.weightedValue, report.currency)}
              </p>
              <p className="text-xs text-muted-foreground">
                {stage.dealCount.toLocaleString()}件・総額
                {formatMoney(stage.dealValue, report.currency)}
              </p>
            </div>
          ))}
          {report.forecast.length === 0 ? (
            <div className="md:col-span-2 xl:col-span-3">
              <NoReportData />
            </div>
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}
