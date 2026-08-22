import { FallbackViewerEngine, type ViewablePdfEngine } from "@pdf-studio/pdf-engine";
import { Button, Card, Tooltip } from "@pdf-studio/ui";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Link } from "@tanstack/react-router";
import { Download, FileSearch, Minus, MousePointer2, Plus, Type } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { capabilitiesQuery, editSessionQuery } from "../../api/queries";
import { ErrorState, LoadingState } from "../../components/async-state";
import { useEditorStore } from "../../stores/editor-store";
import { CapabilityNotice, StartOverButton } from "../tools/tool-components";

function PageThumbnail({ engine, pageNumber, selected, onSelect }: { engine: ViewablePdfEngine; pageNumber: number; selected: boolean; onSelect: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvasRef.current) return;
    void engine.renderPage(pageNumber, canvasRef.current, 128).catch(() => undefined);
  }, [engine, pageNumber]);
  return (
    <button type="button" onClick={onSelect} className={`w-full rounded-2xl border-2 p-2 text-left focus-visible:ring-2 focus-visible:ring-accent ${selected ? "border-accent bg-accent-soft" : "border-line bg-paper"}`}>
      <canvas ref={canvasRef} className="mx-auto max-w-full bg-white shadow-sm" aria-label={`Thumbnail halaman ${pageNumber}`} />
      <span className="mt-2 block text-center text-xs font-semibold">Halaman {pageNumber}</span>
    </button>
  );
}

function ThumbnailRail({ engine, count }: { engine: ViewablePdfEngine; count: number }) {
  const parent = useRef<HTMLDivElement>(null);
  const selectedPage = useEditorStore((state) => state.selectedPage);
  const setSelectedPage = useEditorStore((state) => state.setSelectedPage);
  const virtualizer = useVirtualizer({ count, getScrollElement: () => parent.current, estimateSize: () => 210, overscan: 2 });
  return (
    <aside ref={parent} className="h-[68vh] min-h-[480px] overflow-auto border-r border-line bg-canvas p-3" aria-label="Daftar halaman">
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => (
          <div key={item.key} className="absolute left-0 top-0 w-full pb-3" style={{ transform: `translateY(${item.start}px)` }}>
            <PageThumbnail engine={engine} pageNumber={item.index + 1} selected={selectedPage === item.index + 1} onSelect={() => setSelectedPage(item.index + 1)} />
          </div>
        ))}
      </div>
    </aside>
  );
}

function DisabledEditButton({ label, reason, icon }: { label: string; reason: string; icon: React.ReactNode }) {
  return <Tooltip content={reason}><span><Button type="button" variant="ghost" disabled>{icon}{label}</Button></span></Tooltip>;
}

export function PreviewWorkspace({ sessionId }: { sessionId: string }) {
  const session = useQuery(editSessionQuery(sessionId));
  const capabilities = useQuery(capabilitiesQuery);
  const [engine, setEngine] = useState<ViewablePdfEngine>();
  const [viewerSource, setViewerSource] = useState<string>();
  const [pageCount, setPageCount] = useState(0);
  const [textLayer, setTextLayer] = useState<"present" | "absent" | "unknown">("unknown");
  const zoom = useEditorStore((state) => state.zoom);
  const setZoom = useEditorStore((state) => state.setZoom);
  useEffect(() => {
    if (!session.data) return;
    const nextEngine = new FallbackViewerEngine();
    let active = true;
    void nextEngine.load(session.data.session.previewUrl).then(async () => {
      const [count, layer] = await Promise.all([nextEngine.getPageCount(), nextEngine.detectTextLayer()]);
      if (!active) return;
      setEngine(nextEngine); setViewerSource(nextEngine.getViewerSource()); setPageCount(count); setTextLayer(layer);
    });
    return () => { active = false; setEngine(undefined); void nextEngine.destroy(); };
  }, [session.data]);
  if (session.isPending || capabilities.isPending) return <main className="mx-auto max-w-7xl px-5 py-10"><LoadingState label="Membuka Preview…" /></main>;
  if (session.isError) return <main className="mx-auto max-w-7xl px-5 py-10"><ErrorState error={session.error} /></main>;
  if (capabilities.isError) return <main className="mx-auto max-w-7xl px-5 py-10"><ErrorState error={capabilities.error} /></main>;
  const editingReason = "Native content editing belum tersedia pada fallback viewer.";
  return (
    <main className="mx-auto max-w-[1500px] px-4 py-7">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div><p className="eyebrow">Preview mode</p><h1 className="font-display mt-1 max-w-xl truncate text-3xl font-medium text-ink">{session.data.session.filename}</h1></div>
        <div className="flex flex-wrap items-center gap-2">
          <DisabledEditButton label="Edit text" reason={editingReason} icon={<Type className="size-4" />} />
          <DisabledEditButton label="Annotate" reason="Overlay editing belum dikonfigurasi." icon={<MousePointer2 className="size-4" />} />
          <Button variant="secondary" onClick={() => setZoom(zoom - 0.1)} aria-label="Perkecil"><Minus className="size-4" /></Button>
          <span className="min-w-14 text-center text-sm font-semibold">{Math.round(zoom * 100)}%</span>
          <Button variant="secondary" onClick={() => setZoom(zoom + 0.1)} aria-label="Perbesar"><Plus className="size-4" /></Button>
          <Button asChild><a href={session.data.session.downloadUrl} download={session.data.session.filename}><Download className="size-4" /> Unduh original</a></Button>
        </div>
      </div>
      {!capabilities.data.nativeContentEditing ? <CapabilityNotice title="Ini Preview, bukan Editor native" reason="Provider Apryse/Nutrient dan lisensinya belum dipilih. Konten PDF tidak dapat diubah atau diekspor sebagai edit baru dari fallback ini." /> : null}
      {textLayer === "absent" ? (
        <Card className="mt-3 border-accent/40 bg-accent-soft p-4 text-sm text-ink">
          <div className="flex items-start gap-3"><FileSearch className="mt-0.5 size-5" /><div><p className="font-bold">Text layer yang dapat digunakan tidak ditemukan pada halaman sampel.</p><p className="mt-1">Dokumen ini kemungkinan hasil scan. Searchable OCR dapat menambahkan lapisan teks, tetapi tidak membuat layout sepenuhnya editable.</p><Button asChild className="mt-3"><Link to="/ocr">Buka OCR</Link></Button></div></div>
        </Card>
      ) : null}
      <Card className="mt-4 overflow-hidden border-ink">
        <div className={pageCount > 0 ? "grid md:grid-cols-[180px_1fr]" : ""}>
          {engine && pageCount > 0 ? <ThumbnailRail engine={engine} count={pageCount} /> : null}
          {viewerSource ? <iframe className="h-[68vh] min-h-[480px] w-full bg-[#d8d3ca]" src={`${viewerSource}#toolbar=1&navpanes=0&zoom=${Math.round(zoom * 100)}`} title={`Preview ${session.data.session.filename}`} /> : <LoadingState label="Menyiapkan preview…" />}
        </div>
      </Card>
      <div className="mt-4 flex justify-between text-sm text-muted"><span>{pageCount ? `${pageCount} halaman` : "Page count tidak tersedia"} · Text layer: {textLayer}</span><StartOverButton onClick={() => { window.location.href = "/edit"; }} /></div>
    </main>
  );
}
