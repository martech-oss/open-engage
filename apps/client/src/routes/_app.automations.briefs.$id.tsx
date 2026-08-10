import { createFileRoute } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import {
  projectBriefOptionsQueryOptions,
  projectBriefQueryOptions,
} from "@/features/projects/project-brief-api";
import { ProjectBriefDetailPage } from "@/features/projects/project-brief-pages";

export const Route = createFileRoute("/_app/automations/briefs/$id")({
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.ensureQueryData(projectBriefQueryOptions(params.id)),
      context.queryClient.ensureQueryData(projectBriefOptionsQueryOptions()),
    ]),
  ...routeStatusComponents,
  component: BriefRoute,
});

function BriefRoute() {
  return <ProjectBriefRouteContent id={Route.useParams().id} />;
}

export function ProjectBriefRouteContent({ id }: { id: string }) {
  return <ProjectBriefDetailPage key={id} id={id} />;
}
