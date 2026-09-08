import { createFileRoute, redirect } from "@tanstack/react-router";

import { parseProjectBriefSearch } from "@/features/projects/project-brief-list-filters";
export const Route = createFileRoute("/_app/automations/briefs/")({
  validateSearch: (search: Record<string, unknown>) => parseProjectBriefSearch(search),
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/projects", search: { ...search, view: "briefs" }, replace: true });
  },
});
