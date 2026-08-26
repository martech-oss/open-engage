import { createFileRoute } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import { dealDetailQueryOptions, dealOptionsQueryOptions } from "@/features/deals/deal-api";
import { DealDetailPage } from "@/features/deals/deal-pages";

export const Route = createFileRoute("/_app/deals/$id")({
  loader: async ({ params, context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(dealDetailQueryOptions(params.id)),
      context.queryClient.ensureQueryData(dealOptionsQueryOptions()),
    ]);
    return undefined;
  },
  ...routeStatusComponents,
  component: DealDetailRoute,
});

function DealDetailRoute() {
  const { id } = Route.useParams();
  return <DealDetailPage dealId={id} />;
}
