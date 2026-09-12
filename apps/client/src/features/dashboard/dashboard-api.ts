import { orpcQuery } from "@/lib/orpc";

export function dashboardQueryOptions() {
  return orpcQuery.dashboard.get.queryOptions();
}
