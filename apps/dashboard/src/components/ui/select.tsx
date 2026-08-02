import { Select as BaseSelect } from "@base-ui/react/select";
import { cn } from "../../lib/cn";

export const SelectRoot = BaseSelect.Root;
export const SelectValue = BaseSelect.Value;
export const SelectIcon = BaseSelect.Icon;
export const SelectGroup = BaseSelect.Group;

export function SelectTrigger({ className, children, ...props }: BaseSelect.Trigger.Props) {
  return (
    <BaseSelect.Trigger
      className={cn(
        "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-line bg-surface-2 px-3 text-sm text-ink",
        "outline-hidden focus:border-amber focus:outline-2 focus:outline-offset-0 focus:outline-amber/40",
        "data-disabled:cursor-not-allowed data-disabled:opacity-60",
        className,
      )}
      {...props}
    >
      {children}
    </BaseSelect.Trigger>
  );
}

export function SelectPopup({ className, ...props }: BaseSelect.Popup.Props) {
  return (
    <BaseSelect.Portal>
      <BaseSelect.Positioner sideOffset={4} className="outline-hidden">
        <BaseSelect.Popup
          className={cn(
            "min-w-(--anchor-width) rounded-md border border-line bg-surface-1 py-1 text-ink shadow-lg outline-hidden",
            "transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
            className,
          )}
          {...props}
        />
      </BaseSelect.Positioner>
    </BaseSelect.Portal>
  );
}

export function SelectList({ className, ...props }: BaseSelect.List.Props) {
  return (
    <BaseSelect.List
      className={cn("max-h-(--available-height) overflow-y-auto", className)}
      {...props}
    />
  );
}

export function SelectItem({ className, ...props }: BaseSelect.Item.Props) {
  return (
    <BaseSelect.Item
      className={cn(
        "flex cursor-default items-center gap-2 px-3 py-1.5 text-sm outline-hidden select-none",
        "data-highlighted:bg-surface-2 data-disabled:text-ink-dim",
        className,
      )}
      {...props}
    />
  );
}

export function SelectItemText({ className, ...props }: BaseSelect.ItemText.Props) {
  return <BaseSelect.ItemText className={cn(className)} {...props} />;
}

export function SelectItemIndicator({ className, ...props }: BaseSelect.ItemIndicator.Props) {
  return <BaseSelect.ItemIndicator className={cn("text-amber", className)} {...props} />;
}

export function SelectGroupLabel({ className, ...props }: BaseSelect.GroupLabel.Props) {
  return (
    <BaseSelect.GroupLabel
      className={cn("px-3 py-1 text-xs font-medium text-ink-dim", className)}
      {...props}
    />
  );
}

export const Select = {
  Root: SelectRoot,
  Trigger: SelectTrigger,
  Value: SelectValue,
  Icon: SelectIcon,
  Popup: SelectPopup,
  List: SelectList,
  Item: SelectItem,
  ItemText: SelectItemText,
  ItemIndicator: SelectItemIndicator,
  Group: SelectGroup,
  GroupLabel: SelectGroupLabel,
};
