import type { RegisteredFont } from "@pdf-studio/api-client";
import { ColorInput, Field, IconButton, PanelSection, RangeInput, SelectInput, TextInput, ToggleGroup, Tooltip } from "@pdf-studio/ui";
import {
  AlignCenter, AlignLeft, AlignRight, ArrowDownToLine, ArrowUpToLine,
  Bold, Copy, Italic, Strikethrough, Underline,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { fontStack, overflowsCover } from "./geometry";
import { useOverlayStore } from "./store";
import { MAX_TEXT_LENGTH, type OverlayObject, isBox, isPath } from "./types";

/** The sizes a document actually uses, so the common case is one click. */
const FONT_SIZES = [6, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72, 96, 120, 144];

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function FontSizeField({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  // Text taken over from the page keeps its original size, which is rarely a
  // round number, so that exact value joins the standard list.
  const current = round(value);
  const options = FONT_SIZES.includes(current) ? FONT_SIZES : [...FONT_SIZES, current].sort((a, b) => a - b);
  return (
    <Field label="Ukuran">
      <SelectInput aria-label="Ukuran teks" value={String(current)} onChange={(event) => onChange(Number(event.target.value))}>
        {options.map((size) => (
          <option key={size} value={String(size)}>{size} pt</option>
        ))}
      </SelectInput>
    </Field>
  );
}

function labelFor(object: OverlayObject): string {
  switch (object.kind) {
    case "text": return "Teks";
    case "rectangle": return "Kotak";
    case "ellipse": return "Elips";
    case "line": return "Garis";
    case "draw": return "Coret bebas";
    default: return "Gambar";
  }
}

function Toggle({ label, hint, icon: Icon, active, onClick }: {
  label: string;
  hint?: string;
  icon: LucideIcon;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip content={hint ? <span><b>{label}</b><br />{hint}</span> : label}>
      <span>
        <IconButton size="sm" active={active} aria-label={label} onClick={onClick}>
          <Icon className="size-4" />
        </IconButton>
      </span>
    </Tooltip>
  );
}

function Badge({ children }: { children: string }) {
  return (
    <span className="rounded-full bg-canvas px-2 py-0.5 text-[11px] font-semibold text-muted">{children}</span>
  );
}

export function PropertiesPanel({ fonts, fontsAvailable }: { fonts: RegisteredFont[]; fontsAvailable: boolean }) {
  const objects = useOverlayStore((state) => state.objects);
  const selectedId = useOverlayStore((state) => state.selectedId);
  const update = useOverlayStore((state) => state.update);
  const duplicate = useOverlayStore((state) => state.duplicate);
  const bringToFront = useOverlayStore((state) => state.bringToFront);
  const sendToBack = useOverlayStore((state) => state.sendToBack);
  const selected = objects.find((object) => object.id === selectedId);

  if (!selected) {
    return (
      <PanelSection title="Properti">
        <p className="text-xs leading-5 text-muted">
          Belum ada yang dipilih. Klik teks atau garis di halaman untuk mengambil alih dan mengeditnya.
        </p>
      </PanelSection>
    );
  }

  const patch = (values: Partial<OverlayObject>) => update(selected.id, values);
  return (
    <>
      <PanelSection title="Properti" aside={<Badge>{labelFor(selected)}</Badge>}>
        {selected.kind === "text" ? (
          <>
            <Field label="Isi teks" hint="Klik dua kali di kanvas untuk mengetik langsung di sana.">
              <TextInput
                value={selected.text}
                maxLength={MAX_TEXT_LENGTH}
                aria-label="Isi teks"
                onChange={(event) => patch({ text: event.target.value.replace(/[\r\n]+/g, " ") })}
              />
            </Field>
            {overflowsCover(selected.text, selected.fontSize, fontStack(selected.font, fonts), selected.coverWidth) ? (
              <p className="rounded-lg bg-accent-soft px-2.5 py-2 text-[11px] font-semibold leading-4 text-accent" role="alert">
                Lebih panjang dari teks aslinya dan tidak mengalir ke baris berikutnya.
              </p>
            ) : null}
            <Field
              label="Font"
              hint={fontsAvailable ? undefined : (
                <>Belum ada <code className="font-mono">.ttf</code> di <code className="font-mono">assets/fonts/</code> pada server.</>
              )}
            >
              <SelectInput aria-label="Font" value={selected.font} onChange={(event) => patch({ font: event.target.value })}>
                <option value="">Helvetica bawaan</option>
                {fonts.map((font) => (
                  <option key={font.id} value={font.id}>{font.family}</option>
                ))}
              </SelectInput>
            </Field>
            <FontSizeField value={selected.fontSize} onChange={(fontSize) => patch({ fontSize })} />
            <ToggleGroup label="Gaya">
              <Toggle label="Tebal" hint="Ditebalkan secara sintetis, bukan diganti dengan font bold sungguhan." icon={Bold} active={Boolean(selected.bold)} onClick={() => patch({ bold: !selected.bold })} />
              <Toggle label="Miring" hint="Dimiringkan secara sintetis, bukan diganti dengan font italic sungguhan." icon={Italic} active={Boolean(selected.italic)} onClick={() => patch({ italic: !selected.italic })} />
              <Toggle label="Garis bawah" icon={Underline} active={Boolean(selected.underline)} onClick={() => patch({ underline: !selected.underline })} />
              <Toggle label="Coret" icon={Strikethrough} active={Boolean(selected.strikethrough)} onClick={() => patch({ strikethrough: !selected.strikethrough })} />
            </ToggleGroup>
            <ToggleGroup label="Perataan">
              <Toggle label="Rata kiri" icon={AlignLeft} active={selected.align === "left"} onClick={() => patch({ align: "left" })} />
              <Toggle label="Rata tengah" icon={AlignCenter} active={selected.align === "center"} onClick={() => patch({ align: "center" })} />
              <Toggle label="Rata kanan" icon={AlignRight} active={selected.align === "right"} onClick={() => patch({ align: "right" })} />
            </ToggleGroup>
            <Field label="Warna teks">
              <ColorInput label="Warna teks" value={selected.color} onChange={(color) => patch({ color })} />
            </Field>
          </>
        ) : null}

        {isBox(selected) || isPath(selected) ? (
          <>
            <Field label="Warna garis">
              <ColorInput label="Warna garis" value={selected.stroke} onChange={(stroke) => patch({ stroke })} />
            </Field>
            {isPath(selected) ? (
              <label className="flex items-center gap-2 text-xs font-semibold text-ink">
                <input
                  type="checkbox"
                  className="size-4 accent-accent"
                  checked={Boolean(selected.arrow)}
                  onChange={(event) => patch({ arrow: event.target.checked })}
                />
                Beri mata panah di ujung
              </label>
            ) : null}
            <RangeInput
              label="Tebal garis"
              min={0}
              max={24}
              step={0.5}
              suffix=" pt"
              value={selected.strokeWidth}
              onChange={(event) => patch({ strokeWidth: event.currentTarget.valueAsNumber })}
            />
          </>
        ) : null}

        {isBox(selected) ? (
          <>
            <label className="flex items-center gap-2 text-xs font-semibold text-ink">
              <input
                type="checkbox"
                className="size-4 accent-accent"
                checked={selected.fill !== null}
                onChange={(event) => patch({ fill: event.target.checked ? "#ffe08a" : null })}
              />
              Beri warna isi
            </label>
            {selected.fill !== null ? (
              <ColorInput label="Warna isi" value={selected.fill} onChange={(fill) => patch({ fill })} />
            ) : null}
            {selected.strokeWidth === 0 && selected.fill === null ? (
              <p className="rounded-lg bg-accent-soft px-2.5 py-2 text-[11px] font-semibold leading-4 text-accent" role="alert">
                Objek ini tidak akan terlihat. Beri ketebalan garis atau warna isi.
              </p>
            ) : null}
          </>
        ) : null}
      </PanelSection>

      {isBox(selected) || selected.kind === "image" ? (
        <PanelSection title="Ukuran">
          <RangeInput label="Lebar" min={4} max={1200} step={1} suffix=" pt" value={selected.width} onChange={(event) => patch({ width: event.currentTarget.valueAsNumber })} />
          <RangeInput label="Tinggi" min={4} max={1200} step={1} suffix=" pt" value={selected.height} onChange={(event) => patch({ height: event.currentTarget.valueAsNumber })} />
        </PanelSection>
      ) : null}

      <PanelSection title="Susunan">
        <div className="flex items-center gap-1">
          <Toggle label="Duplikat" hint="Salin objek ini sedikit bergeser." icon={Copy} active={false} onClick={() => duplicate(selected.id)} />
          <Toggle label="Bawa ke depan" hint="Gambar di atas objek lain." icon={ArrowUpToLine} active={false} onClick={() => bringToFront(selected.id)} />
          <Toggle label="Kirim ke belakang" hint="Gambar di bawah objek lain. Berguna untuk penutup teks." icon={ArrowDownToLine} active={false} onClick={() => sendToBack(selected.id)} />
        </div>
      </PanelSection>

      <PanelSection title="Tampilan">
        <RangeInput label="Opacity" min={0.05} max={1} step={0.05} value={selected.opacity} onChange={(event) => patch({ opacity: event.currentTarget.valueAsNumber })} />
        <RangeInput label="Rotasi" min={-180} max={180} step={1} suffix="°" value={selected.rotation} onChange={(event) => patch({ rotation: event.currentTarget.valueAsNumber })} />
      </PanelSection>
    </>
  );
}
