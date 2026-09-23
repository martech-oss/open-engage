import { createFileRoute } from "@tanstack/react-router";

import { SignupFormsPage } from "@/features/website/signup-forms-page";
import { signupFormsQueryOptions } from "@/features/website/website-api";
import { ensureWorkspace } from "@/lib/app-bootstrap";

export const Route = createFileRoute("/_app/website/forms")({
  loader: async ({ context }) => {
    const [, workspace] = await Promise.all([
      context.queryClient.ensureQueryData(signupFormsQueryOptions()),
      ensureWorkspace(context.queryClient),
    ]);
    return { workspaceSlug: workspace.slug };
  },
  component: SignupFormsRoute,
});

function SignupFormsRoute() {
  const { workspaceSlug } = Route.useLoaderData();
  return <SignupFormsPage workspaceSlug={workspaceSlug} />;
}
