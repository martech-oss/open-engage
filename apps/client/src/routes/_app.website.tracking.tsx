import { createFileRoute } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import { SiteTrackingPage } from "@/features/website/site-tracking-page";
import { siteTrackingQueryOptions } from "@/features/website/website-api";

export const Route = createFileRoute("/_app/website/tracking")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(siteTrackingQueryOptions());
    return undefined;
  },
  ...routeStatusComponents,
  component: SiteTrackingPage,
});
