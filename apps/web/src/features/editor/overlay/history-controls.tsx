import { IconButton, Tooltip } from "@pdf-studio/ui";
import { Redo2, Undo2 } from "lucide-react";
import { useOverlayStore } from "./store";

/**
 * Undo and redo belong to the document, not to the drawing tools, so they sit
 * in the header beside Save rather than on the tool rail. Each is dead until
 * there is something to undo or redo — on a freshly opened file, both are.
 */
export function HistoryControls({ disabled = false }: { disabled?: boolean }) {
  const undo = useOverlayStore((state) => state.undo);
  const redo = useOverlayStore((state) => state.redo);
  const past = useOverlayStore((state) => state.past);
  const future = useOverlayStore((state) => state.future);

  return (
    <div className="flex items-center gap-1 rounded-2xl border border-line bg-paper px-1 py-1">
      <Tooltip content={<span><b>Urungkan</b><br />Ctrl/Cmd + Z</span>}>
        <span>
          <IconButton
            size="sm"
            className="border-transparent bg-transparent"
            aria-label="Urungkan"
            disabled={disabled || past.length === 0}
            onClick={undo}
          >
            <Undo2 className="size-4" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip content={<span><b>Ulangi</b><br />Ctrl/Cmd + Shift + Z</span>}>
        <span>
          <IconButton
            size="sm"
            className="border-transparent bg-transparent"
            aria-label="Ulangi"
            disabled={disabled || future.length === 0}
            onClick={redo}
          >
            <Redo2 className="size-4" />
          </IconButton>
        </span>
      </Tooltip>
    </div>
  );
}
