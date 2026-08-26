import { createContext, type ReactNode, useContext, useMemo } from "react";

import {
  formatDate,
  formatDateTime,
  formatLongDateTime,
  formatMonthDayTime,
  formatRelativeTime,
  formatShortDate,
  toDateTimeLocal,
} from "@/lib/format";
import { workspaceDateTimeToUtc } from "@openengage/core/shared/time";

export interface WorkspaceTime {
  timeZone: string;
  renderedAt: string;
}

const stableFallback: WorkspaceTime = {
  timeZone: "UTC",
  renderedAt: "1970-01-01T00:00:00.000Z",
};

const WorkspaceTimeContext = createContext<WorkspaceTime>(stableFallback);

export function WorkspaceTimeProvider({
  value,
  children,
}: {
  value: WorkspaceTime;
  children?: ReactNode;
}): ReactNode {
  return <WorkspaceTimeContext.Provider value={value}>{children}</WorkspaceTimeContext.Provider>;
}

export function useWorkspaceTime(): WorkspaceTime {
  return useContext(WorkspaceTimeContext);
}

export function useWorkspaceFormatters() {
  const { timeZone, renderedAt } = useWorkspaceTime();
  return useMemo(
    () => ({
      formatDate: (value: string) => formatDate(value, { timeZone }),
      formatDateTime: (value: string) => formatDateTime(value, { timeZone }),
      formatLongDateTime: (value: string) => formatLongDateTime(value, { timeZone }),
      formatMonthDayTime: (value: string) => formatMonthDayTime(value, { timeZone }),
      formatRelativeTime: (value: string) => formatRelativeTime(value, { now: renderedAt }),
      formatShortDate: (value: string) => formatShortDate(value, { timeZone }),
      toDateTimeLocal: (value: string | null | undefined) => toDateTimeLocal(value, timeZone),
      fromDateTimeLocal: (value: string) => workspaceDateTimeToUtc(value, timeZone),
    }),
    [renderedAt, timeZone],
  );
}
