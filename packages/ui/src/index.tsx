import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { Slot } from "@radix-ui/react-slot";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type {
  ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes,
  ReactNode, SelectHTMLAttributes,
} from "react";
import { useId, useState } from "react";

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

/**
 * Square icon-only button. Unlike a ghost Button it always carries a border, so
 * a row of them reads as controls rather than as loose glyphs.
 */
export function IconButton({
  active = false,
  className,
  size = "md",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; size?: "sm" | "md" }) {
  return (
    <button
      type="button"
      aria-pressed={props["aria-pressed"] ?? active}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-xl border transition duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
        "disabled:cursor-not-allowed disabled:border-line disabled:bg-[#f1ede6] disabled:text-[#b3ada3]",
        size === "sm" ? "size-8" : "size-10",
        active
          ? "border-ink bg-ink text-paper shadow-[0_1px_0_rgba(23,23,19,.2)]"
          : "border-line bg-paper text-ink hover:border-ink hover:bg-accent-soft hover:text-accent",
        className,
      )}
      {...props}
    />
  );
}

/** Label plus control, so every form row lines up the same way. */
export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-xs font-semibold text-ink/70">
        {label}
      </label>
      {children}
      {hint ? <p className="text-[11px] leading-4 text-muted">{hint}</p> : null}
    </div>
  );
}

export function TextInput({ className, invalid, ...props }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input className={cx("form-control h-9 min-h-0 text-sm", invalid && "border-accent", className)} {...props} />;
}

/** A titled group with a hairline above it, so a panel reads as sections. */
export function PanelSection({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-line px-4 py-3.5 first:border-t-0">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-bold text-ink">{title}</h3>
        {aside}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function SelectInput({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  // The chevron comes from CSS on the element itself; see select.form-control.
  return (
    <select className={cx("form-control h-9 min-h-0 cursor-pointer text-sm", className)} {...props}>
      {children}
    </select>
  );
}

/** A row of small toggles, used for text emphasis and alignment. */
export function ToggleGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <span className="block text-xs font-semibold text-ink/70">{label}</span>
      <div className="flex items-center gap-1" role="group" aria-label={label}>{children}</div>
    </div>
  );
}

/** A full six-digit hex, with or without the leading hash. */
const HEX_PATTERN = /^#?[0-9a-fA-F]{6}$/;

/**
 * Swatch and hex box driven by one value. While the hex box has focus it holds
 * whatever is being typed, and the value only changes once the text is a
 * complete colour, so a half-typed code never blanks what it is editing.
 */
export function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const shown = focused ? draft : value.toUpperCase();
  const invalid = focused && !HEX_PATTERN.test(draft);
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        aria-label={`${label}: pemilih warna`}
        onChange={(event) => {
          setDraft(event.target.value);
          onChange(event.target.value);
        }}
        className="size-9 shrink-0 cursor-pointer rounded-lg border border-line bg-paper p-1"
      />
      <TextInput
        value={shown}
        spellCheck={false}
        maxLength={7}
        placeholder="#000000"
        aria-label={`${label}: kode hex`}
        invalid={invalid}
        className="font-mono uppercase"
        onFocus={() => {
          setDraft(value);
          setFocused(true);
        }}
        onBlur={() => setFocused(false)}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          if (HEX_PATTERN.test(next)) onChange(next.startsWith("#") ? next : `#${next}`);
        }}
      />
    </div>
  );
}

export function RangeInput({
  label,
  value,
  suffix,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; value: number; suffix?: string }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-xs font-semibold text-ink/70">{label}</label>
        <span className="rounded-md bg-canvas px-1.5 py-0.5 font-mono text-[11px] text-ink">{Math.round(value * 100) / 100}{suffix ?? ""}</span>
      </div>
      <input
        id={id}
        type="range"
        value={value}
        aria-label={label}
        className={cx("h-1.5 w-full cursor-pointer appearance-none rounded-full bg-line accent-accent", className)}
        {...props}
      />
    </div>
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
