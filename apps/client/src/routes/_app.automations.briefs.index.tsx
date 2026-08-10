import { createFileRoute } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import {
  projectBriefOptionsQueryOptions,
  projectBriefsQueryOptions,
} from "@/features/projects/project-brief-api";
import { ProjectBriefsPage } from "@/features/projects/project-brief-list-page";

export const Route = createFileRoute("/_app/automations/briefs/")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(projectBriefsQueryOptions()),
      context.queryClient.ensureQueryData(projectBriefOptionsQueryOptions()),
    ]),
  ...routeStatusComponents,
  component: ProjectBriefsPage,
});
