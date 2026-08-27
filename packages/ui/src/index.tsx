import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { Slot } from "@radix-ui/react-slot";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cva, type VariantProps } from "class-variance-authority";
import type {
  ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes,
  ReactNode, SelectHTMLAttributes,
} from "react";
import { useEffect, useId, useRef, useState } from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn-style class combiner: conditional classes plus Tailwind conflict resolution. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * shadcn-style button: variants and sizes live in one cva table so call sites
 * can compose `variant` / `size` / className freely (twMerge resolves clashes).
 * The palette stays Docuflow's ink/paper/accent instead of shadcn's zinc.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-bold leading-none transition-all duration-200 outline-none focus-visible:ring-[3px] focus-visible:ring-accent/40 disabled:pointer-events-none disabled:bg-[#ded9d1] disabled:text-[#8b867e] disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary: "border border-ink bg-ink text-paper hover:border-accent hover:bg-accent",
        secondary: "border border-ink bg-paper text-ink hover:bg-accent-soft",
        ghost: "text-ink hover:bg-accent-soft hover:text-accent",
        danger: "border border-accent bg-accent text-white hover:bg-[#d71919]",
      },
      size: {
        default: "min-h-12 px-6 py-3",
        sm: "min-h-9 px-4 py-2 text-xs",
        icon: "size-10 p-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

export function Button({ asChild, variant, size, className, ...props }: ButtonProps) {
  const Component = asChild ? Slot : "button";
  return (
    <Component
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
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
      data-slot="icon-button"
      aria-pressed={props["aria-pressed"] ?? active}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-xl border transition duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-accent/40",
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
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
        {label}
      </label>
      {children}
      {hint ? <p className="text-[11px] leading-4 text-muted">{hint}</p> : null}
    </div>
  );
}

/** shadcn Input recipe on Docuflow tokens: soft ring focus, invalid state via prop or aria-invalid. */
export function TextInput({ className, invalid, ...props }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      data-slot="input"
      className={cn(
        "flex h-9 w-full min-w-0 rounded-[0.9rem] border border-[#bdb6ab] bg-paper px-3 py-1 text-sm text-ink transition-[color,box-shadow] outline-none",
        "placeholder:text-muted/70 selection:bg-accent selection:text-white",
        "focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent/30",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-line disabled:bg-canvas disabled:text-muted",
        "aria-invalid:border-accent aria-invalid:ring-[3px] aria-invalid:ring-accent/25",
        invalid && "border-accent ring-[3px] ring-accent/25",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A checkbox that can also sit half-checked. `indeterminate` is a DOM property
 * with no HTML attribute, so it has to be written to the node directly — which
 * is why this exists instead of a bare input.
 */
export function Checkbox({
  label,
  indeterminate,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; indeterminate?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(indeterminate);
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      className={cn(
        "size-4 shrink-0 cursor-pointer rounded-[4px] accent-accent",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent/30",
        className,
      )}
      {...props}
    />
  );
}

/** A titled group with a dashed hairline above it, so a panel reads as sections. */
export function PanelSection({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-dashed border-line px-5 py-5 first:border-t-0">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-black uppercase tracking-[0.16em] text-muted">{title}</h3>
        {aside}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

/** Native select styled like the shadcn Input, with the chevron drawn by the control itself. */
export function SelectInput({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      data-slot="select"
      className={cn(
        "select-chevron flex h-9 w-full min-w-0 cursor-pointer rounded-[0.9rem] border border-[#bdb6ab] bg-paper px-3 pr-9 py-1 text-sm text-ink transition-[color,box-shadow] outline-none",
        "focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent/30",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-line disabled:bg-canvas disabled:text-muted",
        "aria-invalid:border-accent aria-invalid:ring-[3px] aria-invalid:ring-accent/25",
        className,
      )}
      {...props}
    >
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
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">{label}</label>
        <span data-slot="slider-value" className="rounded-full bg-canvas px-2 py-0.5 font-mono text-[11px] text-ink">{Math.round(value * 100) / 100}{suffix ?? ""}</span>
      </div>
      {/* Native range wearing the shadcn Slider look (track + floating thumb);
          staying native keeps the change event and tests untouched. */}
      <input
        id={id}
        type="range"
        value={value}
        aria-label={label}
        className={cn(
          "h-1.5 w-full cursor-pointer appearance-none rounded-full bg-line outline-none focus-visible:ring-[3px] focus-visible:ring-accent/30",
          "[&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-line [&::-webkit-slider-thumb]:bg-paper [&::-webkit-slider-thumb]:shadow-[0_1px_3px_rgba(23,23,19,.4)] [&::-webkit-slider-thumb]:transition-colors hover:[&::-webkit-slider-thumb]:bg-accent-soft",
          "[&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-line [&::-moz-range-thumb]:bg-paper [&::-moz-range-thumb]:shadow-[0_1px_3px_rgba(23,23,19,.4)]",
          className,
        )}
        {...props}
      />
    </div>
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="card"
      className={cn("rounded-[1.75rem] border border-line bg-paper text-ink shadow-[0_1px_0_rgba(23,23,19,0.04)]", className)}
      {...props}
    />
  );
}

export function Tooltip({ children, content, side = "top" }: {
  children: ReactNode;
  content: ReactNode;
  /** Which edge of the trigger the bubble appears on. Vertical rails want "right". */
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <TooltipPrimitive.Provider delayDuration={250}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={6}
            data-slot="tooltip-content"
            className="z-[200] max-w-72 rounded-lg bg-ink px-3 py-1.5 text-xs text-paper shadow-md"
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
          data-slot="alert-dialog-overlay"
          className="bg-ink/65 backdrop-blur-[2px] data-[state=closed]:opacity-0 data-[state=open]:opacity-100"
          style={{ position: "fixed", inset: 0, zIndex: 2147483646 }}
        />
        <AlertDialogPrimitive.Content
          data-slot="alert-dialog-content"
          // Inline centering/z-index is deliberate: the documents-page test
          // guards against the past "dialog rendered under the table" bug and
          // must not depend on app CSS being loaded.
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
