import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/developers/webhooks")({
  component: RouteComponent,
});

function RouteComponent() {
  return <div>webhooks</div>;
}
