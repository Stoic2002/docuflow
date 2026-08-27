import { Tooltip } from "@pdf-studio/ui";
import type { LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * A control that needs more room than a toolbar button: the trigger sits in
 * the bar and the panel drops under it.
 *
 * The panel is portalled to the body rather than nested in the trigger. The
 * toolbar scrolls sideways when it runs out of room, and a scroll container
 * clips both axes — a panel inside it was simply invisible, which read as the
 * button doing nothing at all.
 */
export function BarPopover({
  label,
  icon: Icon,
  swatch,
  children,
}: {
  label: string;
  icon?: LucideIcon;
  /** Colour shown in place of an icon, for the fill and stroke triggers. */
  swatch?: string;
  children: ReactNode;
}) {
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const open = anchor !== null;

  const toggle = () => {
    if (open) {
      setAnchor(null);
      return;
    }
    const box = trigger.current?.getBoundingClientRect();
    if (!box) return;
    // Kept inside the viewport: a trigger near the right edge would otherwise
    // hang half of its panel off the screen.
    const half = PANEL_WIDTH / 2;
    const centre = box.left + box.width / 2;
    setAnchor({
      left: Math.min(Math.max(centre, half + 8), Math.max(half + 8, window.innerWidth - half - 8)),
      top: box.bottom + 8,
    });
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (trigger.current?.contains(target) || panel.current?.contains(target)) return;
      setAnchor(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAnchor(null);
    };
    // The anchor is measured once, so anything that moves the trigger closes it.
    const onMoved = () => setAnchor(null);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onMoved);
    window.addEventListener("scroll", onMoved, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onMoved);
      window.removeEventListener("scroll", onMoved, true);
    };
  }, [open]);

  return (
    <>
      <Tooltip content={label}>
        <button
          ref={trigger}
          type="button"
          aria-label={label}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={toggle}
          className={`flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl px-2.5 text-xs font-bold transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            open ? "bg-accent-soft text-accent" : "text-ink hover:bg-canvas"
          }`}
        >
          {swatch && Icon ? (
            // The glyph says what the colour is for, the bar under it says
            // which colour — a bare square said neither.
            <span className="flex flex-col items-center gap-0.5" aria-hidden="true">
              <Icon className="size-4 shrink-0" />
              <span
                className="h-[3px] w-4 rounded-full border border-line/60"
                style={{ backgroundColor: swatch }}
              />
            </span>
          ) : swatch ? (
            <span
              className="size-4 shrink-0 rounded-md border border-line"
              style={{ backgroundColor: swatch }}
              aria-hidden="true"
            />
          ) : Icon ? (
            <Icon className="size-4 shrink-0" aria-hidden="true" />
          ) : null}
          {/* A word says what a lone glyph cannot; colours speak for themselves. */}
          {swatch ? null : <span className="whitespace-nowrap">{label}</span>}
        </button>
      </Tooltip>
      {open
        ? createPortal(
            <div
              ref={panel}
              id={panelId}
              role="dialog"
              aria-label={label}
              data-editor-chrome
              className="fixed z-[120] -translate-x-1/2 space-y-3 rounded-2xl border border-line bg-paper p-4 shadow-[0_8px_28px_rgba(23,23,19,.16)]"
              style={{ left: anchor.left, top: anchor.top, width: PANEL_WIDTH }}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

const PANEL_WIDTH = 256;
