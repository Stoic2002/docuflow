import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { DirectSplitResult, DirectToolResult } from "@pdf-studio/api-client";
import { Button, Card, Tooltip } from "@pdf-studio/ui";
import { Download, FileText, GripVertical, RotateCcw, UploadCloud, X } from "lucide-react";
import { useDropzone } from "react-dropzone";
import { formatBytes } from "../../lib/format";

export type SelectedToolFile = { id: string; file: File };

export function ToolDropzone({
  onFiles,
  multiple = false,
  disabled = false,
  disabledReason,
  maxFiles = 1,
  label = "Pilih PDF atau tarik ke sini",
  hint = "Hanya PDF. Original tidak pernah ditimpa.",
  accept = { "application/pdf": [".pdf"] },
  invalidFileMessage = "Pilih file PDF yang valid",
}: {
  onFiles: (files: File[]) => void;
  multiple?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  maxFiles?: number;
  label?: string;
  hint?: string;
  accept?: Record<string, string[]>;
  invalidFileMessage?: string;
}) {
  const dropzone = useDropzone({
    accept,
    multiple,
    maxFiles,
    disabled,
    onDropAccepted: onFiles,
  });
  const surface = (
    <div
      {...dropzone.getRootProps()}
      className={`rounded-[2rem] border-2 border-dashed px-6 py-14 text-center transition focus-within:ring-2 focus-within:ring-accent ${
        disabled
          ? "cursor-not-allowed border-line bg-[#e7e2da] text-[#8b867e]"
          : dropzone.isDragActive
            ? "border-accent bg-accent-soft"
            : "cursor-pointer border-line bg-paper hover:border-accent hover:bg-accent-soft/40"
      }`}
      aria-disabled={disabled}
    >
      <input {...dropzone.getInputProps()} aria-label={label} disabled={disabled} />
      <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-accent-soft text-accent"><UploadCloud className="size-7" aria-hidden="true" /></span>
      <p className="mt-4 text-lg font-black text-ink">{label}</p>
      <p className="mt-1 text-sm">{hint}</p>
      {dropzone.fileRejections.length ? (
        <p className="mt-3 text-sm font-medium text-red-700" role="alert">
          {invalidFileMessage}{multiple ? ` (maksimal ${maxFiles})` : ""}.
        </p>
      ) : null}
    </div>
  );
  return disabled && disabledReason ? <Tooltip content={disabledReason}>{surface}</Tooltip> : surface;
}

function SortableFile({ item, index, onRemove }: { item: SelectedToolFile; index: number; onRemove: () => void }) {
  const sortable = useSortable({ id: item.id });
  return (
    <li
      ref={sortable.setNodeRef}
      style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}
      className="flex items-center gap-3 rounded-2xl border border-line bg-paper p-3"
    >
      <button
        type="button"
        className="touch-none rounded-full p-1 text-muted hover:bg-accent-soft hover:text-accent focus-visible:ring-2 focus-visible:ring-accent"
        aria-label={`Ubah urutan ${item.file.name}`}
        {...sortable.attributes}
        {...sortable.listeners}
      >
        <GripVertical className="size-5" />
      </button>
      <span className="flex size-8 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent">
        {index + 1}
      </span>
      <FileText className="size-5 text-muted" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">{item.file.name}</p>
        <p className="text-xs text-muted">{formatBytes(item.file.size)}</p>
      </div>
      <button
        type="button"
        className="rounded-full p-2 text-muted hover:bg-accent-soft hover:text-accent focus-visible:ring-2 focus-visible:ring-accent"
        onClick={onRemove}
        aria-label={`Hapus ${item.file.name}`}
      >
        <X className="size-4" />
      </button>
    </li>
  );
}

export function SelectedFileList({
  items,
  onRemove,
  onReorder,
  ariaLabel = "PDF terpilih",
}: {
  items: SelectedToolFile[];
  onRemove: (id: string) => void;
  onReorder?: (items: SelectedToolFile[]) => void;
  ariaLabel?: string;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const endDrag = (event: DragEndEvent) => {
    if (!onReorder || !event.over || event.active.id === event.over.id) return;
    const oldIndex = items.findIndex((item) => item.id === event.active.id);
    const newIndex = items.findIndex((item) => item.id === event.over?.id);
    onReorder(arrayMove(items, oldIndex, newIndex));
  };
  if (!items.length) return null;
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={endDrag}>
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <ol className="space-y-2" aria-label={ariaLabel}>
          {items.map((item, index) => (
            <SortableFile key={item.id} item={item} index={index} onRemove={() => onRemove(item.id)} />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

export function ProcessingState({ label = "Memproses PDF…" }: { label?: string }) {
  return (
    <Card className="border-ink bg-paper p-5" role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        <span className="size-5 animate-spin rounded-full border-2 border-accent-soft border-t-accent" />
        <div>
          <p className="font-semibold text-ink">{label}</p>
          <p className="text-sm text-muted">Jangan tutup halaman ini. Original tetap aman.</p>
        </div>
      </div>
    </Card>
  );
}

export function CapabilityNotice({ title = "Capability unavailable", reason }: { title?: string; reason: string }) {
  return (
    <Card className="border-accent/40 bg-accent-soft p-5 text-sm text-ink" role="status">
      <p className="font-bold text-accent">{title}</p>
      <p className="mt-1">{reason}</p>
    </Card>
  );
}

export function StartOverButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="secondary" onClick={onClick}>
      <RotateCcw className="size-4" aria-hidden="true" /> Mulai lagi
    </Button>
  );
}

export function ToolResultCard({ result, onStartOver }: { result: DirectToolResult; onStartOver: () => void }) {
  const saved = result.beforeBytes > 0 ? Math.max(0, result.beforeBytes - result.afterBytes) : 0;
  return (
    <Card className="border-ink bg-paper p-6 shadow-[6px_6px_0_#ff2d2d]" role="status">
      <p className="eyebrow">Selesai</p>
      <h2 className="font-display mt-2 text-3xl font-medium text-ink">Output PDF siap</h2>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <div><dt className="text-muted">Sebelum</dt><dd className="font-bold text-ink">{formatBytes(result.beforeBytes)}</dd></div>
        <div><dt className="text-muted">Sesudah</dt><dd className="font-bold text-ink">{formatBytes(result.afterBytes)}</dd></div>
        <div><dt className="text-muted">Selisih</dt><dd className="font-bold text-ink">{formatBytes(saved)}</dd></div>
      </dl>
      <div className="mt-5 flex flex-wrap gap-3">
        <Button asChild><a href={result.downloadUrl} download><Download className="size-4" /> Unduh hasil</a></Button>
        <StartOverButton onClick={onStartOver} />
      </div>
    </Card>
  );
}

export function SplitResultCard({ result, onStartOver }: { result: DirectSplitResult; onStartOver: () => void }) {
  return (
    <Card className="border-ink bg-paper p-6 shadow-[6px_6px_0_#ff2d2d]" role="status">
      <p className="eyebrow">Selesai</p>
      <h2 className="font-display mt-2 text-3xl font-medium text-ink">{result.results.length} output PDF siap</h2>
      <ul className="mt-5 space-y-3" aria-label="Hasil Split PDF">
        {result.results.map((item) => (
          <li key={item.version.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-canvas p-3">
            <div>
              <p className="font-semibold text-ink">{item.outputName ?? item.document.originalName}</p>
              <p className="text-xs text-muted">Halaman {String(item.version.metadata.page ?? item.version.metadata.ranges ?? "—")} · {formatBytes(item.afterBytes)}</p>
            </div>
            <Button asChild>
              <a href={item.downloadUrl} download={item.outputName ?? `split-${item.document.originalName}`}>
                <Download className="size-4" /> Unduh
              </a>
            </Button>
          </li>
        ))}
      </ul>
      <div className="mt-5"><StartOverButton onClick={onStartOver} /></div>
    </Card>
  );
}
