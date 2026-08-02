import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/developers/logs")({
  component: RouteComponent,
});

function RouteComponent() {
  return <div>webhook delivery logs</div>;
}
