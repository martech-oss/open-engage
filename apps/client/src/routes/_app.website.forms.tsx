import { createFileRoute } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import { SignupFormsPage } from "@/features/website/signup-forms-page";
import { signupFormsQueryOptions } from "@/features/website/website-api";
import { ensureAppBootstrap } from "@/lib/app-bootstrap";

export const Route = createFileRoute("/_app/website/forms")({
  loader: async ({ context }) => {
    const [, bootstrap] = await Promise.all([
      context.queryClient.ensureQueryData(signupFormsQueryOptions()),
      ensureAppBootstrap(context.queryClient),
    ]);
    if (!bootstrap.workspace) throw new Error("Workspace bootstrap is required");
    return { workspaceSlug: bootstrap.workspace.slug };
  },
  ...routeStatusComponents,
  component: SignupFormsRoute,
});

function SignupFormsRoute() {
  const { workspaceSlug } = Route.useLoaderData();
  return <SignupFormsPage workspaceSlug={workspaceSlug} />;
}
