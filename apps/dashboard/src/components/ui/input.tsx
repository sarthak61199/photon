import { Input as BaseInput } from "@base-ui/react/input";
import { cn } from "../../lib/cn";

export type InputProps = BaseInput.Props;

export function Input({ className, ...props }: InputProps) {
  return (
    <BaseInput
      className={cn(
        "h-9 w-full rounded-md border border-line bg-surface-2 px-3 text-sm text-ink placeholder:text-ink-dim",
        "outline-hidden focus:border-amber focus:outline-2 focus:outline-offset-0 focus:outline-amber/40",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}
