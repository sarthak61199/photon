import { Avatar as BaseAvatar } from "@base-ui/react/avatar";
import { cn } from "../../lib/cn";

export function AvatarRoot({ className, ...props }: BaseAvatar.Root.Props) {
  return (
    <BaseAvatar.Root
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-2 text-sm font-medium text-ink select-none",
        className,
      )}
      {...props}
    />
  );
}

export function AvatarImage({ className, ...props }: BaseAvatar.Image.Props) {
  return <BaseAvatar.Image className={cn("size-full object-cover", className)} {...props} />;
}

export function AvatarFallback({ className, ...props }: BaseAvatar.Fallback.Props) {
  return (
    <BaseAvatar.Fallback
      className={cn("flex size-full items-center justify-center", className)}
      {...props}
    />
  );
}

export const Avatar = {
  Root: AvatarRoot,
  Image: AvatarImage,
  Fallback: AvatarFallback,
};
