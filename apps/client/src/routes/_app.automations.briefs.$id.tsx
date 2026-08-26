import { createFileRoute } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import {
  projectBriefOptionsQueryOptions,
  projectBriefQueryOptions,
} from "@/features/projects/project-brief-api";
import { ProjectBriefRouteContent } from "@/features/projects/project-brief-route-content";

export const Route = createFileRoute("/_app/automations/briefs/$id")({
  loader: async ({ context, params }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(projectBriefQueryOptions(params.id)),
      context.queryClient.ensureQueryData(projectBriefOptionsQueryOptions()),
    ]);
    return undefined;
  },
  ...routeStatusComponents,
  component: BriefRoute,
});

function BriefRoute() {
  return <ProjectBriefRouteContent id={Route.useParams().id} />;
}
