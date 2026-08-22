import type { RegisteredFont } from "@pdf-studio/api-client";
import { Card, ColorInput, Field, RangeInput, SelectInput, TextInput } from "@pdf-studio/ui";
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
    <Field label="Ukuran teks">
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

export function PropertiesPanel({ fonts, fontsAvailable }: { fonts: RegisteredFont[]; fontsAvailable: boolean }) {
  const objects = useOverlayStore((state) => state.objects);
  const selectedId = useOverlayStore((state) => state.selectedId);
  const update = useOverlayStore((state) => state.update);
  const selected = objects.find((object) => object.id === selectedId);

  if (!selected) {
    return (
      <Card className="p-4">
        <h2 className="text-sm font-black text-ink">Properti</h2>
        <p className="mt-1.5 text-xs leading-5 text-muted">
          Pilih objek di kanvas untuk mengubah warna, ukuran, dan rotasinya.
        </p>
      </Card>
    );
  }

  const patch = (values: Partial<OverlayObject>) => update(selected.id, values);
  return (
    <Card className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-black text-ink">Properti</h2>
        <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-accent">
          {labelFor(selected)}
        </span>
      </div>

      {selected.kind === "text" ? (
        <>
          <Field label="Isi teks" hint="Satu objek berisi satu baris. Klik dua kali di kanvas untuk mengetik langsung di sana.">
            <TextInput
              value={selected.text}
              maxLength={MAX_TEXT_LENGTH}
              aria-label="Isi teks"
              onChange={(event) => patch({ text: event.target.value.replace(/[\r\n]+/g, " ") })}
            />
          </Field>
          {overflowsCover(selected.text, selected.fontSize, fontStack(selected.font, fonts), selected.coverWidth) ? (
            <p className="text-xs font-bold leading-5 text-accent" role="alert">
              Teks ini lebih panjang daripada teks asli yang ditutupinya, dan tidak akan mengalir ke baris berikutnya.
            </p>
          ) : null}
          <Field
            label="Font"
            hint={fontsAvailable ? undefined : (
              <>
                Daftar kosong karena <code className="font-mono">assets/fonts/</code> di server belum berisi <code className="font-mono">.ttf</code>.
                Tambahkan font berlisensi OFL atau Apache lalu jalankan ulang API.
              </>
            )}
          >
            <SelectInput aria-label="Font" value={selected.font} onChange={(event) => patch({ font: event.target.value })}>
              <option value="">Helvetica bawaan (Latin-1)</option>
              {fonts.map((font) => (
                <option key={font.id} value={font.id}>{font.family}</option>
              ))}
            </SelectInput>
          </Field>
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
          <FontSizeField value={selected.fontSize} onChange={(fontSize) => patch({ fontSize })} />
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
            suffix="pt"
            value={selected.strokeWidth}
            onChange={(event) => patch({ strokeWidth: event.currentTarget.valueAsNumber })}
          />
        </>
      ) : null}

      {isBox(selected) ? (
        <>
          <RangeInput label="Lebar" min={4} max={1200} step={1} suffix="pt" value={selected.width} onChange={(event) => patch({ width: event.currentTarget.valueAsNumber })} />
          <RangeInput label="Tinggi" min={4} max={1200} step={1} suffix="pt" value={selected.height} onChange={(event) => patch({ height: event.currentTarget.valueAsNumber })} />
          <label className="flex items-center gap-2 text-sm font-semibold text-ink">
            <input
              type="checkbox"
              className="size-4 accent-accent"
              checked={selected.fill !== null}
              onChange={(event) => patch({ fill: event.target.checked ? "#ffe08a" : null })}
            />
            Beri warna isi
          </label>
          {selected.fill !== null ? (
            <Field label="Warna isi">
              <ColorInput label="Warna isi" value={selected.fill} onChange={(fill) => patch({ fill })} />
            </Field>
          ) : null}
          {selected.strokeWidth === 0 && selected.fill === null ? (
            <p className="text-xs font-bold text-accent" role="alert">
              Objek ini tidak akan terlihat. Beri ketebalan garis atau warna isi.
            </p>
          ) : null}
        </>
      ) : null}

      {selected.kind === "image" ? (
        <>
          <RangeInput label="Lebar" min={8} max={1200} step={1} suffix="pt" value={selected.width} onChange={(event) => patch({ width: event.currentTarget.valueAsNumber })} />
          <RangeInput label="Tinggi" min={8} max={1200} step={1} suffix="pt" value={selected.height} onChange={(event) => patch({ height: event.currentTarget.valueAsNumber })} />
        </>
      ) : null}

      <RangeInput label="Opacity" min={0.05} max={1} step={0.05} value={selected.opacity} onChange={(event) => patch({ opacity: event.currentTarget.valueAsNumber })} />
      <RangeInput label="Rotasi" min={-180} max={180} step={1} suffix="°" value={selected.rotation} onChange={(event) => patch({ rotation: event.currentTarget.valueAsNumber })} />
    </Card>
  );
}
