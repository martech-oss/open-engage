import { createFileRoute } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import { segmentsQueryOptions } from "@/features/segments/segment-api";
import { SegmentsPage } from "@/features/segments/segments-page";

export const Route = createFileRoute("/_app/segments")({
  loader: ({ context }) => context.queryClient.ensureQueryData(segmentsQueryOptions()),
  ...routeStatusComponents,
  component: SegmentsPage,
});
