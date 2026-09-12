import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { lazy, type ReactNode, Suspense, useRef, useState } from "react";

import {
  ErrorAlert,
  HelpTooltip,
  MetricCard,
  MetricGrid,
  PageLayout,
  SimpleEmpty,
} from "@/components/app-ui";
import { SimpleBarChart } from "@/components/app-ui/bar-chart";
import { Button } from "@/components/ui/button";
import { dashboardQueryOptions } from "@/features/dashboard/dashboard-api";
import { formatMoney } from "@/lib/format";
import { CONTACT_EVENT_LABELS, contactEventTone } from "@/lib/status-labels";
import { useWorkspaceFormatters } from "@/lib/workspace-time";
import type { Dashboard } from "@openengage/core/reports";

import { AutomationRows, DeltaChip, Panel } from "./dashboard-widgets";

const MonitorContact = lazy(async () => ({
  default: (await import("./monitor-contact")).MonitorContact,
}));

export function DashboardPage(): ReactNode {
  const { formatDateTime, formatRelativeTime } = useWorkspaceFormatters();
  const query = useSuspenseQuery({
    ...dashboardQueryOptions(),
    refetchOnWindowFocus: false,
    retry: false,
  });
  const { data } = query;
  const [contactId, setContactId] = useState<string | null>(null);
  const contactTrigger = useRef<HTMLButtonElement | null>(null);
  const hasAttention =
    data.deliveries.failed > 0 || data.briefs.overdueReviews > 0 || data.deals.overdueTasks > 0;
  const reportSearch = {
    view: "emails" as const,
    from: data.deliveries.totalsRange.from,
    to: data.deliveries.totalsRange.to,
    currency: "",
  };
  return (
    <PageLayout
      title="モニター"
      action={
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-muted-foreground">
            集計 {formatDateTime(data.asOf)} · {data.timezone}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw data-icon="inline-start" />
            {query.isFetching ? "更新中…" : "更新"}
          </Button>
        </div>
      }
    >
      {query.isRefetchError ? (
        <ErrorAlert>
          更新できませんでした。直前に取得したデータを表示しています。もう一度「更新」を押してください。
        </ErrorAlert>
      ) : null}
      {hasAttention ? (
        <section aria-label="要確認" className="overflow-hidden rounded-lg border bg-card">
          <div className="flex items-center gap-2 border-b px-4 py-2">
            <span aria-hidden className="size-2 rounded-full bg-warning" />
            <h2 className="text-base font-semibold">要確認</h2>
          </div>
          {data.deliveries.failed > 0 ? (
            <AttentionRow label="配信失敗" detail="直近30日" count={data.deliveries.failed}>
              <Link to="/reports" search={reportSearch}>
                レポートを開く
              </Link>
            </AttentionRow>
          ) : null}
          {data.briefs.overdueReviews > 0 ? (
            <AttentionRow label="施策レビュー期限超過" count={data.briefs.overdueReviews}>
              <Link to="/projects" search={{ view: "briefs" }}>
                施策を開く
              </Link>
            </AttentionRow>
          ) : null}
          {data.deals.overdueTasks > 0 ? (
            <AttentionRow label="営業タスク期限超過" count={data.deals.overdueTasks}>
              <Link to="/tasks">タスクを開く</Link>
            </AttentionRow>
          ) : null}
        </section>
      ) : (
        <p className="flex items-center gap-2 py-1 text-sm text-text-secondary">
          <span aria-hidden className="size-2 rounded-full bg-success" />
          現在、要確認項目はありません
        </p>
      )}
      <MetricGrid className="grid-cols-1 sm:grid-cols-3">
        <MetricCard
          label="アクティブ連絡先"
          value={data.contacts.count}
          description={
            <>
              新規登録の直近7日比較 <DeltaChip value={data.contacts.changePercent} />
            </>
          }
        />
        <MetricCard
          label="公開フロー"
          value={data.automations.count}
          description={`進行中 ${data.automations.enrolledCount.toLocaleString()} 件 / 下書き ${data.automations.draftCount.toLocaleString()} 件`}
        />
        <MetricCard
          label="進行中商談額"
          value={formatMoney(data.deals.openValue, data.deals.currency)}
          description={`${data.deals.openCount.toLocaleString()} 件・現在の商談残高`}
        />
      </MetricGrid>
      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(280px,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel
            title="配信の推移"
            action={
              <Link
                to="/reports"
                search={reportSearch}
                className="text-xs text-primary hover:underline"
              >
                配信を分析
              </Link>
            }
          >
            <DeliveryTrend deliveries={data.deliveries} />
          </Panel>
          <Panel
            title="稼働フロー"
            action={
              <Link to="/automations" className="text-xs text-primary hover:underline">
                フロー一覧
              </Link>
            }
          >
            {data.automations.top.length ? (
              <AutomationRows
                rows={data.automations.top.map((row) => ({
                  ...row,
                  updatedAt: formatDateTime(row.updatedAt),
                }))}
              />
            ) : (
              <SimpleEmpty compact label="稼働中のフローはありません" />
            )}
          </Panel>
        </div>
        <Panel
          title="最近の接点"
          action={
            <span className="text-xs text-muted-foreground">
              直近 {data.recentActivity.length} 件
            </span>
          }
        >
          {data.recentActivity.length ? (
            <ol className="divide-y divide-row-border">
              {data.recentActivity.map((event, index) => (
                <li
                  key={`${event.occurredAt}-${index}`}
                  className="flex min-h-14 items-start justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p
                      className={`text-sm font-medium wrap-anywhere ${contactEventTone(event.type) === "danger" ? "text-destructive" : ""}`}
                    >
                      {CONTACT_EVENT_LABELS[event.type] ?? event.type}
                    </p>
                    {event.contactId ? (
                      <button
                        className="mt-1 rounded-sm text-xs text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={(e) => {
                          contactTrigger.current = e.currentTarget;
                          setContactId(event.contactId);
                        }}
                      >
                        連絡先を確認
                      </button>
                    ) : (
                      <p className="mt-1 text-xs text-muted-foreground">連絡先の関連付けなし</p>
                    )}
                  </div>
                  <time
                    dateTime={event.occurredAt}
                    title={formatDateTime(event.occurredAt)}
                    className="shrink-0 text-xs text-muted-foreground"
                  >
                    {formatRelativeTime(event.occurredAt)}
                  </time>
                </li>
              ))}
            </ol>
          ) : (
            <SimpleEmpty compact label="まだ接点の記録はありません" />
          )}
        </Panel>
      </div>
      {contactId ? (
        <Suspense fallback={<output>連絡先を読み込んでいます…</output>}>
          <MonitorContact
            contactId={contactId}
            onChanged={async () => {
              await query.refetch();
            }}
            onClose={() => {
              setContactId(null);
              requestAnimationFrame(() => contactTrigger.current?.focus());
            }}
          />
        </Suspense>
      ) : null}
    </PageLayout>
  );
}
function AttentionRow({
  label,
  detail,
  count,
  children,
}: {
  label: string;
  detail?: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-1 border-b border-row-border px-4 py-2 last:border-0">
      <span className="text-sm font-medium">{label}</span>
      {detail ? <span className="text-xs text-muted-foreground">{detail}</span> : null}
      <span className="ml-auto font-semibold tabular-nums">
        {count.toLocaleString()} <span className="text-xs font-normal">件</span>
      </span>
      <span className="text-xs text-primary hover:underline">{children}</span>
    </div>
  );
}
function Legend({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden className={`size-2 rounded-sm ${color}`} />
      {children}
    </span>
  );
}

function DeliveryTrend({ deliveries }: { deliveries: Dashboard["deliveries"] }) {
  const health = deliveries.health;
  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <p>
          <span className="mr-2 text-xs text-muted-foreground">30日間の配信</span>
          <strong className="text-lg font-semibold">{deliveries.sent.toLocaleString()}</strong>
          <span className="ml-1 text-xs">件</span>
        </p>
        <p>
          <span className="mr-2 inline-flex items-center text-xs text-muted-foreground">
            到達率
            <HelpTooltip label="到達率">
              到達件数 ÷ 送信件数。送信件数が0の場合は — を表示します。
            </HelpTooltip>
          </span>
          <strong className="text-lg font-semibold">
            {deliveries.sent ? `${deliveries.deliveryRate}%` : "—"}
          </strong>
        </p>
        <p className="text-xs text-muted-foreground">
          到達率の直近7日比較 <DeltaChip value={deliveries.deliveryRateChangePoints} unit="pt" />
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        合計：{deliveries.totalsRange.from} 〜 {deliveries.totalsRange.to}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          日別件数：{health.from} 〜 {health.to}
        </span>
        <div className="flex gap-4">
          <Legend color="bg-primary">到達</Legend>
          <span className="inline-flex items-center">
            <Legend color="bg-chart-4">到達未確認</Legend>
            <HelpTooltip label="到達未確認">
              送信数と到達数の差です。配信失敗の確定件数とは異なります。
            </HelpTooltip>
          </span>
        </div>
      </div>
      {health.points.every((point) => point.sends === 0) ? (
        <SimpleEmpty compact label="この期間の配信データはありません" />
      ) : (
        <SimpleBarChart
          data={health.points.map((point) => ({ ...point }))}
          height={180}
          stacked
          valueFormat={(value) => `${value.toLocaleString()}件`}
          series={[
            { key: "delivered", label: "到達", color: "var(--primary)" },
            { key: "undelivered", label: "到達未確認", color: "var(--chart-4)" },
          ]}
        />
      )}
    </div>
  );
}
