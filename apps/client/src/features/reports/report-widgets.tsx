import { type ReactNode } from "react";

import { EmptyState, SimpleBarChart } from "@/components/app-ui";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress, ProgressLabel } from "@/components/ui/progress";
import { TableCell } from "@/components/ui/table";
import { RESOURCE_STATUS_LABELS } from "@/lib/status-labels";

export function TrendCard({
  title,
  description,
  data,
  series,
}: {
  title: string;
  description: string;
  data: Array<Record<string, string | number>>;
  series: Array<{ key: string; label: string; color: string }>;
}): ReactNode {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <div className="flex flex-wrap justify-end gap-3 text-xs text-muted-foreground">
            {series.map((item) => (
              <span key={item.key} className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ backgroundColor: item.color }} />
                {item.label}
              </span>
            ))}
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? <NoReportData /> : <SimpleBarChart data={data} series={series} />}
      </CardContent>
    </Card>
  );
}

export function RankingCard({
  title,
  description,
  items,
}: {
  title: string;
  description: string;
  items: Array<{ id: string; name: string; color: string; contactCount: number }>;
}): ReactNode {
  const maximum = Math.max(1, ...items.map((item) => item.contactCount));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {items.map((item) => (
          <div key={item.id}>
            <div className="mb-1.5 flex justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <span className="size-2 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="truncate">{item.name}</span>
              </span>
              <span className="tabular-nums">{item.contactCount.toLocaleString()}人</span>
            </div>
            <Progress
              value={(item.contactCount / maximum) * 100}
              aria-label={`${item.name}: ${item.contactCount.toLocaleString()}人`}
            />
          </div>
        ))}
        {items.length === 0 ? <NoReportData /> : null}
      </CardContent>
    </Card>
  );
}

export function ReportTableCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): ReactNode {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto px-0">{children}</CardContent>
    </Card>
  );
}

export function NumberCell({ value }: { value: number }): ReactNode {
  return <TableCell className="text-right tabular-nums">{value.toLocaleString()}</TableCell>;
}

export function ReportStatusBadge({ status }: { status: string }): ReactNode {
  return (
    <Badge variant={status === "active" || status === "published" ? "default" : "secondary"}>
      {RESOURCE_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

export function ProgressRow({
  label,
  value,
  maximum,
  destructive = false,
}: {
  label: string;
  value: number;
  maximum: number;
  destructive?: boolean;
}): ReactNode {
  const percentage = Math.min(100, (value / Math.max(maximum, 1)) * 100);
  return (
    <Progress value={percentage} variant={destructive ? "destructive" : "default"}>
      <ProgressLabel>{label}</ProgressLabel>
      <span className="ml-auto text-sm font-medium tabular-nums">{value.toLocaleString()}</span>
    </Progress>
  );
}

export function AttentionItem({ label, value }: { label: string; value: number }): ReactNode {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-medium tabular-nums">{value.toLocaleString()}</p>
    </div>
  );
}

export function NoReportData(): ReactNode {
  return (
    <EmptyState
      compact
      title="この期間のデータはありません"
      description="期間を変更するか、データが蓄積されてから確認してください。"
    />
  );
}

export function sourceTypeLabel(type: string): string {
  if (type === "automation") return "オートメーション";
  return "Transactional";
}
