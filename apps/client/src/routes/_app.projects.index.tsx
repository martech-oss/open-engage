import { createFileRoute, type SearchSchemaInput } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import { projectsQueryOptions } from "@/features/projects/program-api";
import {
  projectBriefOptionsQueryOptions,
  projectBriefsQueryOptions,
} from "@/features/projects/project-brief-api";
import {
  parseProjectBriefSearch,
  type ProjectBriefSearch,
} from "@/features/projects/project-brief-list-filters";
import { ProjectsPage } from "@/features/projects/projects-page";
export const Route = createFileRoute("/_app/projects/")({
  validateSearch: (
    search: Partial<ProjectBriefSearch> & {
      view?: string;
      q?: string | undefined;
    } & SearchSchemaInput,
  ) => ({
    q: typeof search.q === "string" && search.q ? search.q : undefined,
    ...parseProjectBriefSearch(search as Record<string, unknown>),
    view: search.view === "briefs" ? ("briefs" as const) : ("projects" as const),
  }),
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(projectsQueryOptions()),
      context.queryClient.ensureQueryData(projectBriefsQueryOptions()),
      context.queryClient.ensureQueryData(projectBriefOptionsQueryOptions()),
    ]);
  },
  ...routeStatusComponents,
  component: () => <ProjectsPage search={Route.useSearch()} />,
});
