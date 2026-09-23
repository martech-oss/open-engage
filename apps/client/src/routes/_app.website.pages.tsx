import { createFileRoute } from "@tanstack/react-router";

import { LandingPagesPage } from "@/features/website/landing-pages-page";
import { landingPagesQueryOptions } from "@/features/website/website-api";
import { ensureWorkspace } from "@/lib/app-bootstrap";

export const Route = createFileRoute("/_app/website/pages")({
  loader: async ({ context }) => {
    const [, workspace] = await Promise.all([
      context.queryClient.ensureQueryData(landingPagesQueryOptions()),
      ensureWorkspace(context.queryClient),
    ]);
    return { workspaceSlug: workspace.slug };
  },
  component: LandingPagesRoute,
});

function LandingPagesRoute() {
  const { workspaceSlug } = Route.useLoaderData();
  return <LandingPagesPage workspaceSlug={workspaceSlug} />;
}
