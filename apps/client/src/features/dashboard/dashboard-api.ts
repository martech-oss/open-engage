import { orpcQuery } from "@/lib/orpc";

export const TREND_WINDOW = 7;

export function dashboardQueryOptions() {
  return orpcQuery.dashboard.get.queryOptions();
}
