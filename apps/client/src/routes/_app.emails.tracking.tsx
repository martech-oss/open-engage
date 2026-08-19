import { createFileRoute } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import { emailTrackingSettingsQueryOptions } from "@/features/emails/email-api";
import { EmailTrackingPage } from "@/features/emails/email-tracking-page";

export const Route = createFileRoute("/_app/emails/tracking")({
  loader: ({ context }) => context.queryClient.ensureQueryData(emailTrackingSettingsQueryOptions()),
  ...routeStatusComponents,
  component: EmailTrackingPage,
});
