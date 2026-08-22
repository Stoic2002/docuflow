import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { Slot } from "@radix-ui/react-slot";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean;
  variant?: "primary" | "secondary" | "ghost" | "danger";
};

export function Button({ asChild, variant = "primary", className, ...props }: ButtonProps) {
  const Component = asChild ? Slot : "button";
  return (
    <Component
      className={cx(
        "inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-bold leading-none transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:border-line disabled:bg-[#ded9d1] disabled:text-[#8b867e] disabled:opacity-100 disabled:shadow-none disabled:hover:bg-[#ded9d1]",
        variant === "primary" && "border border-ink bg-ink text-paper hover:border-accent hover:bg-accent",
        variant === "secondary" && "border border-ink bg-paper text-ink hover:bg-accent-soft",
        variant === "ghost" && "text-ink hover:bg-accent-soft hover:text-accent",
        variant === "danger" && "border border-accent bg-accent text-white hover:bg-[#d71919]",
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx("rounded-[1.75rem] border border-line bg-paper shadow-[0_1px_0_rgba(23,23,19,0.04)]", className)}
      {...props}
    />
  );
}

export function Tooltip({ children, content }: { children: ReactNode; content: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={250}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            sideOffset={6}
            className="z-[200] max-w-72 rounded-xl bg-ink px-3 py-2 text-xs text-paper shadow-xl"
          >
            {content}
            <TooltipPrimitive.Arrow className="fill-ink" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Konfirmasi",
  cancelLabel = "Batal",
  pending = false,
  danger = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  pending?: boolean;
  danger?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={(nextOpen) => {
      if (!pending) onOpenChange(nextOpen);
    }}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay
          className="bg-ink/65 backdrop-blur-[2px] data-[state=closed]:opacity-0 data-[state=open]:opacity-100"
          style={{ position: "fixed", inset: 0, zIndex: 2147483646 }}
        />
        <AlertDialogPrimitive.Content
          className="w-[calc(100%-2rem)] max-w-md rounded-[2rem] border border-ink bg-paper p-6 shadow-[8px_8px_0_#ff2d2d] focus:outline-none sm:p-7"
          style={{
            position: "fixed",
            left: "50%",
            top: "50%",
            zIndex: 2147483647,
            transform: "translate(-50%, -50%)",
            maxHeight: "calc(100vh - 2rem)",
            overflowY: "auto",
          }}
        >
          <div className="mb-5 flex size-12 items-center justify-center rounded-full bg-accent-soft text-2xl text-accent" aria-hidden="true">!</div>
          <AlertDialogPrimitive.Title className="font-display text-3xl font-medium leading-none tracking-tight text-ink">
            {title}
          </AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description className="mt-3 text-sm leading-6 text-muted">
            {description}
          </AlertDialogPrimitive.Description>
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <AlertDialogPrimitive.Cancel asChild>
              <Button type="button" variant="secondary" disabled={pending}>{cancelLabel}</Button>
            </AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action asChild>
              <Button
                type="button"
                variant={danger ? "danger" : "primary"}
                disabled={pending}
                onClick={(event) => {
                  event.preventDefault();
                  onConfirm();
                }}
              >
                {pending ? "Memproses…" : confirmLabel}
              </Button>
            </AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
