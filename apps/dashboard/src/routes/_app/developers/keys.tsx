import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/developers/keys")({
  component: RouteComponent,
});

function RouteComponent() {
  return <div>developer keys</div>;
}
