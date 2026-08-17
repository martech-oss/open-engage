import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/segments")({
  component: Outlet,
});
