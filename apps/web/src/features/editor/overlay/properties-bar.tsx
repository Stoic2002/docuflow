import type { RegisteredFont } from "@pdf-studio/api-client";
import { Checkbox, ColorInput, Field, RangeInput, SelectInput, TextInput, Tooltip } from "@pdf-studio/ui";
import {
  AlignCenter, AlignLeft, AlignRight, ArrowDownToLine, ArrowUpToLine, Baseline,
  Bold, Copy, Italic, Layers, Minus, Move3d, MoveRight, PaintBucket, PenLine, Plus,
  Ruler, Strikethrough, Trash2, Type, Underline, WrapText,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { BarPopover } from "./bar-popover";
import { alignPatch } from "./scale";
import { splitForStyle } from "./split";
import { displayStyle, effectiveStyle, groupByFamily, toggleEmphasis } from "./font-variants";
import { fontStack, overflowsCover } from "./geometry";
import { useOverlayStore } from "./store";
import { MAX_TEXT_LENGTH, type OverlayObject, type TextObject, boundsOf, isBox, isPath, textLayoutOf } from "./types";

/** The sizes a document actually uses, so the common case is one click. */
const FONT_SIZES = [6, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72, 96, 120, 144];

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Size as a stepper wrapped around the list of common sizes: the arrows cover
 * nudging, the list covers jumping, and text taken over from the page keeps
 * its own odd size as an entry of its own.
 */
function FontSizeControl({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const current = round(value);
  const options = FONT_SIZES.includes(current) ? FONT_SIZES : [...FONT_SIZES, current].sort((a, b) => a - b);
  const step = (direction: 1 | -1) => {
    const index = options.indexOf(current);
    const next = index === -1
      ? current + direction
      : options[Math.min(options.length - 1, Math.max(0, index + direction))];
    onChange(Math.min(288, Math.max(4, next)));
  };
  return (
    <div className="flex shrink-0 items-center rounded-xl border border-line/70 bg-canvas/60">
      <BarIcon label="Perkecil ukuran" icon={Minus} onClick={() => step(-1)} />
      <SelectInput
        aria-label="Ukuran teks"
        value={String(current)}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-8 w-[4.5rem] border-transparent bg-transparent px-2 pr-6 text-center text-xs font-bold"
      >
        {options.map((size) => (
          <option key={size} value={String(size)}>{size}</option>
        ))}
      </SelectInput>
      <BarIcon label="Perbesar ukuran" icon={Plus} onClick={() => step(1)} />
    </div>
  );
}

/** Thicknesses a drawing actually uses, so the common case is one click. */
const STROKE_WIDTHS = [0, 0.5, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24];

function StrokeWidthControl({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const current = round(value);
  const options = STROKE_WIDTHS.includes(current) ? STROKE_WIDTHS : [...STROKE_WIDTHS, current].sort((a, b) => a - b);
  const step = (direction: 1 | -1) => {
    const index = options.indexOf(current);
    const next = options[Math.min(options.length - 1, Math.max(0, index + direction))];
    onChange(next ?? current);
  };
  return (
    <div className="flex shrink-0 items-center rounded-xl border border-line/70 bg-canvas/60">
      <BarIcon label="Tipiskan garis" icon={Minus} onClick={() => step(-1)} />
      <SelectInput
        aria-label="Tebal garis"
        value={String(current)}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-8 w-[4.5rem] border-transparent bg-transparent px-2 pr-6 text-center text-xs font-bold"
      >
        {options.map((width) => (
          <option key={width} value={String(width)}>{width} pt</option>
        ))}
      </SelectInput>
      <BarIcon label="Tebalkan garis" icon={Plus} onClick={() => step(1)} />
    </div>
  );
}

function BarIcon({ label, icon: Icon, active = false, onClick }: {
  label: string;
  icon: LucideIcon;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
        className={`flex size-9 shrink-0 items-center justify-center rounded-xl transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          active ? "bg-accent-soft text-accent" : "text-ink hover:bg-canvas"
        }`}
      >
        <Icon className="size-4 shrink-0" />
      </button>
    </Tooltip>
  );
}

function Divider() {
  return <span className="mx-0.5 h-6 w-px shrink-0 self-center bg-line" aria-hidden="true" />;
}

function Group({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 items-center gap-0.5">{children}</div>;
}

/**
 * The contextual toolbar: what floats above the page while something is
 * selected. Controls that fit stay in the bar, and the rest — colours, sizing,
 * stacking, appearance — hang off it in popovers, so the bar keeps to one row
 * however wide the selection's options get.
 */
export function PropertiesBar({ fonts, fontsAvailable }: { fonts: RegisteredFont[]; fontsAvailable: boolean }) {
  const objects = useOverlayStore((state) => state.objects);
  const selectedId = useOverlayStore((state) => state.selectedId);
  const update = useOverlayStore((state) => state.update);
  const duplicate = useOverlayStore((state) => state.duplicate);
  const bringToFront = useOverlayStore((state) => state.bringToFront);
  const sendToBack = useOverlayStore((state) => state.sendToBack);
  const remove = useOverlayStore((state) => state.remove);
  const replace = useOverlayStore((state) => state.replace);
  const textRange = useOverlayStore((state) => state.textRange);
  const selected = objects.find((object) => object.id === selectedId);

  // Nothing selected means nothing to say: the bar disappears rather than
  // sitting there greyed out over the page.
  if (!selected) return null;

  const patch = (values: Partial<OverlayObject>) => update(selected.id, values);

  /**
   * A style applies to the characters the reader selected, not to everything
   * they happen to sit beside: with part of a line selected, the object is cut
   * so only that part changes. Selecting nothing, or all of it, styles the
   * whole object as before — and so does a box whose words wrap, which cannot
   * be cut into pieces without breaking the flow.
   */
  const styleText = (values: Partial<TextObject>) => {
    if (selected.kind === "text" && textRange?.id === selected.id) {
      const pieces = splitForStyle(selected, textRange.start, textRange.end, values);
      if (pieces && replace(selected.id, pieces)) return;
    }
    patch(values);
  };
  // Emphasis can come from the chosen face or from a synthesised flag; the
  // toggles reflect whichever is in play.
  const emphasis = selected.kind === "text" ? effectiveStyle(selected, fonts) : { bold: false, italic: false };
  const overflowing = selected.kind === "text"
    && !selected.boxWidth
    && overflowsCover(selected.text, selected.fontSize, fontStack(selected.font, fonts), selected.coverWidth);

  return (
    <div
      data-editor-chrome
      role="toolbar"
      aria-label="Properti objek terpilih"
      className="pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-2xl border border-line bg-paper/95 px-2 py-1.5 shadow-[0_6px_24px_rgba(23,23,19,.14)] backdrop-blur [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {selected.kind === "text" ? (
        <>
          <SelectInput
            aria-label="Font"
            value={selected.font}
            onChange={(event) => styleText({ font: event.target.value })}
            title={fontsAvailable ? undefined : "Belum ada .ttf di assets/fonts pada server."}
            className="h-9 w-40 shrink-0 rounded-xl border-transparent bg-canvas/60 text-xs font-bold"
          >
            <option value="">Helvetica bawaan</option>
            {groupByFamily(fonts).map((group) => (
              <optgroup key={group.name} label={group.name}>
                {group.faces.map((font) => (
                  <option key={font.id} value={font.id}>{group.name} {displayStyle(font.family)}</option>
                ))}
              </optgroup>
            ))}
          </SelectInput>
          <FontSizeControl value={selected.fontSize} onChange={(fontSize) => styleText({ fontSize })} />
          <Divider />
          <BarPopover label="Warna teks" icon={Baseline} swatch={selected.color}>
            <Field label="Warna teks">
              <ColorInput label="Warna teks" value={selected.color} onChange={(color) => styleText({ color })} />
            </Field>
          </BarPopover>
          <Group>
            <BarIcon
              label="Tebal"
              icon={Bold}
              active={emphasis.bold}
              onClick={() => styleText(toggleEmphasis(selected, fonts, "bold"))}
            />
            <BarIcon
              label="Miring"
              icon={Italic}
              active={emphasis.italic}
              onClick={() => styleText(toggleEmphasis(selected, fonts, "italic"))}
            />
            <BarIcon label="Garis bawah" icon={Underline} active={Boolean(selected.underline)} onClick={() => styleText({ underline: !selected.underline })} />
            <BarIcon label="Coret" icon={Strikethrough} active={Boolean(selected.strikethrough)} onClick={() => styleText({ strikethrough: !selected.strikethrough })} />
          </Group>
          <Divider />
          <Group>
            <BarIcon label="Rata kiri" icon={AlignLeft} active={selected.align === "left"} onClick={() => patch(alignPatch(selected, "left"))} />
            <BarIcon label="Rata tengah" icon={AlignCenter} active={selected.align === "center"} onClick={() => patch(alignPatch(selected, "center"))} />
            <BarIcon label="Rata kanan" icon={AlignRight} active={selected.align === "right"} onClick={() => patch(alignPatch(selected, "right"))} />
          </Group>
          <Divider />
          <BarPopover label="Ubah isi" icon={Type}>
            <Field label="Isi teks" hint="Bisa juga diketik langsung di kanvas.">
              <TextInput
                value={selected.text}
                maxLength={MAX_TEXT_LENGTH}
                aria-label="Isi teks"
                onChange={(event) => patch({ text: event.target.value.replace(/[\r\n]+/g, " ") })}
                className="rounded-xl border-transparent bg-canvas/70 focus-visible:bg-paper"
              />
            </Field>
            {overflowing ? (
              <p className="rounded-xl bg-accent-soft px-3 py-2.5 text-[11px] font-semibold leading-4 text-accent" role="alert">
                Lebih panjang dari teks aslinya dan tidak mengalir ke baris berikutnya.
              </p>
            ) : null}
          </BarPopover>
        </>
      ) : null}

      {isBox(selected) || isPath(selected) ? (
        <>
          <BarPopover label="Warna garis" icon={PenLine} swatch={selected.stroke}>
            <Field label="Warna garis">
              <ColorInput label="Warna garis" value={selected.stroke} onChange={(stroke) => patch({ stroke })} />
            </Field>
          </BarPopover>
          <StrokeWidthControl value={selected.strokeWidth} onChange={(strokeWidth) => patch({ strokeWidth })} />
          {isPath(selected) ? (
            <BarIcon
              label="Mata panah di ujung"
              icon={MoveRight}
              active={Boolean(selected.arrow)}
              onClick={() => patch({ arrow: !selected.arrow })}
            />
          ) : null}
          {isBox(selected) ? (
            <BarPopover label="Warna isi" icon={PaintBucket} swatch={selected.fill ?? "transparent"}>
              <label className="flex items-center gap-2.5 text-xs font-semibold text-ink">
                <Checkbox
                  label="Beri warna isi"
                  checked={selected.fill !== null}
                  onChange={(event) => patch({ fill: event.target.checked ? "#ffe08a" : null })}
                />
                Beri warna isi
              </label>
              {selected.fill !== null ? (
                <ColorInput label="Warna isi" value={selected.fill} onChange={(fill) => patch({ fill })} />
              ) : null}
              {selected.strokeWidth === 0 && selected.fill === null ? (
                <p className="rounded-xl bg-accent-soft px-3 py-2.5 text-[11px] font-semibold leading-4 text-accent" role="alert">
                  Objek ini tidak akan terlihat. Beri ketebalan garis atau warna isi.
                </p>
              ) : null}
            </BarPopover>
          ) : null}
          <Divider />
        </>
      ) : null}

      {selected.kind === "text" ? (
        <BarPopover label="Bungkus teks" icon={WrapText}>
          {selected.boxWidth ? (
            <>
              <RangeInput
                label="Lebar kotak"
                min={Math.ceil(selected.fontSize * 2)}
                max={1200}
                step={1}
                suffix=" pt"
                value={selected.boxWidth}
                onChange={(event) => patch({ boxWidth: event.currentTarget.valueAsNumber })}
              />
              <p className="text-[11px] leading-4 text-muted">
                Teks membungkus jadi {textLayoutOf(selected).lines.length} baris. Tarik grip kiri
                atau kanan di kanvas untuk mengubahnya langsung.
              </p>
              <button
                type="button"
                onClick={() => patch({ boxWidth: undefined })}
                className="w-full rounded-xl border border-line px-3 py-2 text-xs font-bold text-ink transition hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Kembalikan ke satu baris
              </button>
            </>
          ) : (
            <>
              <p className="text-[11px] leading-4 text-muted">
                Teks ini satu baris dan tidak membungkus. Beri lebar kotak supaya kata yang
                melewatinya turun ke baris berikutnya.
              </p>
              <button
                type="button"
                onClick={() => patch({ boxWidth: Math.max(selected.fontSize * 2, Math.round(boundsOf(selected).width)) })}
                className="w-full rounded-xl border border-line px-3 py-2 text-xs font-bold text-ink transition hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Bungkus dalam kotak
              </button>
            </>
          )}
        </BarPopover>
      ) : null}

      {isBox(selected) || selected.kind === "image" ? (
        <BarPopover label="Ukuran" icon={Ruler}>
          <RangeInput label="Lebar" min={4} max={1200} step={1} suffix=" pt" value={selected.width} onChange={(event) => patch({ width: event.currentTarget.valueAsNumber })} />
          <RangeInput label="Tinggi" min={4} max={1200} step={1} suffix=" pt" value={selected.height} onChange={(event) => patch({ height: event.currentTarget.valueAsNumber })} />
        </BarPopover>
      ) : null}

      <BarPopover label="Tampilan" icon={Move3d}>
        <RangeInput label="Opacity" min={0.05} max={1} step={0.05} value={selected.opacity} onChange={(event) => patch({ opacity: event.currentTarget.valueAsNumber })} />
        <RangeInput label="Rotasi" min={-180} max={180} step={1} suffix="°" value={selected.rotation} onChange={(event) => patch({ rotation: event.currentTarget.valueAsNumber })} />
      </BarPopover>

      <BarPopover label="Posisi" icon={Layers}>
        <div role="group" aria-label="Susunan objek" className="space-y-1">
          <PopoverAction label="Duplikat" hint="Salin objek ini sedikit bergeser." icon={Copy} onClick={() => duplicate(selected.id)} />
          <PopoverAction label="Bawa ke depan" hint="Gambar di atas objek lain." icon={ArrowUpToLine} onClick={() => bringToFront(selected.id)} />
          <PopoverAction label="Kirim ke belakang" hint="Gambar di bawah objek lain." icon={ArrowDownToLine} onClick={() => sendToBack(selected.id)} />
        </div>
      </BarPopover>

      <Divider />
      <BarIcon label="Hapus objek terpilih" icon={Trash2} onClick={() => remove(selected.id)} />

      {overflowing ? (
        <Tooltip content="Teks pengganti lebih panjang dari aslinya dan tidak mengalir ke baris berikutnya.">
          <span className="ml-1 shrink-0 rounded-full bg-accent-soft px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-accent">
            meluber
          </span>
        </Tooltip>
      ) : null}
    </div>
  );
}

function PopoverAction({ label, hint, icon: Icon, onClick }: {
  label: string;
  hint: string;
  icon: LucideIcon;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs font-semibold text-ink transition duration-150 hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <Icon className="size-4 shrink-0 text-muted" aria-hidden="true" />
      <span className="min-w-0">
        {label}
        <span className="block text-[11px] font-normal leading-4 text-muted">{hint}</span>
      </span>
    </button>
  );
}
