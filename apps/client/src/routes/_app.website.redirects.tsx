import { createFileRoute } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import { CustomRedirectsPage } from "@/features/website/custom-redirects-page";
import {
  customRedirectsQueryOptions,
  siteTrackingQueryOptions,
} from "@/features/website/website-api";

export const Route = createFileRoute("/_app/website/redirects")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(customRedirectsQueryOptions()),
      context.queryClient.ensureQueryData(siteTrackingQueryOptions()),
    ]),
  ...routeStatusComponents,
  component: CustomRedirectsPage,
});
