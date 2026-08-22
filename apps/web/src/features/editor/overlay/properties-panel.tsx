import type { RegisteredFont } from "@pdf-studio/api-client";
import { Card } from "@pdf-studio/ui";
import { fontStack, overflowsCover } from "./geometry";
import { useOverlayStore } from "./store";
import { MAX_TEXT_LENGTH, type OverlayObject, isBox, isPath } from "./types";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-bold uppercase tracking-wide text-muted">
      <span>{label}</span>
      <span className="mt-1 block normal-case">{children}</span>
    </label>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <Field label={label}>
      <span className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-12 cursor-pointer rounded-lg border border-line bg-paper p-1"
          aria-label={label}
        />
        <code className="text-xs text-muted">{value}</code>
      </span>
    </Field>
  );
}

function Slider({ label, value, min, max, step, suffix, onChange }: {
  label: string; value: number; min: number; max: number; step: number; suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={`${label} · ${Math.round(value * 100) / 100}${suffix ?? ""}`}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(event.target.valueAsNumber)}
        className="w-full accent-accent"
      />
    </Field>
  );
}

export function PropertiesPanel({ fonts, fontsAvailable }: { fonts: RegisteredFont[]; fontsAvailable: boolean }) {
  const objects = useOverlayStore((state) => state.objects);
  const selectedId = useOverlayStore((state) => state.selectedId);
  const update = useOverlayStore((state) => state.update);
  const selected = objects.find((object) => object.id === selectedId);

  if (!selected) {
    return (
      <Card className="p-5">
        <h2 className="text-lg font-black text-ink">Properti</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Pilih objek di kanvas untuk mengubah warna, ukuran, dan rotasinya. Dengan tool Pilih, objek juga bisa digeser.
        </p>
      </Card>
    );
  }

  const patch = (values: Partial<OverlayObject>) => update(selected.id, values);
  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-black text-ink">Properti</h2>
        <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-accent">
          {labelFor(selected)}
        </span>
      </div>

      {selected.kind === "text" ? (
        <>
          <Field label="Isi teks">
            <textarea
              className="form-control min-h-20"
              value={selected.text}
              maxLength={MAX_TEXT_LENGTH}
              aria-label="Isi teks"
              onChange={(event) => patch({ text: event.target.value.replace(/[\r\n]+/g, " ") })}
            />
          </Field>
          <p className="-mt-2 text-xs text-muted">
            Satu objek berisi satu baris. Untuk baris kedua, tambahkan objek teks baru.
          </p>
          {overflowsCover(selected.text, selected.fontSize, fontStack(selected.font, fonts), selected.coverWidth) ? (
            <p className="-mt-2 text-xs font-bold text-accent" role="alert">
              Teks ini lebih panjang daripada teks asli yang ditutupinya, dan tidak akan mengalir ke baris berikutnya.
              Perpendek kalimatnya, kecilkan ukurannya, atau terima bahwa ia melewati batas.
            </p>
          ) : null}
          <Field label="Font">
            <select
              className="form-control"
              value={selected.font}
              aria-label="Font"
              onChange={(event) => patch({ font: event.target.value })}
            >
              <option value="">Helvetica bawaan (Latin-1)</option>
              {fonts.map((font) => (
                <option key={font.id} value={font.id}>{font.family}</option>
              ))}
            </select>
          </Field>
          {!fontsAvailable ? (
            <p className="-mt-2 text-xs text-muted">
              Belum ada font terpasang di server, jadi hanya Helvetica bawaan yang tersedia. Karakter di luar Latin-1 akan ditolak.
            </p>
          ) : null}
          <Field label="Perataan">
            <select
              className="form-control"
              value={selected.align}
              aria-label="Perataan"
              onChange={(event) => patch({ align: event.target.value as "left" | "center" | "right" })}
            >
              <option value="left">Kiri</option>
              <option value="center">Tengah</option>
              <option value="right">Kanan</option>
            </select>
          </Field>
          <Slider label="Ukuran" value={selected.fontSize} min={6} max={144} step={1} suffix="pt" onChange={(fontSize) => patch({ fontSize })} />
          <ColorField label="Warna" value={selected.color} onChange={(color) => patch({ color })} />
        </>
      ) : null}

      {isBox(selected) || isPath(selected) ? (
        <>
          <ColorField label="Warna garis" value={selected.stroke} onChange={(stroke) => patch({ stroke })} />
          <Slider label="Tebal garis" value={selected.strokeWidth} min={0} max={24} step={0.5} suffix="pt" onChange={(strokeWidth) => patch({ strokeWidth })} />
        </>
      ) : null}

      {isBox(selected) ? (
        <>
          <Slider label="Lebar" value={selected.width} min={4} max={1200} step={1} suffix="pt" onChange={(width) => patch({ width })} />
          <Slider label="Tinggi" value={selected.height} min={4} max={1200} step={1} suffix="pt" onChange={(height) => patch({ height })} />
          <label className="flex items-center gap-2 text-sm font-semibold text-ink">
            <input
              type="checkbox"
              checked={selected.fill !== null}
              onChange={(event) => patch({ fill: event.target.checked ? "#ffe08a" : null })}
            />
            Beri warna isi
          </label>
          {selected.fill !== null ? (
            <ColorField label="Warna isi" value={selected.fill} onChange={(fill) => patch({ fill })} />
          ) : null}
          {selected.strokeWidth === 0 && selected.fill === null ? (
            <p className="text-xs font-semibold text-accent" role="alert">
              Objek ini tidak akan terlihat. Beri ketebalan garis atau warna isi.
            </p>
          ) : null}
        </>
      ) : null}

      {selected.kind === "image" ? (
        <>
          <Slider label="Lebar" value={selected.width} min={8} max={1200} step={1} suffix="pt" onChange={(width) => patch({ width })} />
          <Slider label="Tinggi" value={selected.height} min={8} max={1200} step={1} suffix="pt" onChange={(height) => patch({ height })} />
        </>
      ) : null}

      <Slider label="Opacity" value={selected.opacity} min={0.05} max={1} step={0.05} onChange={(opacity) => patch({ opacity })} />
      <Slider label="Rotasi" value={selected.rotation} min={-180} max={180} step={1} suffix="°" onChange={(rotation) => patch({ rotation })} />
    </Card>
  );
}

function labelFor(object: OverlayObject): string {
  switch (object.kind) {
    case "text": return "Teks";
    case "rectangle": return "Kotak";
    case "ellipse": return "Elips";
    case "line": return "Garis";
    case "draw": return "Gambar bebas";
    default: return "Gambar";
  }
}
