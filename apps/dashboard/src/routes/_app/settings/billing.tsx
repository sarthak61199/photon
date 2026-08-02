import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/settings/billing")({
  component: RouteComponent,
});

function RouteComponent() {
  return <div>billing</div>;
}
