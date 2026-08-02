import type { ErrorComponentProps } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { Button } from "./ui/button";

export function DefaultCatchBoundary({ error, reset }: ErrorComponentProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface-0 px-6 text-center text-ink">
      <p className="text-sm font-medium text-signal-err">Something went wrong</p>
      <p className="max-w-md font-mono text-xs text-ink-dim">{error.message}</p>
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={reset}>
          Try again
        </Button>
        <Button size="sm" render={<Link to="/">Go home</Link>} />
      </div>
    </div>
  );
}
