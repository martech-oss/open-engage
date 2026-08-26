import { createFileRoute } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import { emailVariablesListQueryOptions } from "@/features/emails/email-api";
import { EmailVariablesPage } from "@/features/emails/email-pages";

export const Route = createFileRoute("/_app/emails/variables")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(emailVariablesListQueryOptions());
    return undefined;
  },
  ...routeStatusComponents,
  component: EmailVariablesPage,
});
