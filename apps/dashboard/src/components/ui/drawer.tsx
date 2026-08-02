import { Drawer as BaseDrawer } from "@base-ui/react/drawer";
import { cn } from "../../lib/cn";

export const DrawerRoot = BaseDrawer.Root;
export const DrawerTrigger = BaseDrawer.Trigger;
export const DrawerClose = BaseDrawer.Close;

export function DrawerPopup({ className, children, ...props }: BaseDrawer.Popup.Props) {
  return (
    <BaseDrawer.Portal>
      <BaseDrawer.Backdrop
        className={cn(
          "fixed inset-0 bg-surface-0/70 transition-opacity duration-150 ease-out",
          "data-ending-style:opacity-0 data-starting-style:opacity-0",
        )}
      />
      <BaseDrawer.Viewport>
        <BaseDrawer.Popup
          className={cn(
            "fixed inset-y-0 right-0 flex h-full w-full max-w-sm flex-col border-l border-line bg-surface-1 p-6 text-ink shadow-xl outline-hidden",
            "transition-transform duration-150 ease-out data-ending-style:translate-x-full data-starting-style:translate-x-full",
            className,
          )}
          {...props}
        >
          <BaseDrawer.Content className="flex h-full flex-col gap-4">{children}</BaseDrawer.Content>
        </BaseDrawer.Popup>
      </BaseDrawer.Viewport>
    </BaseDrawer.Portal>
  );
}

export function DrawerTitle({ className, ...props }: BaseDrawer.Title.Props) {
  return <BaseDrawer.Title className={cn("text-lg font-medium text-ink", className)} {...props} />;
}

export function DrawerDescription({ className, ...props }: BaseDrawer.Description.Props) {
  return <BaseDrawer.Description className={cn("text-sm text-ink-dim", className)} {...props} />;
}

export const Drawer = {
  Root: DrawerRoot,
  Trigger: DrawerTrigger,
  Popup: DrawerPopup,
  Title: DrawerTitle,
  Description: DrawerDescription,
  Close: DrawerClose,
};
