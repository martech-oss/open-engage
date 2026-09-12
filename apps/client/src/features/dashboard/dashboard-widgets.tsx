import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { Dashboard } from "@openengage/core/reports";

/** Quiet boundaries leave the data, not its container, in the foreground. */
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
    <section className={cn("min-w-0 rounded-lg border bg-card", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="text-base font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
export function DeltaChip({
  value,
  unit = "%",
}: {
  value: number | null;
  unit?: "%" | "pt";
}): ReactNode {
  if (value === null) return <span className="text-muted-foreground">比較データなし</span>;
  return (
    <span className="tabular-nums">
      {value > 0 ? "+" : ""}
      {value}
      {unit}
    </span>
  );
}
export function AutomationRows({ rows }: { rows: Dashboard["automations"]["top"] }): ReactNode {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <caption className="sr-only">稼働フローの進行状況</caption>
        <thead className="bg-table-header text-xs text-muted-foreground">
          <tr>
            <th className="h-10 px-4 text-left font-medium">フロー</th>
            <th className="px-4 text-right font-medium">進行中</th>
            <th className="px-4 text-right font-medium">完了</th>
            <th className="px-4 text-right font-medium">更新日時</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="h-10 border-t border-row-border hover:bg-muted/50">
              <td className="max-w-72 px-4 py-2">
                <Link
                  to="/automations/$id"
                  params={{ id: row.id }}
                  className="block truncate font-medium text-primary hover:underline"
                  title={row.name}
                >
                  {row.name}
                </Link>
              </td>
              <td className="px-4 text-right tabular-nums">{row.active.toLocaleString()}</td>
              <td className="px-4 text-right tabular-nums">{row.completed.toLocaleString()}</td>
              <td className="px-4 text-right text-xs whitespace-nowrap text-muted-foreground">
                {row.updatedAt}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
