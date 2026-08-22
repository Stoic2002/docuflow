import { IconButton, Tooltip } from "@pdf-studio/ui";
import {
  Circle, Hand, Highlighter, ImagePlus, Minus, MousePointer2,
  Pencil, Redo2, Square, Trash2, Type, Undo2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useRef } from "react";
import { useOverlayStore } from "./store";
import { MAX_ASSETS, type OverlayTool } from "./types";

const groups: { tool: OverlayTool; label: string; hint: string; icon: LucideIcon }[][] = [
  [
    { tool: "select", label: "Pilih", hint: "Klik elemen apa pun di halaman untuk mengambil alih dan mengeditnya. Tarik area kosong untuk menggeser halaman.", icon: MousePointer2 },
    { tool: "hand", label: "Geser halaman", hint: "Tarik untuk menggeser. Menahan Spasi memberi efek yang sama dari tool mana pun.", icon: Hand },
  ],
  [
    { tool: "text", label: "Teks", hint: "Klik di halaman untuk menaruh teks baru, lalu langsung ketik.", icon: Type },
    { tool: "rectangle", label: "Kotak", hint: "Tarik untuk menggambar kotak.", icon: Square },
    { tool: "ellipse", label: "Elips", hint: "Tarik untuk menggambar elips.", icon: Circle },
    { tool: "line", label: "Garis", hint: "Tarik untuk menggambar garis lurus.", icon: Minus },
    { tool: "draw", label: "Coret bebas", hint: "Tarik untuk mencoret dengan tangan bebas.", icon: Pencil },
  ],
];

function ToolButton({ active, label, hint, icon: Icon, disabled, onClick }: {
  active: boolean; label: string; hint: string; icon: LucideIcon; disabled: boolean; onClick: () => void;
}) {
  return (
    <Tooltip content={<span><b>{label}</b><br />{hint}</span>}>
      <span>
        <IconButton active={active} aria-label={label} disabled={disabled} onClick={onClick}>
          <Icon className="size-[18px]" />
        </IconButton>
      </span>
    </Tooltip>
  );
}

function Divider() {
  return <span className="mx-1 h-7 w-px shrink-0 bg-line" aria-hidden="true" />;
}

export function EditorToolbar({ onPickImage, disabled, showHints, onToggleHints }: {
  onPickImage: (file: File) => void;
  disabled: boolean;
  showHints: boolean;
  onToggleHints: (next: boolean) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const tool = useOverlayStore((state) => state.tool);
  const setTool = useOverlayStore((state) => state.setTool);
  const undo = useOverlayStore((state) => state.undo);
  const redo = useOverlayStore((state) => state.redo);
  const remove = useOverlayStore((state) => state.remove);
  const past = useOverlayStore((state) => state.past);
  const future = useOverlayStore((state) => state.future);
  const selectedId = useOverlayStore((state) => state.selectedId);
  const assetCount = useOverlayStore((state) => Object.keys(state.assets).length);

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-2xl border border-ink bg-paper px-2 py-1.5 shadow-[0_2px_10px_rgba(0,0,0,.06)]">
      {groups.map((group, index) => (
        <span key={index} className="flex items-center gap-1">
          {index > 0 ? <Divider /> : null}
          {group.map(({ tool: kind, label, hint, icon }) => (
            <ToolButton
              key={kind}
              active={tool === kind}
              label={label}
              hint={hint}
              icon={icon}
              disabled={disabled}
              onClick={() => setTool(kind)}
            />
          ))}
        </span>
      ))}

      <ToolButton
        active={false}
        label="Sisipkan JPG"
        hint={assetCount >= MAX_ASSETS ? `Maksimal ${MAX_ASSETS} gambar per dokumen.` : "Pilih file JPG untuk ditaruh di tengah halaman."}
        icon={ImagePlus}
        disabled={disabled || assetCount >= MAX_ASSETS}
        onClick={() => fileRef.current?.click()}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,.jpg,.jpeg"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onPickImage(file);
          event.target.value = "";
        }}
      />

      <Divider />

      <ToolButton active={false} label="Urungkan" hint="Ctrl/Cmd + Z" icon={Undo2} disabled={disabled || past.length === 0} onClick={undo} />
      <ToolButton active={false} label="Ulangi" hint="Ctrl/Cmd + Shift + Z" icon={Redo2} disabled={disabled || future.length === 0} onClick={redo} />
      <ToolButton
        active={false}
        label="Hapus objek terpilih"
        hint="Delete"
        icon={Trash2}
        disabled={disabled || !selectedId}
        onClick={() => selectedId && remove(selectedId)}
      />

      <Divider />

      <ToolButton
        active={showHints}
        label="Sorot elemen asli"
        hint="Tandai semua teks dan garis di halaman yang bisa diambil alih. Tanpa ini, sorotan hanya muncul saat kursor melewatinya."
        icon={Highlighter}
        disabled={disabled}
        onClick={() => onToggleHints(!showHints)}
      />
    </div>
  );
}
