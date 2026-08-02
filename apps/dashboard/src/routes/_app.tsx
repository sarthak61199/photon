import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "../components/app-shell";
import { getOrgForUser, getSession } from "../server/session";

export const Route = createFileRoute("/_app")({
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user.orgId) throw redirect({ to: "/login" });

    const org = await getOrgForUser({ data: session.user.orgId });

    return { user: session.user, org };
  },
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
