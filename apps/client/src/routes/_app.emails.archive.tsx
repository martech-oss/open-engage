import { createFileRoute } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import { emailArchivedTemplatesQueryOptions } from "@/features/emails/email-api";
import { EmailArchivePage } from "@/features/emails/email-pages";

export const Route = createFileRoute("/_app/emails/archive")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(emailArchivedTemplatesQueryOptions());
    return undefined;
  },
  ...routeStatusComponents,
  component: EmailArchivePage,
});
