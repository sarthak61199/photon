import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getSession } from "../server/session";

export const Route = createFileRoute("/_auth")({
  beforeLoad: async () => {
    const session = await getSession();
    if (session) throw redirect({ to: "/" });
  },
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-0 px-4">
      <div className="w-full max-w-sm rounded-lg border border-line bg-surface-1 p-6">
        <Outlet />
      </div>
    </div>
  );
}
