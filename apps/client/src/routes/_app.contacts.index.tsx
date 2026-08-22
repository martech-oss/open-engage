import { createFileRoute, type SearchSchemaInput, stripSearchParams } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import {
  contactOptionsQueryOptions,
  contactSearchDefaults,
  contactsQueryOptions,
  parseContactSearch,
} from "@/features/contacts/contact-api";
import { ContactsPage } from "@/features/contacts/contacts-page";

export const Route = createFileRoute("/_app/contacts/")({
  validateSearch: (search: Partial<ReturnType<typeof parseContactSearch>> & SearchSchemaInput) =>
    parseContactSearch(search),
  search: {
    middlewares: [stripSearchParams(contactSearchDefaults)],
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(contactsQueryOptions(deps)),
      context.queryClient.ensureQueryData(contactOptionsQueryOptions()),
    ]);
  },
  ...routeStatusComponents,
  component: ContactsRoute,
});

function ContactsRoute() {
  return <ContactsPage initialSearch={Route.useSearch()} />;
}
