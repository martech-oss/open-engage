import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import {
  automationDraftQueryOptions,
  formOptionsQueryOptions,
  segmentOptionsQueryOptions,
} from "@/features/automations/automation-api";
import { AutomationBuilder } from "@/features/automations/automation-editor-page";
import { emailTemplateOptionsQueryOptions } from "@/features/emails/email-api";

export const Route = createFileRoute("/_app/automations/$id")({
  loader: ({ params, context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(automationDraftQueryOptions(params.id)),
      context.queryClient.ensureQueryData(emailTemplateOptionsQueryOptions()),
      context.queryClient.ensureQueryData(formOptionsQueryOptions()),
      context.queryClient.ensureQueryData(segmentOptionsQueryOptions()),
    ]),
  ...routeStatusComponents,
  component: AutomationRoute,
});

function AutomationRoute() {
  const { id } = Route.useParams();
  const { data: draft } = useSuspenseQuery(automationDraftQueryOptions(id));
  const { data: templates } = useSuspenseQuery(emailTemplateOptionsQueryOptions());
  const { data: forms } = useSuspenseQuery(formOptionsQueryOptions());
  const { data: segments } = useSuspenseQuery(segmentOptionsQueryOptions());
  return (
    <AutomationBuilder
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
