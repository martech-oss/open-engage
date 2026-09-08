import { orpcQuery } from "@/lib/orpc";

export function operationHealthQueryOptions() {
  return orpcQuery.platform.operationHealth.queryOptions();
}
