import { createFileRoute } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import { automationsQueryOptions } from "@/features/automations/automation-api";
import { AutomationsPage } from "@/features/automations/automation-list-page";
import { emailTemplateOptionsQueryOptions } from "@/features/emails/email-api";

export const Route = createFileRoute("/_app/automations/")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(automationsQueryOptions()),
      context.queryClient.ensureQueryData(emailTemplateOptionsQueryOptions()),
    ]),
  ...routeStatusComponents,
  component: AutomationsPage,
});
