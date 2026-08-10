import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { RESOURCE_STATUS_LABELS } from "@/lib/status-labels";
import type { AutomationRow } from "@openengage/core/automations";

export function AutomationStatusBadge({ status }: { status: AutomationRow["status"] }): ReactNode {
  return (
    <Badge variant={status === "active" ? "default" : "secondary"}>
      {status === "active" ? <span className="size-1.5 rounded-full bg-current" /> : null}
      {RESOURCE_STATUS_LABELS[status]}
    </Badge>
  );
}
