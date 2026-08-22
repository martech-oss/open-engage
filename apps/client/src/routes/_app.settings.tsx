import { createFileRoute } from "@tanstack/react-router";

import { emailBrandProfileQueryOptions } from "@/features/emails/email-api";
import { SettingsPage } from "@/features/settings/settings-page";

export const Route = createFileRoute("/_app/settings")({
  loader: ({ context }) => context.queryClient.ensureQueryData(emailBrandProfileQueryOptions()),
  component: SettingsRoute,
});

function SettingsRoute() {
  const { workspace } = Route.useRouteContext();
  return <SettingsPage workspace={workspace} />;
}
