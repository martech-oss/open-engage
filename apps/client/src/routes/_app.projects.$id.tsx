import { createFileRoute } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import { programQueryOptions } from "@/features/projects/program-api";
import { projectBriefOptionsQueryOptions } from "@/features/projects/project-brief-api";
import { ProjectProgramPage } from "@/features/projects/project-program-page";
export const Route = createFileRoute("/_app/projects/$id")({
  loader: async ({ context, params }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(programQueryOptions(params.id)),
      context.queryClient.ensureQueryData(projectBriefOptionsQueryOptions()),
    ]);
  },
  ...routeStatusComponents,
  component: () => <ProjectProgramPage key={Route.useParams().id} id={Route.useParams().id} />,
});
