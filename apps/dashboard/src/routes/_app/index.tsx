import { createFileRoute, useRouteContext } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/")({
  component: RouteComponent,
});

function RouteComponent() {
  const { user, org } = useRouteContext({ from: "/_app" });
  return (
    <p className="text-sm text-ink">
      Welcome back, {user.name} — <span className="text-ink-dim">{org.name}</span>
    </p>
  );
}
