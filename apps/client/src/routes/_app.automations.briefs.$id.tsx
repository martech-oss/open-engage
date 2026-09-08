import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/_app/automations/briefs/$id")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/projects/$id", params, replace: true });
  },
});
