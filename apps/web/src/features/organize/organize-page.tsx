import { api, userFacingError } from "@pdf-studio/api-client";
import { Button, Card, ConfirmDialog } from "@pdf-studio/ui";
import { DndContext, type DragEndEvent, closestCenter } from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, Copy, Download, GripVertical, Plus, RotateCcw, RotateCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { capabilitiesQuery, documentQuery, documentsQuery, queryKeys } from "../../api/queries";
import { ErrorState, LoadingState } from "../../components/async-state";

function SortablePage({ documentId, id, page, selected, thumbnails, onSelect, onMove }: { documentId: string; id: string; page: number; selected: boolean; thumbnails: boolean; onSelect: () => void; onMove: (offset: number) => void }) {
  const sortable = useSortable({ id });
  return (
    <div ref={sortable.setNodeRef} style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }} className={`flex min-h-40 items-center gap-3 rounded-2xl border bg-paper p-3 ${selected ? "border-accent ring-2 ring-accent/25" : "border-line"}`}>
      <button type="button" className="cursor-grab rounded-full p-1 focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing" {...sortable.attributes} {...sortable.listeners} aria-label={`Drag page ${page}`}><GripVertical className="size-5 text-muted" /></button>
      <button type="button" onClick={onSelect} aria-pressed={selected} className="flex min-w-28 items-center gap-4 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:min-w-56">
        <span className="relative flex h-32 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-white shadow-sm">
          {thumbnails ? <img src={api.thumbnailUrl(documentId, page)} loading="lazy" alt={`Thumbnail page ${page}`} className="h-full w-full object-contain" /> : <span className="text-2xl font-black text-accent">{page}</span>}
          <span className="absolute bottom-1 right-1 rounded bg-ink/80 px-1.5 py-0.5 text-[10px] font-bold text-white">{page}</span>
        </span>
        <span><strong className="block text-ink">Page {page}</strong><span className="mt-1 block text-xs text-muted">{selected ? "Selected" : "Click to select"}</span></span>
      </button>
      <div className="ml-auto flex flex-col gap-1" aria-label={`Move page ${page} without dragging`}><button type="button" onClick={() => onMove(-1)} className="rounded-lg p-2 hover:bg-accent-soft" aria-label={`Move page ${page} up`}><ArrowUp className="size-4" /></button><button type="button" onClick={() => onMove(1)} className="rounded-lg p-2 hover:bg-accent-soft" aria-label={`Move page ${page} down`}><ArrowDown className="size-4" /></button></div>
    </div>
  );
}

export function OrganizePage({ documentId }: { documentId: string }) {
  const document = useQuery(documentQuery(documentId));
  const documents = useQuery(documentsQuery);
  const capabilities = useQuery(capabilitiesQuery);
  const signature = useQuery({ queryKey: ["documents", documentId, "metadata"], queryFn: ({ signal }) => api.metadata(documentId, signal) });
  const queryClient = useQueryClient();
  const [order, setOrder] = useState<number[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sourceDocumentId, setSourceDocumentId] = useState("");
  const [position, setPosition] = useState("end");
  const [anchorPage, setAnchorPage] = useState(1);
  const [blankSize, setBlankSize] = useState("same");
  const [orientation, setOrientation] = useState("portrait");
  const [confirmSignatures, setConfirmSignatures] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageCount = document.data?.document.pageCount ?? 0;
  useEffect(() => { setOrder(Array.from({ length: pageCount }, (_, index) => index + 1)); setSelected(new Set()); }, [pageCount]);
  const ids = useMemo(() => order.map((page) => `page-${page}`), [order]);
  const virtualizer = useVirtualizer({ count: order.length, getScrollElement: () => scrollRef.current, estimateSize: () => 172, overscan: 4 });
  const invalidate = async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: queryKeys.document(documentId) }), queryClient.invalidateQueries({ queryKey: queryKeys.versions(documentId) }), queryClient.invalidateQueries({ queryKey: queryKeys.documents })]); };
  const mutation = useMutation({ mutationFn: ({ operation, payload }: { operation: string; payload: Record<string, unknown> }) => api.process(operation, { documentId, confirmSignatures, ...payload }), onSuccess: async () => { setSelected(new Set()); await invalidate(); } });
  const saveOrder = useMutation({ mutationFn: () => api.process("reorder", { documentId, pageOrder: order, confirmSignatures }), onSuccess: invalidate });
  const pages = Array.from(selected).sort((a, b) => a - b);
  const toggle = (page: number) => setSelected((current) => { const next = new Set(current); if (next.has(page)) next.delete(page); else next.add(page); return next; });
  const move = (page: number, offset: number) => setOrder((current) => { const from = current.indexOf(page); const to = Math.max(0, Math.min(current.length - 1, from + offset)); return arrayMove(current, from, to); });
  const onDragEnd = ({ active, over }: DragEndEvent) => { if (!over || active.id === over.id) return; setOrder((current) => arrayMove(current, current.indexOf(Number(String(active.id).replace("page-", ""))), current.indexOf(Number(String(over.id).replace("page-", ""))))); };
  if (document.isPending || documents.isPending || capabilities.isPending) return <LoadingState />;
  if (document.isError) return <ErrorState error={document.error} />;
  if (documents.isError) return <ErrorState error={documents.error} />;
  if (capabilities.isError) return <ErrorState error={capabilities.error} />;
  const available = capabilities.data.features.organize;
  const signatureBlocked = Boolean(signature.data?.information.signed && !confirmSignatures);
  const unavailableReason = capabilities.data.tools.qpdf.reason ?? "The backend PDF engine is unavailable.";
  const busy = mutation.isPending || saveOrder.isPending;
  const otherDocuments = documents.data.documents.filter((item) => item.id !== documentId);
  return (
    <main className="page-shell py-10">
      <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow">Organize PDF</p><h1 className="font-display mt-2 text-4xl font-medium text-ink">{document.data.document.originalName}</h1><p className="mt-2 text-sm text-muted">Select pages, make structural changes, then save drag order as a new version. The original stays unchanged.</p></div><div className="flex gap-2"><Button type="button" variant="secondary" onClick={() => { setOrder(Array.from({ length: pageCount }, (_, index) => index + 1)); setSelected(new Set()); }} disabled={busy}>Cancel</Button><Button type="button" onClick={() => saveOrder.mutate()} disabled={!available || busy || order.length === 0 || signatureBlocked}>{saveOrder.isPending ? "Saving…" : "Save changes"}</Button></div></header>
      {!available ? <Card className="mt-6 border-accent/40 bg-accent-soft p-5"><strong>Capability unavailable</strong><p className="mt-1 text-sm text-muted">{unavailableReason}</p></Card> : null}
      {signature.data?.information.signed ? <label className="mt-6 flex gap-3 rounded-2xl border border-amber-400 bg-amber-50 p-4 text-sm leading-6"><input type="checkbox" checked={confirmSignatures} onChange={(event) => setConfirmSignatures(event.target.checked)} /><span><strong className="block">This PDF contains digital signatures.</strong>Organizing pages may invalidate them. Check to confirm before modifying the document.</span></label> : null}
      <Card className="sticky top-24 z-20 mt-6 flex flex-wrap items-center gap-2 border-ink p-3">
        <Button type="button" variant="ghost" onClick={() => setSelected(new Set(order))} disabled={busy}>Select all</Button><Button type="button" variant="ghost" onClick={() => setSelected(new Set())} disabled={busy || selected.size === 0}>Clear</Button><span className="mr-auto text-sm font-semibold text-muted">{selected.size} selected</span>
        <Button type="button" variant="secondary" onClick={() => mutation.mutate({ operation: "rotate", payload: { pages, degrees: -90 } })} disabled={!available || busy || !pages.length || Boolean(signature.data?.information.signed && !confirmSignatures)}><RotateCcw className="size-4" /> Left</Button>
        <Button type="button" variant="secondary" onClick={() => mutation.mutate({ operation: "rotate", payload: { pages, degrees: 90 } })} disabled={!available || busy || !pages.length || signatureBlocked}><RotateCw className="size-4" /> Right</Button>
        <Button type="button" variant="secondary" onClick={() => mutation.mutate({ operation: "duplicate-pages", payload: { pages } })} disabled={!available || busy || !pages.length || signatureBlocked}><Copy className="size-4" /> Duplicate</Button>
        <Button type="button" variant="secondary" onClick={() => mutation.mutate({ operation: "extract", payload: { ranges: pages.join(",") } })} disabled={!available || busy || !pages.length || signatureBlocked}><Download className="size-4" /> Extract</Button>
        <Button type="button" variant="danger" onClick={() => setConfirmDelete(true)} disabled={!available || busy || !pages.length || pages.length === pageCount || signatureBlocked}><Trash2 className="size-4" /> Delete</Button>
      </Card>
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd}><SortableContext items={ids} strategy={verticalListSortingStrategy}><div ref={scrollRef} className="h-[68vh] overflow-auto rounded-[1.75rem] border border-ink bg-canvas p-3"><div className="relative" style={{ height: virtualizer.getTotalSize() }}>{virtualizer.getVirtualItems().map((virtual) => { const page = order[virtual.index]; return <div key={page} className="absolute left-0 top-0 w-full pb-3" style={{ transform: `translateY(${virtual.start}px)` }}><SortablePage documentId={documentId} id={`page-${page}`} page={page} selected={selected.has(page)} thumbnails={capabilities.data.features.thumbnails} onSelect={() => toggle(page)} onMove={(offset) => move(page, offset)} /></div>; })}</div></div></SortableContext></DndContext>
        <aside className="space-y-4"><Card className="p-5"><h2 className="text-lg font-black">Insert another PDF</h2><label className="mt-4 block text-sm font-bold" htmlFor="source-document">Source document</label><select id="source-document" className="form-control mt-1" value={sourceDocumentId} onChange={(event) => setSourceDocumentId(event.target.value)}><option value="">Choose a recent PDF</option>{otherDocuments.map((item) => <option key={item.id} value={item.id}>{item.originalName}</option>)}</select><label className="mt-3 block text-sm font-bold" htmlFor="insert-position">Placement</label><select id="insert-position" className="form-control mt-1" value={position} onChange={(event) => setPosition(event.target.value)}><option value="beginning">At beginning</option><option value="end">At end</option><option value="before">Before page</option><option value="after">After page</option></select>{position === "before" || position === "after" ? <input aria-label="Anchor page" className="form-control mt-2" type="number" min={1} max={pageCount} value={anchorPage} onChange={(event) => setAnchorPage(event.target.valueAsNumber)} /> : null}<Button type="button" className="mt-4 w-full" onClick={() => mutation.mutate({ operation: "insert-pages", payload: { sourceDocumentId, position, page: anchorPage } })} disabled={!sourceDocumentId || busy || signatureBlocked}><Plus className="size-4" /> Insert PDF</Button></Card>
          <Card className="p-5"><h2 className="text-lg font-black">Insert blank page</h2><label className="mt-4 block text-sm font-bold" htmlFor="blank-size">Page size</label><select id="blank-size" className="form-control mt-1" value={blankSize} onChange={(event) => setBlankSize(event.target.value)}><option value="same">Same as neighboring page</option><option value="a4">A4</option><option value="letter">Letter</option></select><label className="mt-3 block text-sm font-bold" htmlFor="blank-orientation">Orientation</label><select id="blank-orientation" className="form-control mt-1" value={orientation} onChange={(event) => setOrientation(event.target.value)} disabled={blankSize === "same"}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select><Button type="button" className="mt-4 w-full" onClick={() => mutation.mutate({ operation: "insert-blank-page", payload: { position, page: anchorPage, pageSize: blankSize, orientation } })} disabled={busy || signatureBlocked}><Plus className="size-4" /> Insert blank</Button></Card></aside>
      </div>
      {busy ? <p className="mt-4 text-sm font-semibold text-muted" role="status">Processing and saving a new version…</p> : null}{mutation.isError || saveOrder.isError ? <p className="mt-4 text-sm text-red-700" role="alert">{userFacingError(mutation.error ?? saveOrder.error)} The original is unchanged.</p> : null}{mutation.isSuccess || saveOrder.isSuccess ? <p className="mt-4 text-sm text-emerald-700" role="status">Complete. The result was saved in document history.</p> : null}
      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title={`Delete ${pages.length} page${pages.length === 1 ? "" : "s"}?`} description="This creates a new version; the original remains safe. A PDF must keep at least one page." confirmLabel="Delete pages" danger pending={mutation.isPending} onConfirm={() => mutation.mutate({ operation: "delete-pages", payload: { pages } }, { onSuccess: () => setConfirmDelete(false) })} />
    </main>
  );
}
