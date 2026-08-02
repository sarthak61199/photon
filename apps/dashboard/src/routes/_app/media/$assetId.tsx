import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/media/$assetId")({
  component: RouteComponent,
});

function RouteComponent() {
  return <div>asset detail</div>;
}
