import { createFileRoute } from "@tanstack/react-router";

import { contactResourcesQueryOptions } from "@/features/contacts/contact-resource-api";
import { ContactTagsPage } from "@/features/contacts/contact-resource-pages";

export const Route = createFileRoute("/_app/tags")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(contactResourcesQueryOptions());
    return undefined;
  },
  component: ContactTagsRoute,
});

function ContactTagsRoute() {
  return <ContactTagsPage />;
}
