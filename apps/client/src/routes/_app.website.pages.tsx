import { createFileRoute } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import { LandingPagesPage } from "@/features/website/landing-pages-page";
import { landingPagesQueryOptions } from "@/features/website/website-api";
import { ensureAppBootstrap } from "@/lib/app-bootstrap";

export const Route = createFileRoute("/_app/website/pages")({
  loader: async ({ context }) => {
    const [, bootstrap] = await Promise.all([
      context.queryClient.ensureQueryData(landingPagesQueryOptions()),
      ensureAppBootstrap(context.queryClient),
    ]);
    if (!bootstrap.workspace) throw new Error("Workspace bootstrap is required");
    return { workspaceSlug: bootstrap.workspace.slug };
  },
  ...routeStatusComponents,
  component: LandingPagesRoute,
});

function LandingPagesRoute() {
  const { workspaceSlug } = Route.useLoaderData();
  return <LandingPagesPage workspaceSlug={workspaceSlug} />;
}
