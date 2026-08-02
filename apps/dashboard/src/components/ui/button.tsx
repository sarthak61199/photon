import { Button as BaseButton } from "@base-ui/react/button";
import { cn } from "../../lib/cn";

const variantClasses = {
  primary: "bg-amber text-surface-0 hover:bg-amber/90 active:bg-amber/80 data-disabled:bg-amber/40",
  ghost:
    "border border-line bg-transparent text-ink hover:bg-surface-2 active:bg-surface-2/70 data-disabled:text-ink-dim data-disabled:border-line/50",
} as const;

const sizeClasses = {
  default: "h-9 px-4 text-sm",
  sm: "h-8 px-3 text-sm",
} as const;

export interface ButtonProps extends BaseButton.Props {
  variant?: keyof typeof variantClasses;
  size?: keyof typeof sizeClasses;
}

export function Button({
  variant = "primary",
  size = "default",
  className,
  ...props
}: ButtonProps) {
  return (
    <BaseButton
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-colors duration-150 ease-out select-none",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber",
        "disabled:cursor-not-allowed data-disabled:cursor-not-allowed",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  );
}
