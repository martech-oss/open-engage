import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { emailBrandProfileQueryOptions } from "@/features/emails/email-api";
import { SettingsPage } from "@/features/settings/settings-page";
import { appBootstrapQueryOptions } from "@/lib/app-bootstrap";

export const Route = createFileRoute("/_app/settings")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(emailBrandProfileQueryOptions());
    return undefined;
  },
  component: SettingsRoute,
});

function SettingsRoute() {
  const { data: bootstrap } = useSuspenseQuery(appBootstrapQueryOptions());
  return bootstrap.workspace ? <SettingsPage workspace={bootstrap.workspace} /> : null;
}
