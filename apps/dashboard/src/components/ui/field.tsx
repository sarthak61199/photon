import { Field as BaseField } from "@base-ui/react/field";
import { cn } from "../../lib/cn";

export function FieldRoot({ className, ...props }: BaseField.Root.Props) {
  return (
    <BaseField.Root className={cn("flex flex-col items-start gap-1.5", className)} {...props} />
  );
}

export function FieldLabel({ className, ...props }: BaseField.Label.Props) {
  return <BaseField.Label className={cn("text-sm font-medium text-ink", className)} {...props} />;
}

export function FieldControl({ className, ...props }: BaseField.Control.Props) {
  return (
    <BaseField.Control
      className={cn(
        "h-9 w-full rounded-md border border-line bg-surface-2 px-3 text-sm text-ink placeholder:text-ink-dim",
        "outline-hidden focus:border-amber focus:outline-2 focus:outline-offset-0 focus:outline-amber/40",
        "data-invalid:border-signal-err data-invalid:focus:outline-signal-err/40",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}

export function FieldDescription({ className, ...props }: BaseField.Description.Props) {
  return <BaseField.Description className={cn("text-xs text-ink-dim", className)} {...props} />;
}

export function FieldError({ className, ...props }: BaseField.Error.Props) {
  return <BaseField.Error className={cn("text-xs text-signal-err", className)} {...props} />;
}

export const Field = {
  Root: FieldRoot,
  Label: FieldLabel,
  Control: FieldControl,
  Description: FieldDescription,
  Error: FieldError,
};
