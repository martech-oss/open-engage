import { createFileRoute, type SearchSchemaInput, stripSearchParams } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import {
  projectBriefOptionsQueryOptions,
  projectBriefsQueryOptions,
} from "@/features/projects/project-brief-api";
import {
  parseProjectBriefSearch,
  projectBriefSearchDefaults,
  type ProjectBriefSearch,
} from "@/features/projects/project-brief-list-filters";
import { ProjectBriefsPage } from "@/features/projects/project-brief-list-page";

export const Route = createFileRoute("/_app/automations/briefs/")({
  validateSearch: (search: Partial<ProjectBriefSearch> & SearchSchemaInput): ProjectBriefSearch =>
    parseProjectBriefSearch(search as Record<string, unknown>),
  search: {
    middlewares: [stripSearchParams(projectBriefSearchDefaults)],
  },
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(projectBriefsQueryOptions()),
      context.queryClient.ensureQueryData(projectBriefOptionsQueryOptions()),
    ]);
    return undefined;
  },
  ...routeStatusComponents,
  component: BriefsRoute,
});

function BriefsRoute() {
  return <ProjectBriefsPage search={Route.useSearch()} />;
}
