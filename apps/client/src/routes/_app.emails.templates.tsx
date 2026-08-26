import { createFileRoute } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import {
  emailTemplateOptionsQueryOptions,
  emailVariablesListQueryOptions,
} from "@/features/emails/email-api";
import { EmailTemplatesPage } from "@/features/emails/email-pages";

export const Route = createFileRoute("/_app/emails/templates")({
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(emailTemplateOptionsQueryOptions()),
      context.queryClient.ensureQueryData(emailVariablesListQueryOptions()),
    ]);
    return undefined;
  },
  ...routeStatusComponents,
  component: EmailTemplatesPage,
});
