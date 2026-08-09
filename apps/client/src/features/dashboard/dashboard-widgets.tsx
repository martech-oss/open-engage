import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

/**
 * Dense presentation pieces for the dashboard: the design puts six KPI tiles,
 * two panels and a notice band on one screen, so every one of these is tuned
 * tighter than the shared `MetricCard`/`Card` header pairs used elsewhere.
 */

/** Notice band above the KPI row, e.g. the failed-delivery warning. */
export function NoticeBanner({
  message,
  detail,
  actionLabel,
  to,
}: {
  message: string;
  detail: string;
  actionLabel: string;
  to: string;
}): ReactNode {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border border-warning/45 bg-warning/10 px-3.5 py-2.5">
      <span className="size-1.5 shrink-0 rounded-full bg-warning" />
      <span className="text-xs font-medium text-warning-foreground">{message}</span>
      <span className="text-xs text-warning-foreground/70">{detail}</span>
      <Link to={to} className="ml-auto text-xs font-medium text-primary hover:underline">
        {actionLabel} →
      </Link>
    </div>
  );
}

export function KpiGrid({ children }: { children: ReactNode }): ReactNode {
  return <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 2xl:grid-cols-6">{children}</div>;
}

export function KpiCard({
  label,
  value,
  delta,
  emphasis = "normal",
  children,
}: {
  label: string;
  value: string;
  delta?: ReactNode;
  /** `alert` paints the figure in the destructive colour, for overdue counts. */
  emphasis?: "normal" | "alert";
  children?: ReactNode;
}): ReactNode {
  return (
    <Card size="sm" className="gap-1.5 py-3">
      <CardHeader className="gap-1.5 px-3.5">
        <CardDescription className="text-[11.5px]">{label}</CardDescription>
        <CardTitle className="flex items-baseline gap-1.5">
          <span
            className={cn(
              "truncate text-[23px] leading-none font-semibold tabular-nums",
              emphasis === "alert" && "text-destructive",
            )}
          >
            {value}
          </span>
          {delta}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex h-5 items-center px-3.5 text-[11px] text-muted-foreground">
        {children}
      </CardContent>
    </Card>
  );
}

/** Week-over-week movement chip; renders nothing when there is no comparable period. */
export function DeltaChip({
  value,
  unit = "%",
}: {
  value: number | null;
  unit?: "%" | "pt";
}): ReactNode {
  if (value === null) return null;
  const sign = value > 0 ? "+" : "";
  return (
    <span
      className={cn(
        "shrink-0 text-[11px] font-medium tabular-nums",
        value > 0 && "text-success",
        value < 0 && "text-destructive",
        value === 0 && "text-muted-foreground",
      )}
    >
      {sign}
      {value}
      {unit === "%" ? "%" : ""}
    </span>
  );
}

/** Seven-bucket bar strip inside a KPI tile, with the latest bucket picked out. */
export function Sparkline({ values }: { values: number[] }): ReactNode {
  const max = Math.max(...values, 1);
  return (
    <div className="flex h-5 w-full items-end gap-0.5" aria-hidden>
      {values.map((value, index) => (
        <span
          key={index}
          className={cn(
            "flex-1 rounded-[1px]",
            index === values.length - 1 ? "bg-primary" : "bg-border",
          )}
          style={{ height: `${Math.max(8, (value / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

export function MeterBar({ percent }: { percent: number }): ReactNode {
  return (
    <Progress
      className="w-full"
      value={Math.min(100, Math.max(0, percent))}
      variant="success"
      aria-hidden
    />
  );
}

/** Panel shell for the two lower cards: flush header row over a scrolling body. */
export function Panel({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <Card size="sm" className={cn("min-h-0 gap-0 py-0", className)}>
      <CardHeader className="shrink-0 border-b px-4 py-3">
        <CardTitle className="text-[13.5px] font-bold">{title}</CardTitle>
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent className="min-h-0 flex-1 px-0">{children}</CardContent>
    </Card>
  );
}

export function PanelLink({ to, children }: { to: string; children: ReactNode }): ReactNode {
  return (
    <Link to={to} className="text-[11.5px] text-primary hover:underline">
      {children}
    </Link>
  );
}

const AUTOMATION_COLUMNS = "grid grid-cols-[1fr_72px_72px_88px] items-center gap-2 px-4";

export function AutomationRows({
  rows,
}: {
  rows: Array<{ id: string; name: string; active: number; done: number; lastRun: string }>;
}): ReactNode {
  return (
    <div className="min-h-0 overflow-y-auto">
      <div
        className={cn(
          AUTOMATION_COLUMNS,
          "sticky top-0 border-b bg-table-header py-1.5 font-mono text-[10px] font-medium tracking-[0.06em] text-muted-foreground uppercase",
        )}
      >
        <div>名前</div>
        <div className="text-right">進行中</div>
        <div className="text-right">完了</div>
        <div className="text-right">最終実行</div>
      </div>
      {rows.map((row) => (
        <Link
          key={row.id}
          to="/automations/$id"
          params={{ id: row.id }}
          className={cn(AUTOMATION_COLUMNS, "border-b border-row-border py-2.5 hover:bg-secondary")}
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="size-1.5 shrink-0 rounded-full bg-success" />
            <span className="truncate text-[12.5px] font-medium">{row.name}</span>
          </div>
          <div className="text-right text-xs font-medium tabular-nums">
            {row.active.toLocaleString()}
          </div>
          <div className="text-right text-xs text-muted-foreground tabular-nums">
            {row.done.toLocaleString()}
          </div>
          <div className="truncate text-right text-[11px] text-muted-foreground">{row.lastRun}</div>
        </Link>
      ))}
    </div>
  );
}

export function ActivityRows({
  events,
}: {
  events: Array<{ id: string; label: string; type: string; at: string; color: string }>;
}): ReactNode {
  return (
    <div className="min-h-0 overflow-y-auto py-1">
      {events.map((event) => (
        <div
          key={event.id}
          className="grid grid-cols-[6px_1fr_auto] items-baseline gap-2.5 px-4 py-1.5"
        >
          <span
            className="size-1.5 translate-y-1 rounded-full"
            style={{ backgroundColor: event.color }}
          />
          <div className="min-w-0">
            <div className="text-[12.5px] leading-relaxed">{event.label}</div>
            <div className="font-mono text-[10.5px] text-muted-foreground">{event.type}</div>
          </div>
          <span className="shrink-0 text-[10.5px] text-muted-foreground">{event.at}</span>
        </div>
      ))}
    </div>
  );
}
