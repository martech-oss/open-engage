import type { QueryClient } from "@tanstack/react-query";

import { orpcQuery } from "@/lib/orpc";

export async function invalidateProjectBriefQueries(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: orpcQuery.projects.briefList.key() }),
    queryClient.invalidateQueries({ queryKey: orpcQuery.projects.briefGet.key() }),
    queryClient.invalidateQueries({ queryKey: orpcQuery.dashboard.get.key() }),
  ]);
}
