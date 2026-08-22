import { Button, Tooltip } from "@pdf-studio/ui";
import { Circle, ImagePlus, Minus, MousePointer2, Pencil, Redo2, Square, Trash2, Type, Undo2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useRef } from "react";
import { useOverlayStore } from "./store";
import { MAX_ASSETS, type OverlayTool } from "./types";

const tools: { tool: OverlayTool; label: string; icon: LucideIcon }[] = [
  { tool: "select", label: "Pilih & geser", icon: MousePointer2 },
  { tool: "text", label: "Teks", icon: Type },
  { tool: "rectangle", label: "Kotak", icon: Square },
  { tool: "ellipse", label: "Elips", icon: Circle },
  { tool: "line", label: "Garis", icon: Minus },
  { tool: "draw", label: "Gambar bebas", icon: Pencil },
];

export function EditorToolbar({ onPickImage, disabled }: { onPickImage: (file: File) => void; disabled: boolean }) {
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
    <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-ink bg-paper p-2">
      {tools.map(({ tool: kind, label, icon: Icon }) => (
        <Tooltip key={kind} content={label}>
          <Button
            type="button"
            variant={tool === kind ? "primary" : "ghost"}
            className="px-3"
            aria-pressed={tool === kind}
            aria-label={label}
            disabled={disabled}
            onClick={() => setTool(kind)}
          >
            <Icon className="size-4" />
          </Button>
        </Tooltip>
      ))}

      <Tooltip content={assetCount >= MAX_ASSETS ? `Maksimal ${MAX_ASSETS} gambar` : "Sisipkan JPG"}>
        <span>
          <Button
            type="button"
            variant="ghost"
            className="px-3"
            aria-label="Sisipkan JPG"
            disabled={disabled || assetCount >= MAX_ASSETS}
            onClick={() => fileRef.current?.click()}
          >
            <ImagePlus className="size-4" />
          </Button>
        </span>
      </Tooltip>
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

      <span className="mx-1 h-6 w-px bg-line" aria-hidden="true" />

      <Tooltip content="Urungkan">
        <span>
          <Button type="button" variant="ghost" className="px-3" aria-label="Urungkan" disabled={disabled || past.length === 0} onClick={undo}>
            <Undo2 className="size-4" />
          </Button>
        </span>
      </Tooltip>
      <Tooltip content="Ulangi">
        <span>
          <Button type="button" variant="ghost" className="px-3" aria-label="Ulangi" disabled={disabled || future.length === 0} onClick={redo}>
            <Redo2 className="size-4" />
          </Button>
        </span>
      </Tooltip>
      <Tooltip content="Hapus objek terpilih">
        <span>
          <Button
            type="button"
            variant="ghost"
            className="px-3"
            aria-label="Hapus objek terpilih"
            disabled={disabled || !selectedId}
            onClick={() => selectedId && remove(selectedId)}
          >
            <Trash2 className="size-4" />
          </Button>
        </span>
      </Tooltip>
    </div>
  );
}
