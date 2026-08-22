import { useSuspenseQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { PageLayout, SimpleEmpty } from "@/components/app-ui";
import { SimpleBarChart } from "@/components/app-ui/bar-chart";
import { dashboardQueryOptions, TREND_WINDOW } from "@/features/dashboard/dashboard-api";
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
import { formatMoney } from "@/lib/format";
import { CONTACT_EVENT_LABELS, contactEventTone, type EventTone } from "@/lib/status-labels";
import { useWorkspaceFormatters } from "@/lib/workspace-time";

const TONE_COLORS: Record<EventTone, string> = {
  success: "var(--color-success)",
  danger: "var(--color-destructive)",
  info: "var(--color-chart-4)",
  neutral: "var(--color-muted-foreground)",
};

export function DashboardPage(): ReactNode {
  const { formatRelativeTime } = useWorkspaceFormatters();
  const { data } = useSuspenseQuery(dashboardQueryOptions());
  const deliveryHealth = data.deliveries.health.points;
  const activeAutomations = data.automations.top.map((item) => ({
    id: item.id,
    name: item.name,
    active: item.active,
    done: item.completed,
    lastRun: formatRelativeTime(item.updatedAt),
  }));

  const activity = data.recentActivity.map((event, index) => ({
    id: `${event.occurredAt}-${index}`,
    label: CONTACT_EVENT_LABELS[event.type] ?? event.type,
    type: event.type,
    at: formatRelativeTime(event.occurredAt),
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
          delta={<DeltaChip value={data.contacts.changePercent} />}
        >
          <Sparkline
            values={data.contacts.trend.points.slice(-TREND_WINDOW).map((point) => point.added)}
          />
        </KpiCard>
        <KpiCard
          label="30日間の配信"
          value={data.deliveries.sent.toLocaleString()}
          delta={<DeltaChip value={data.deliveries.sendChangePercent} />}
        >
          <Sparkline values={deliveryHealth.slice(-TREND_WINDOW).map((point) => point.sends)} />
        </KpiCard>
        <KpiCard
          label="配信到達率"
          value={`${data.deliveries.deliveryRate}%`}
          delta={<DeltaChip value={data.deliveries.deliveryRateChangePoints} unit="pt" />}
        >
          <MeterBar percent={data.deliveries.deliveryRate} />
        </KpiCard>
        <KpiCard
          label="公開オートメーション"
          value={data.automations.count.toLocaleString()}
          delta={
            <span className="text-[11px] text-muted-foreground">
              / 下書き {data.automations.draftCount}
            </span>
          }
        >
          進行中 {data.automations.enrolledCount.toLocaleString()} 件
        </KpiCard>
        <KpiCard
          label="進行中の商談"
          value={formatMoney(data.deals.openValue, data.deals.currency)}
          delta={
            <span className="text-[11px] text-muted-foreground">
              / 新規 {data.deals.created.toLocaleString()}
            </span>
          }
        >
          {data.deals.openCount.toLocaleString()} 件・平均{" "}
          {formatMoney(Math.round(data.deals.averageOpenValue), data.deals.currency)}
        </KpiCard>
        <KpiCard
          label="期限切れタスク"
          value={data.deals.overdueTasks.toLocaleString()}
          emphasis={data.deals.overdueTasks > 0 ? "alert" : "normal"}
          delta={
            <span className="text-[11px] text-muted-foreground">
              / 未完了 {data.deals.openTasks.toLocaleString()}
            </span>
          }
        >
          完了 {data.deals.completedTasks.toLocaleString()} 件
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
