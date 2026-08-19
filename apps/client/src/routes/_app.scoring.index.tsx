import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/scoring/")({
  beforeLoad: () => {
    throw redirect({ to: "/scoring/rules" });
  },
});
