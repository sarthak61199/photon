import { Menu as BaseMenu } from "@base-ui/react/menu";
import { cn } from "../../lib/cn";

export const MenuRoot = BaseMenu.Root;

export function MenuTrigger({ className, ...props }: BaseMenu.Trigger.Props) {
  return (
    <BaseMenu.Trigger
      className={cn(
        "rounded-md outline-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber",
        className,
      )}
      {...props}
    />
  );
}

export function MenuPopup({
  className,
  align,
  side,
  sideOffset = 8,
  ...props
}: BaseMenu.Popup.Props & Pick<BaseMenu.Positioner.Props, "align" | "side" | "sideOffset">) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner
        align={align}
        side={side}
        sideOffset={sideOffset}
        className="outline-hidden"
      >
        <BaseMenu.Popup
          className={cn(
            "min-w-40 origin-(--transform-origin) rounded-md border border-line bg-surface-1 py-1 text-ink shadow-lg outline-hidden",
            "transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
            className,
          )}
          {...props}
        />
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
}

export function MenuItem({ className, ...props }: BaseMenu.Item.Props) {
  return (
    <BaseMenu.Item
      className={cn(
        "flex cursor-default items-center gap-2 px-3 py-1.5 text-sm outline-hidden select-none",
        "data-highlighted:bg-surface-2 data-disabled:text-ink-dim",
        className,
      )}
      {...props}
    />
  );
}

export function MenuSeparator({ className, ...props }: BaseMenu.Separator.Props) {
  return <BaseMenu.Separator className={cn("my-1 h-px bg-line", className)} {...props} />;
}

export function MenuGroupLabel({ className, ...props }: BaseMenu.GroupLabel.Props) {
  return (
    <BaseMenu.GroupLabel
      className={cn("px-3 py-1 text-xs font-medium text-ink-dim", className)}
      {...props}
    />
  );
}

export const MenuGroup = BaseMenu.Group;

export const Menu = {
  Root: MenuRoot,
  Trigger: MenuTrigger,
  Popup: MenuPopup,
  Item: MenuItem,
  Separator: MenuSeparator,
  Group: MenuGroup,
  GroupLabel: MenuGroupLabel,
};
