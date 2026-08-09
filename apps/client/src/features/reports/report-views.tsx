import { Link, useNavigate } from "@tanstack/react-router";
import {
  Activity,
  CircleDollarSign,
  Globe2,
  Send,
  TrendingUp,
  UserCheck,
  UsersRound,
} from "lucide-react";
import { type ReactNode } from "react";

import { FormNativeSelect, FormSelectOption, MetricCard, MetricGrid } from "@/components/app-ui";
import { type DataTableColumn, DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type AutomationsReport,
  type ContactsReport,
  type DealsReport,
  type EmailsReport,
  type ReportSearch,
  type SiteReport,
} from "@/features/reports/report-api";
import { formatMoney, formatPercent, rate } from "@/lib/format";

import {
  NoReportData,
  ProgressRow,
  RankingCard,
  ReportStatusBadge,
  ReportTableCard,
  sourceTypeLabel,
  TrendCard,
} from "./report-widgets";

export function ContactsReportView({ report }: { report: ContactsReport }): ReactNode {
  return (
    <>
      <MetricGrid className="sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="総連絡先" value={report.summary.totalContacts} icon={<UsersRound />} />
        <MetricCard label="アクティブ" value={report.summary.activeContacts} icon={<UserCheck />} />
        <MetricCard label="期間内の新規" value={report.summary.newContacts} icon={<TrendingUp />} />
        <MetricCard
          label="期間内のアーカイブ"
          value={report.summary.archivedContacts}
          icon={<Activity />}
        />
      </MetricGrid>
      <TrendCard
        title="連絡先の推移"
        description="期間内に追加・アーカイブされた連絡先"
        data={report.trend}
        series={[
          { key: "added", label: "追加", color: "var(--color-chart-1)" },
          { key: "archived", label: "アーカイブ", color: "var(--color-chart-2)" },
        ]}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <RankingCard
          title="上位セグメント"
          description="現在のアクティブ連絡先数"
          items={report.topSegments}
        />
        <RankingCard
          title="上位タグ"
          description="現在のアクティブ連絡先数"
          items={report.topTags}
        />
      </div>
    </>
  );
}

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
      header: "PV",
      cell: (page) => page.views.toLocaleString(),
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    {
      key: "uniqueVisitors",
      header: "訪問者",
      cell: (page) => page.uniqueVisitors.toLocaleString(),
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    {
      key: "identifiedContacts",
      header: "特定済み",
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
      header: "送信",
      cell: (form) => form.submissions.toLocaleString(),
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    {
      key: "contacts",
      header: "連絡先",
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
      header: "表示",
      cell: (message) => message.impressions.toLocaleString(),
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    {
      key: "clicks",
      header: "クリック",
      cell: (message) => message.clicks.toLocaleString(),
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    {
      key: "clickRate",
      header: "クリック率",
      cell: (message) => formatPercent(message.clickRate),
      headClassName: "px-4 text-right",
      cellClassName: "px-4 text-right",
    },
  ];
  return (
    <>
      <MetricGrid className="sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="ページビュー" value={report.summary.pageViews} icon={<Globe2 />} />
        <MetricCard label="ユニーク訪問者" value={report.summary.uniqueVisitors} />
        <MetricCard
          label="特定済み率"
          value={formatPercent(report.summary.identificationRate)}
          icon={<UserCheck />}
        />
        <MetricCard label="フォーム送信" value={report.summary.submissions} />
        <MetricCard label="メッセージ表示" value={report.summary.messageImpressions} />
        <MetricCard label="メッセージクリック" value={report.summary.messageClicks} />
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
      <ReportTableCard title="サイトメッセージ（累計）">
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
