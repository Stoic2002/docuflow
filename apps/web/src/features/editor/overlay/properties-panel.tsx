import type { RegisteredFont } from "@pdf-studio/api-client";
import { ColorInput, Field, PanelSection, RangeInput, SelectInput, TextInput } from "@pdf-studio/ui";
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

function Badge({ children }: { children: string }) {
  return (
    <span className="rounded-full bg-canvas px-2 py-0.5 text-[11px] font-semibold text-muted">{children}</span>
  );
}

export function PropertiesPanel({ fonts, fontsAvailable }: { fonts: RegisteredFont[]; fontsAvailable: boolean }) {
  const objects = useOverlayStore((state) => state.objects);
  const selectedId = useOverlayStore((state) => state.selectedId);
  const update = useOverlayStore((state) => state.update);
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
            <div className="grid grid-cols-2 gap-2.5">
              <FontSizeField value={selected.fontSize} onChange={(fontSize) => patch({ fontSize })} />
              <Field label="Perataan">
                <SelectInput
                  aria-label="Perataan"
                  value={selected.align}
                  onChange={(event) => patch({ align: event.target.value as "left" | "center" | "right" })}
                >
                  <option value="left">Kiri</option>
                  <option value="center">Tengah</option>
                  <option value="right">Kanan</option>
                </SelectInput>
              </Field>
            </div>
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

      <PanelSection title="Tampilan">
        <RangeInput label="Opacity" min={0.05} max={1} step={0.05} value={selected.opacity} onChange={(event) => patch({ opacity: event.currentTarget.valueAsNumber })} />
        <RangeInput label="Rotasi" min={-180} max={180} step={1} suffix="°" value={selected.rotation} onChange={(event) => patch({ rotation: event.currentTarget.valueAsNumber })} />
      </PanelSection>
    </>
  );
}
