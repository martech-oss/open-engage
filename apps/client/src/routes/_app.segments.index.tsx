import { createFileRoute } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import { segmentOptionsQueryOptions, segmentsQueryOptions } from "@/features/segments/segment-api";
import { SegmentsPage } from "@/features/segments/segments-page";

export const Route = createFileRoute("/_app/segments/")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(segmentsQueryOptions("dynamic")),
      context.queryClient.ensureQueryData(segmentOptionsQueryOptions()),
    ]),
  ...routeStatusComponents,
  component: SegmentsPage,
});
