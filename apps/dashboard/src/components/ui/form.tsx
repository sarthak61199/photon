import { Form as BaseForm } from "@base-ui/react/form";
import { cn } from "../../lib/cn";

export function Form({ className, ...props }: BaseForm.Props) {
  return <BaseForm className={cn("flex flex-col gap-4", className)} {...props} />;
}
