import { Link } from "@tanstack/react-router";
import { Button } from "./ui/button";

export function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface-0 px-6 text-center text-ink">
      <p className="text-sm font-medium text-ink-dim">Page not found</p>
      <Button size="sm" render={<Link to="/">Go home</Link>} />
    </div>
  );
}
