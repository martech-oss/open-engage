import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import {
  automationDraftQueryOptions,
  formOptionsQueryOptions,
  segmentOptionsQueryOptions,
} from "@/features/automations/automation-api";
import { AutomationBuilder } from "@/features/automations/automation-editor-page";
import { validateAutomationListSearch } from "@/features/automations/automation-list-search";
import { emailTemplateOptionsQueryOptions } from "@/features/emails/email-api";

export const Route = createFileRoute("/_app/automations/$id")({
  validateSearch: validateAutomationListSearch,
  loader: async ({ params, context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(automationDraftQueryOptions(params.id)),
      context.queryClient.ensureQueryData(emailTemplateOptionsQueryOptions()),
      context.queryClient.ensureQueryData(formOptionsQueryOptions()),
      context.queryClient.ensureQueryData(segmentOptionsQueryOptions()),
    ]);
    return undefined;
  },
  ...routeStatusComponents,
  component: AutomationRoute,
});

function AutomationRoute() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const { data: draft } = useSuspenseQuery(automationDraftQueryOptions(id));
  const { data: templates } = useSuspenseQuery(emailTemplateOptionsQueryOptions());
  const { data: forms } = useSuspenseQuery(formOptionsQueryOptions());
  const { data: segments } = useSuspenseQuery(segmentOptionsQueryOptions());
  return (
    <AutomationBuilder
      returnToList={
        <Link
          to="/automations"
          search={search}
          className="text-sm text-muted-foreground hover:text-foreground hover:underline"
        >
          ← フロー一覧に戻る
        </Link>
      }
      key={id}
      id={id}
      initialDraft={draft}
      options={{
        templates,
        forms,
        segments,
      }}
    />
  );
}
