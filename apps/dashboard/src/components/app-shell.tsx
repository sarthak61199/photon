import { Link, useNavigate, useRouteContext } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { authClient } from "../lib/auth-client";
import { Avatar } from "./ui/avatar";
import { Menu } from "./ui/menu";

const navSections: Array<{
  label: string;
  items: Array<{ label: string; to: string }>;
}> = [
  { label: "", items: [{ label: "Overview", to: "/" }] },
  {
    label: "",
    items: [
      { label: "Media", to: "/media" },
      { label: "Presets", to: "/presets" },
      { label: "Usage", to: "/usage" },
    ],
  },
  {
    label: "Developers",
    items: [
      { label: "Keys", to: "/developers/keys" },
      { label: "Webhooks", to: "/developers/webhooks" },
      { label: "Logs", to: "/developers/logs" },
    ],
  },
  {
    label: "Settings",
    items: [
      { label: "General", to: "/settings/general" },
      { label: "Members", to: "/settings/members" },
      { label: "Billing", to: "/settings/billing" },
    ],
  },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, org } = useRouteContext({ from: "/_app" });
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col gap-6 border-r border-line bg-surface-1 p-4">
        <span className="px-2 text-sm font-semibold tracking-tight text-ink">Photon</span>
        <nav className="flex flex-col gap-4">
          {navSections.map((section) => (
            <div key={section.label || section.items[0]?.to} className="flex flex-col gap-1">
              {section.label ? (
                <span className="px-2 text-xs font-medium text-ink-dim">{section.label}</span>
              ) : null}
              {section.items.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="rounded-md px-2 py-1.5 text-sm text-ink-dim transition-colors duration-150 ease-out hover:bg-surface-2 hover:text-ink"
                  activeProps={{ className: "bg-surface-2 text-ink" }}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-line px-6">
          <span className="text-sm text-ink-dim">{org.name}</span>

          <Menu.Root>
            <Menu.Trigger>
              <Avatar.Root>
                <Avatar.Fallback>{initials(user.name)}</Avatar.Fallback>
              </Avatar.Root>
            </Menu.Trigger>
            <Menu.Popup align="end">
              <Menu.GroupLabel>{user.email}</Menu.GroupLabel>
              <Menu.Separator />
              <Menu.Item render={<Link to="/settings/general" />}>Settings</Menu.Item>
              <Menu.Item
                onClick={() => {
                  void authClient.signOut().then(() => navigate({ to: "/login" }));
                }}
              >
                Sign out
              </Menu.Item>
            </Menu.Popup>
          </Menu.Root>
        </header>

        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
