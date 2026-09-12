import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { HelpTooltip } from "./help-tooltip";

/** A single comparison band, rather than equal-weight cards competing for attention. */
export function MetricGrid({
  children,
  className = "sm:grid-cols-2 xl:grid-cols-4",
}: {
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <div className={cn("grid min-w-0 gap-x-6 gap-y-4 border-y bg-card px-4 py-4", className)}>
      {children}
    </div>
  );
}
export function MetricCard({
  label,
  value,
  icon,
  description,
  help,
  children,
}: {
  label: string;
  value: string | number;
  icon?: ReactNode;
  description?: ReactNode;
  help?: ReactNode;
  children?: ReactNode;
}): ReactNode {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-h-6 items-center gap-2 text-xs font-medium text-text-secondary">
        <span>{label}</span>
        {help ? <HelpTooltip label={label}>{help}</HelpTooltip> : null}
        {icon ? (
          <span aria-hidden className="[&>svg]:size-4">
            {icon}
          </span>
        ) : null}
      </div>
      <div className="text-2xl leading-tight font-semibold wrap-anywhere tabular-nums">
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      {description || children ? (
        <div className="text-xs leading-relaxed text-muted-foreground">
          {description}
          {children}
        </div>
      ) : null}
    </div>
  );
}
