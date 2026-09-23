import { createFileRoute } from "@tanstack/react-router";

import { SiteMessagesPage } from "@/features/website/site-messages-page";
import { siteMessagesQueryOptions } from "@/features/website/website-api";

export const Route = createFileRoute("/_app/website/messages")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(siteMessagesQueryOptions());
    return undefined;
  },
  component: SiteMessagesPage,
});
