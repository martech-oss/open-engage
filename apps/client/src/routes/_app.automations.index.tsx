import { createFileRoute } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import { automationsQueryOptions } from "@/features/automations/automation-api";
import { AutomationsPage } from "@/features/automations/automation-list-page";
import { validateAutomationListSearch } from "@/features/automations/automation-list-search";
import { emailTemplateOptionsQueryOptions } from "@/features/emails/email-api";

export const Route = createFileRoute("/_app/automations/")({
  validateSearch: validateAutomationListSearch,
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(automationsQueryOptions()),
      context.queryClient.ensureQueryData(emailTemplateOptionsQueryOptions()),
    ]);
    return undefined;
  },
  ...routeStatusComponents,
  component: AutomationsPage,
});
