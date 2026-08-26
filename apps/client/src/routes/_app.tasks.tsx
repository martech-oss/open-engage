import { createFileRoute, type SearchSchemaInput, stripSearchParams } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import {
  parseTaskSearch,
  taskSearchDefaults,
  tasksQueryOptions,
  type TaskSearch,
} from "@/features/deals/deal-api";
import { DealTasksPage } from "@/features/deals/deal-pages";

export const Route = createFileRoute("/_app/tasks")({
  validateSearch: (search: Partial<TaskSearch> & SearchSchemaInput): TaskSearch =>
    parseTaskSearch(search as Record<string, unknown>),
  search: {
    middlewares: [stripSearchParams(taskSearchDefaults)],
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, context }) => {
    await context.queryClient.ensureQueryData(tasksQueryOptions(deps));
    return undefined;
  },
  ...routeStatusComponents,
  component: TasksRoute,
});

function TasksRoute() {
  return <DealTasksPage search={Route.useSearch()} />;
}
