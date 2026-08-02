import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/settings/members")({
  component: RouteComponent,
});

function RouteComponent() {
  return <div>members</div>;
}
