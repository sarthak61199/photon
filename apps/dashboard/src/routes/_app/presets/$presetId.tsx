import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/presets/$presetId")({
  component: RouteComponent,
});

function RouteComponent() {
  return <div>preset detail</div>;
}
