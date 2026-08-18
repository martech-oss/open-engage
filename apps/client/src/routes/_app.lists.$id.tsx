import { createFileRoute, redirect } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import { contactSearchDefaults, contactsQueryOptions } from "@/features/contacts/contact-api";
import { ListDetailPage } from "@/features/segments/list-detail-page";
import {
  listMemberOptionsQueryOptions,
  segmentQueryOptions,
} from "@/features/segments/segment-api";

export const Route = createFileRoute("/_app/lists/$id")({
  loader: async ({ params, context }) => {
    const list = await context.queryClient.ensureQueryData(segmentQueryOptions(params.id));
    if (list.kind === "dynamic") {
      throw redirect({ to: "/segments/$id", params: { id: params.id } });
    }
    await Promise.all([
      context.queryClient.ensureQueryData(listMemberOptionsQueryOptions()),
      context.queryClient.ensureQueryData(
        contactsQueryOptions({
          ...contactSearchDefaults,
          segmentId: params.id,
          status: "all",
        }),
      ),
    ]);
  },
  ...routeStatusComponents,
  component: ListDetailRoute,
});

function ListDetailRoute() {
  const { id } = Route.useParams();
  return <ListDetailPage listId={id} />;
}
