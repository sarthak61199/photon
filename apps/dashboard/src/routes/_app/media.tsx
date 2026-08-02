import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/media")({
  component: RouteComponent,
});

function RouteComponent() {
  return <Outlet />;
}
