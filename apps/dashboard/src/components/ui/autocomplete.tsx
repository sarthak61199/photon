import { Autocomplete as BaseAutocomplete } from "@base-ui/react/autocomplete";
import { cn } from "../../lib/cn";

export const AutocompleteRoot = BaseAutocomplete.Root;

export function AutocompleteInput({ className, ...props }: BaseAutocomplete.Input.Props) {
  return (
    <BaseAutocomplete.Input
      className={cn(
        "h-9 w-full rounded-md border border-line bg-surface-2 px-3 text-sm text-ink placeholder:text-ink-dim",
        "outline-hidden focus:border-amber focus:outline-2 focus:outline-offset-0 focus:outline-amber/40",
        className,
      )}
      {...props}
    />
  );
}

export function AutocompletePopup({ className, ...props }: BaseAutocomplete.Popup.Props) {
  return (
    <BaseAutocomplete.Portal>
      <BaseAutocomplete.Positioner sideOffset={4} className="outline-hidden">
        <BaseAutocomplete.Popup
          className={cn(
            "min-w-(--anchor-width) rounded-md border border-line bg-surface-1 py-1 text-ink shadow-lg outline-hidden",
            "transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
            className,
          )}
          {...props}
        />
      </BaseAutocomplete.Positioner>
    </BaseAutocomplete.Portal>
  );
}

export function AutocompleteList({ className, ...props }: BaseAutocomplete.List.Props) {
  return (
    <BaseAutocomplete.List
      className={cn("max-h-(--available-height) overflow-y-auto", className)}
      {...props}
    />
  );
}

export function AutocompleteItem({ className, ...props }: BaseAutocomplete.Item.Props) {
  return (
    <BaseAutocomplete.Item
      className={cn(
        "flex cursor-default items-center gap-2 px-3 py-1.5 text-sm outline-hidden select-none",
        "data-highlighted:bg-surface-2",
        className,
      )}
      {...props}
    />
  );
}

export function AutocompleteEmpty({ className, ...props }: BaseAutocomplete.Empty.Props) {
  return (
    <BaseAutocomplete.Empty
      className={cn("px-3 py-2 text-sm text-ink-dim", className)}
      {...props}
    />
  );
}

export const Autocomplete = {
  Root: AutocompleteRoot,
  Input: AutocompleteInput,
  Popup: AutocompletePopup,
  List: AutocompleteList,
  Item: AutocompleteItem,
  Empty: AutocompleteEmpty,
};
