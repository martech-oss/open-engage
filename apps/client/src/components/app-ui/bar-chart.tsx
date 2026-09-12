import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { formatShortDate } from "@/lib/format";

export interface BarChartSeries {
  key: string;
  label: string;
  color: string;
}

function BarChartTooltip({
  active,
  payload,
  label,
  series,
  valueFormat,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string | number; value?: string | number }>;
  label?: string;
  series: BarChartSeries[];
  valueFormat: (value: number) => string;
}): ReactNode {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1.5 font-medium">{formatShortDate(label ?? "")}</p>
      <div className="flex flex-col gap-1">
        {series.map((item) => {
          const entry = payload.find((point) => point.dataKey === item.key);
          if (!entry) return null;
          return (
            <div key={item.key} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span className="size-2 rounded-full" style={{ backgroundColor: item.color }} />
                {item.label}
              </span>
              <span className="font-medium tabular-nums">
                {valueFormat(Number(entry.value ?? 0))}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The day-bucketed bar chart every trend chart in this app needed by hand
 * (axes, grid, hover tooltip). Callers own the surrounding Card/legend/empty
 * state since those vary; this is just the recharts wiring.
 */
export function SimpleBarChart({
  data,
  series,
  xKey = "day",
  height = 224,
  valueFormat = (value) => value.toLocaleString(),
  yDomain,
  stacked = false,
}: {
  data: Array<Record<string, string | number>>;
  series: BarChartSeries[];
  xKey?: string;
  height?: number;
  valueFormat?: (value: number) => string;
  yDomain?: [number, number];
  /** Stack the series into one bar per bucket instead of grouping them side by side. */
  stacked?: boolean;
}): ReactNode {
  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey={xKey}
            tickFormatter={(value: string) => formatShortDate(value)}
            tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis
            tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            width={56}
            allowDecimals={false}
            tickFormatter={(value: number) => valueFormat(value)}
            {...(yDomain ? { domain: yDomain } : {})}
          />
          <Tooltip
            content={<BarChartTooltip series={series} valueFormat={valueFormat} />}
            cursor={{ fill: "var(--muted)" }}
          />
          {series.map((item, index) => (
            <Bar
              key={item.key}
              isAnimationActive={false}
              dataKey={item.key}
              name={item.label}
              fill={item.color}
              {...(stacked ? { stackId: "bar" } : {})}
              // Only the topmost band of a stack gets the rounded cap, so the
              // segments underneath still meet flush.
              radius={stacked && index < series.length - 1 ? 0 : [2, 2, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
