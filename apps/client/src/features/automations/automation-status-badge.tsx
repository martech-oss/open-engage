import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { RESOURCE_STATUS_LABELS } from "@/lib/status-labels";
import { cn } from "@/lib/utils";
import type { AutomationRow } from "@openengage/core/automations";

export function AutomationStatusBadge({ status }: { status: AutomationRow["status"] }): ReactNode {
  return (
    <Badge
      variant="secondary"
      className={cn(
        status === "active" && "bg-success/10 text-success",
        status === "paused" && "bg-warning/15 text-warning-foreground",
      )}
    >
      {status === "active" ? <span className="size-1.5 rounded-full bg-current" /> : null}
      {RESOURCE_STATUS_LABELS[status]}
    </Badge>
  );
}
