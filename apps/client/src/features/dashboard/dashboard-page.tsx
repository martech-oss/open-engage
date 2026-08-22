import { useSuspenseQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { PageLayout, SimpleBarChart, SimpleEmpty } from "@/components/app-ui";
import { automationsQueryOptions } from "@/features/automations/automation-api";
import {
  contactTrendQueryOptions,
  dashboardQueryOptions,
  dealSummaryQueryOptions,
  deliveryTrendQueryOptions,
  type DashboardClock,
  rateDelta,
  toDeliveryHealth,
  TREND_WINDOW,
  windowDelta,
} from "@/features/dashboard/dashboard-api";
import {
  ActivityRows,
  AutomationRows,
  DeltaChip,
  KpiCard,
  KpiGrid,
  MeterBar,
  NoticeBanner,
  Panel,
  PanelLink,
  Sparkline,
} from "@/features/dashboard/dashboard-widgets";
import { formatMoney, formatRelativeTime, rate } from "@/lib/format";
import { CONTACT_EVENT_LABELS, contactEventTone, type EventTone } from "@/lib/status-labels";

/** Only the busiest handful of automations fit the panel before it starts scrolling. */
const AUTOMATION_ROW_LIMIT = 6;
const ACTIVITY_ROW_LIMIT = 12;

const TONE_COLORS: Record<EventTone, string> = {
  success: "var(--color-success)",
  danger: "var(--color-destructive)",
  info: "var(--color-chart-4)",
  neutral: "var(--color-muted-foreground)",
};

export function DashboardPage({ clock }: { clock: DashboardClock }): ReactNode {
  const { data } = useSuspenseQuery(dashboardQueryOptions());
  const { data: emails } = useSuspenseQuery(deliveryTrendQueryOptions(clock));
  const { data: contacts } = useSuspenseQuery(contactTrendQueryOptions(clock));
  const { data: deals } = useSuspenseQuery(dealSummaryQueryOptions(clock));
  const { data: automations } = useSuspenseQuery(automationsQueryOptions());

  const deliveryHealth = toDeliveryHealth(emails.trend);
  const deliveredRate = rate(data.deliveries.delivered, data.deliveries.sent);
  const sendDelta = windowDelta(emails.trend.map((point) => point.sends));
  const contactDelta = windowDelta(contacts.trend.map((point) => point.added));
  const draftAutomations = automations.filter((item) => item.status === "draft").length;
  const enrolled = automations.reduce((total, item) => total + item.activeCount, 0);
  const averageDealValue =
    deals.summary.openCount > 0 ? deals.summary.openValue / deals.summary.openCount : 0;

  const activeAutomations = automations
    .filter((item) => item.status === "active")
    .sort((left, right) => right.activeCount - left.activeCount)
    .slice(0, AUTOMATION_ROW_LIMIT)
    .map((item) => ({
      id: item.id,
      name: item.name,
      active: item.activeCount,
      done: item.completedCount,
      lastRun: formatRelativeTime(item.updatedAt, { now: clock.now }),
    }));

  const activity = data.recentEvents.slice(0, ACTIVITY_ROW_LIMIT).map((event, index) => ({
    id: `${event.occurredAt}-${index}`,
    label: CONTACT_EVENT_LABELS[event.type] ?? event.type,
    type: event.type,
    at: formatRelativeTime(event.occurredAt, { now: clock.now }),
    color: TONE_COLORS[contactEventTone(event.type)],
  }));

  return (
    <PageLayout title="ホーム">
      {data.deliveries.failed > 0 && (
        <NoticeBanner
          message={`配信に失敗したメッセージが ${data.deliveries.failed.toLocaleString()} 件あります`}
          detail="直近30日・メールレポートで内訳を確認できます"
          actionLabel="確認する"
          to="/reports"
        />
      )}
      {data.briefs.overdueReviews > 0 && (
        <NoticeBanner
          message={`レビュー期限を超過した施策が ${data.briefs.overdueReviews.toLocaleString()} 件あります`}
          detail="成果指標と成功基準を確認してください"
          actionLabel="施策を確認"
          to="/automations/briefs"
        />
      )}

      <KpiGrid>
        <KpiCard
          label="アクティブ連絡先"
          value={data.contacts.count.toLocaleString()}
          delta={<DeltaChip value={contactDelta.changePercent} />}
        >
          <Sparkline values={contacts.trend.slice(-TREND_WINDOW).map((point) => point.added)} />
        </KpiCard>
        <KpiCard
          label="30日間の配信"
          value={data.deliveries.sent.toLocaleString()}
          delta={<DeltaChip value={sendDelta.changePercent} />}
        >
          <Sparkline values={emails.trend.slice(-TREND_WINDOW).map((point) => point.sends)} />
        </KpiCard>
        <KpiCard
          label="配信到達率"
          value={`${deliveredRate}%`}
          delta={<DeltaChip value={rateDelta(emails.trend)} unit="pt" />}
        >
          <MeterBar percent={deliveredRate} />
        </KpiCard>
        <KpiCard
          label="公開オートメーション"
          value={data.automations.count.toLocaleString()}
          delta={
            <span className="text-[11px] text-muted-foreground">/ 下書き {draftAutomations}</span>
          }
        >
          進行中 {enrolled.toLocaleString()} 件
        </KpiCard>
        <KpiCard
          label="進行中の商談"
          value={formatMoney(deals.summary.openValue, deals.currency)}
          delta={
            <span className="text-[11px] text-muted-foreground">
              / 新規 {deals.summary.created.toLocaleString()}
            </span>
          }
        >
          {deals.summary.openCount.toLocaleString()} 件・平均{" "}
          {formatMoney(Math.round(averageDealValue), deals.currency)}
        </KpiCard>
        <KpiCard
          label="期限切れタスク"
          value={deals.summary.overdueTasks.toLocaleString()}
          emphasis={deals.summary.overdueTasks > 0 ? "alert" : "normal"}
          delta={
            <span className="text-[11px] text-muted-foreground">
              / 未完了 {deals.summary.openTasks.toLocaleString()}
            </span>
          }
        >
          完了 {deals.summary.completedTasks.toLocaleString()} 件
        </KpiCard>
      </KpiGrid>

      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <div className="flex flex-col gap-4">
          <Panel
            title="配信ヘルス"
            action={
              <div className="flex gap-3 text-[11px] text-muted-foreground">
                <LegendItem color="var(--color-success)" label="到達" />
                <LegendItem color="var(--color-destructive)" label="未達" />
              </div>
            }
          >
            <div className="px-4 py-3">
              {deliveryHealth.every((point) => point.delivered + point.undelivered === 0) ? (
                <SimpleEmpty compact label="この期間の配信データはありません" />
              ) : (
                <SimpleBarChart
                  data={deliveryHealth.map((point) => ({ ...point }))}
                  series={[
                    { key: "delivered", label: "到達", color: "var(--color-success)" },
                    { key: "undelivered", label: "未達", color: "var(--color-destructive)" },
                  ]}
                  height={150}
                  stacked
                />
              )}
            </div>
          </Panel>
          <Panel
            title="稼働中のオートメーション"
            action={<PanelLink to="/automations">すべて見る</PanelLink>}
          >
            {activeAutomations.length === 0 ? (
              <SimpleEmpty compact label="稼働中のオートメーションはありません" />
            ) : (
              <AutomationRows rows={activeAutomations} />
            )}
          </Panel>
        </div>

        <Panel
          title="アクティビティ"
          className="max-h-[560px]"
          action={
            <span className="text-[11px] text-muted-foreground">直近 {activity.length} 件</span>
          }
        >
          {activity.length === 0 ? (
            <SimpleEmpty compact label="まだイベントがありません" />
          ) : (
            <ActivityRows events={activity} />
          )}
        </Panel>
      </div>
    </PageLayout>
  );
}

function LegendItem({ color, label }: { color: string; label: string }): ReactNode {
  return (
    <span className="flex items-center gap-1.5">
      <span className="size-1.5 rounded-[2px]" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
