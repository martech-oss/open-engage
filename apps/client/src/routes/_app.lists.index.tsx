import { createFileRoute } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import { ListsPage } from "@/features/segments/lists-page";
import { segmentsQueryOptions } from "@/features/segments/segment-api";

export const Route = createFileRoute("/_app/lists/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(segmentsQueryOptions("static")),
  ...routeStatusComponents,
  component: ListsPage,
});
