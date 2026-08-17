import { createFileRoute } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import { contactSearchDefaults, contactsQueryOptions } from "@/features/contacts/contact-api";
import { segmentOptionsQueryOptions, segmentQueryOptions } from "@/features/segments/segment-api";
import { SegmentDetailPage } from "@/features/segments/segment-detail-page";

export const Route = createFileRoute("/_app/segments/$id")({
  loader: ({ params, context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(segmentQueryOptions(params.id)),
      context.queryClient.ensureQueryData(segmentOptionsQueryOptions()),
      context.queryClient.ensureQueryData(
        contactsQueryOptions({
          ...contactSearchDefaults,
          segmentId: params.id,
          status: "all",
        }),
      ),
    ]),
  ...routeStatusComponents,
  component: SegmentDetailRoute,
});

function SegmentDetailRoute() {
  const { id } = Route.useParams();
  return <SegmentDetailPage segmentId={id} />;
}
