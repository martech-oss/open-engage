import { createFileRoute } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import { emailTrackingSettingsQueryOptions } from "@/features/emails/email-api";
import { EmailTrackingPage } from "@/features/emails/email-tracking-page";

export const Route = createFileRoute("/_app/emails/tracking")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(emailTrackingSettingsQueryOptions());
    return undefined;
  },
  ...routeStatusComponents,
  component: EmailTrackingPage,
});
