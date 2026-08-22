import { api, userFacingError, type DirectToolResult } from "@pdf-studio/api-client";
import { OverlayEditorEngine } from "@pdf-studio/pdf-engine";
import { Button, Card, IconButton, Tooltip } from "@pdf-studio/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ChevronLeft, ChevronRight, Download, FileSearch, Minus,
  PanelRightClose, PanelRightOpen, Plus, RotateCcw, Save,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { capabilitiesQuery, editSessionQuery, fontsQuery, queryKeys } from "../../api/queries";
import { ErrorState, LoadingState } from "../../components/async-state";
import { clampZoom, useEditorStore } from "../../stores/editor-store";
import { CapabilityNotice } from "../tools/tool-components";
import { EditorCanvas } from "./overlay/editor-canvas";
import { PropertiesPanel } from "./overlay/properties-panel";
import { toAnnotationDocument, usedAssets } from "./overlay/serialize";
import { useOverlayStore } from "./overlay/store";
import { EditorToolbar } from "./overlay/toolbar";
import { DEFAULT_STROKE_COLOR, MAX_ASSETS } from "./overlay/types";

const limitMessages: Record<string, string> = {
  page: "Halaman ini sudah mencapai batas 500 objek.",
  document: "Dokumen ini sudah mencapai batas 5000 objek.",
  assets: `Maksimal ${MAX_ASSETS} gambar per dokumen.`,
};

export function OverlayEditor({ sessionId }: { sessionId: string }) {
  const session = useQuery(editSessionQuery(sessionId));
  const capabilities = useQuery(capabilitiesQuery);
  const fontList = useQuery(fontsQuery);
  const queryClient = useQueryClient();
  const engineRef = useRef<OverlayEditorEngine>(null);
  const [engine, setEngine] = useState<OverlayEditorEngine>();
  const [pageCount, setPageCount] = useState(0);
  const [pageSize, setPageSize] = useState<{ width: number; height: number }>();
  const [textLayer, setTextLayer] = useState<"present" | "absent" | "unknown">("unknown");
  const [activeColor, setActiveColor] = useState(DEFAULT_STROKE_COLOR);
  const [result, setResult] = useState<DirectToolResult>();
  const [notice, setNotice] = useState<string | null>(null);
  const [showHints, setShowHints] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const detachWheel = useRef<(() => void) | null>(null);

  const page = useEditorStore((state) => state.selectedPage);
  const setPage = useEditorStore((state) => state.setSelectedPage);
  const zoom = useEditorStore((state) => state.zoom);
  const setZoom = useEditorStore((state) => state.setZoom);
  const objects = useOverlayStore((state) => state.objects);
  const assets = useOverlayStore((state) => state.assets);
  const selectedId = useOverlayStore((state) => state.selectedId);
  const lastLimit = useOverlayStore((state) => state.lastLimit);
  const add = useOverlayStore((state) => state.add);
  const remove = useOverlayStore((state) => state.remove);
  const undo = useOverlayStore((state) => state.undo);
  const redo = useOverlayStore((state) => state.redo);
  const resetOverlay = useOverlayStore((state) => state.reset);

  useEffect(() => {
    setPage(1);
    return () => resetOverlay();
  }, [sessionId, setPage, resetOverlay]);

  useEffect(() => {
    if (!session.data) return;
    const next = new OverlayEditorEngine();
    engineRef.current = next;
    let active = true;
    void next.load(session.data.session.previewUrl).then(async () => {
      const [count, layer] = await Promise.all([next.getPageCount(), next.detectTextLayer()]);
      if (!active) return;
      setEngine(next);
      setPageCount(count);
      setTextLayer(layer);
    });
    return () => {
      active = false;
      setEngine(undefined);
      void next.destroy();
    };
  }, [session.data]);

  useEffect(() => {
    if (!engine || pageCount === 0) return;
    let active = true;
    void engine.getPageSize(page).then((size) => {
      if (active) setPageSize(size);
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, [engine, page, pageCount]);

  useEffect(() => {
    engineRef.current?.markDirty(objects.length > 0);
  }, [objects.length]);

  const previewUrls = useRef<string[]>([]);
  useEffect(() => () => {
    for (const url of previewUrls.current) URL.revokeObjectURL(url);
    previewUrls.current = [];
  }, []);

  const insertImage = useCallback((file: File) => {
    if (!pageSize) return;
    const url = URL.createObjectURL(file);
    previewUrls.current.push(url);
    const probe = new Image();
    probe.onload = () => {
      const maxWidth = pageSize.width * 0.32;
      const ratio = probe.naturalWidth / Math.max(1, probe.naturalHeight);
      const width = Math.min(maxWidth, probe.naturalWidth);
      add(
        {
          id: crypto.randomUUID(), kind: "image", page,
          asset: `asset-${crypto.randomUUID().slice(0, 8)}`,
          centerX: pageSize.width / 2, centerY: pageSize.height / 2,
          width, height: width / ratio, previewUrl: url, opacity: 1, rotation: 0,
        },
        file,
      );
    };
    probe.src = url;
  }, [add, page, pageSize]);

  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const zoomAnchor = useRef<{ x: number; y: number; factor: number } | null>(null);

  // A callback ref, not an effect: this component returns early while the
  // session loads, so an effect keyed on stable deps would run once against a
  // ref that is still null and never fire again once the container mounts.
  const attachScroll = useCallback((container: HTMLDivElement | null) => {
    detachWheel.current?.();
    detachWheel.current = null;
    scrollRef.current = container;
    if (!container) return;
    const onWheel = (event: WheelEvent) => {
      // A plain two-finger swipe keeps scrolling the page; only a pinch zooms.
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const current = zoomRef.current;
      const next = clampZoom(current * Math.exp(-event.deltaY / 180));
      if (Math.abs(next - current) < 0.0005) return;
      const rect = container.getBoundingClientRect();
      zoomAnchor.current = { x: event.clientX - rect.left, y: event.clientY - rect.top, factor: next / current };
      setZoom(next);
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    detachWheel.current = () => container.removeEventListener("wheel", onWheel);
  }, [setZoom]);

  useEffect(() => () => detachWheel.current?.(), []);

  // Keep whatever sat under the cursor in place once the new size is laid out.
  useLayoutEffect(() => {
    const container = scrollRef.current;
    const anchor = zoomAnchor.current;
    if (!container || !anchor) return;
    zoomAnchor.current = null;
    container.scrollLeft = (container.scrollLeft + anchor.x) * anchor.factor - anchor.x;
    container.scrollTop = (container.scrollTop + anchor.y) * anchor.factor - anchor.y;
  }, [zoom]);

  const panBy = useCallback((deltaX: number, deltaY: number) => {
    scrollRef.current?.scrollBy({ left: deltaX, top: deltaY });
  }, []);

  // The canvas itself handles drags that land on the page. This covers the
  // margin around it, so a drag anywhere in the viewport moves the page.
  const backdropPan = useRef<{ x: number; y: number } | null>(null);
  const onBackdropPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    backdropPan.current = { x: event.clientX, y: event.clientY };
  };
  const onBackdropPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const last = backdropPan.current;
    if (!last) return;
    panBy(last.x - event.clientX, last.y - event.clientY);
    backdropPan.current = { x: event.clientX, y: event.clientY };
  };
  const onBackdropPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    backdropPan.current = null;
  };

  const exportMutation = useMutation({
    mutationFn: () => api.exportEditSession(sessionId, toAnnotationDocument(objects), usedAssets(objects, assets)),
    onSuccess: async (data) => {
      setResult(data);
      setNotice(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.documents });
    },
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if ((event.key === "Delete" || event.key === "Backspace") && selectedId) {
        event.preventDefault();
        remove(selectedId);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, remove, undo, redo]);

  if (session.isPending || capabilities.isPending) return <main className="page-shell py-10"><LoadingState label="Membuka editor…" /></main>;
  if (session.isError) return <main className="page-shell py-10"><ErrorState error={session.error} /></main>;
  if (capabilities.isError) return <main className="page-shell py-10"><ErrorState error={capabilities.error} /></main>;

  const fonts = fontList.data?.fonts ?? [];
  const canAnnotate = capabilities.data.features.annotate;
  const busy = exportMutation.isPending;

  return (
    <main className="flex h-[calc(100dvh-5rem)] w-full flex-col gap-2 px-3 pb-3 pt-2 sm:px-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">Edit PDF</p>
          <h1 className="font-display mt-0.5 max-w-md truncate text-2xl font-medium text-ink">{session.data.session.filename}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-2xl border border-line bg-paper px-1 py-1">
            <IconButton size="sm" className="border-transparent bg-transparent" onClick={() => setZoom(zoom - 0.15)} aria-label="Perkecil"><Minus className="size-4" /></IconButton>
            <Tooltip content="Cubit dua jari di trackpad, atau Ctrl + scroll, untuk zoom ke titik kursor">
              <span className="min-w-14 cursor-help text-center text-sm font-semibold">{Math.round(zoom * 100)}%</span>
            </Tooltip>
            <IconButton size="sm" className="border-transparent bg-transparent" onClick={() => setZoom(zoom + 0.15)} aria-label="Perbesar"><Plus className="size-4" /></IconButton>
          </div>
          {result ? (
            <Button asChild variant="secondary">
              <a href={result.downloadUrl} download={result.outputName ?? session.data.session.filename}>
                <Download className="size-4" /> Unduh hasil edit
              </a>
            </Button>
          ) : null}
          <Button type="button" disabled={!canAnnotate || objects.length === 0 || busy} onClick={() => exportMutation.mutate()}>
            <Save className="size-4" /> {busy ? "Menyimpan…" : result ? "Simpan lagi" : "Simpan"}
          </Button>
          <Tooltip content={panelOpen ? "Sembunyikan panel" : "Tampilkan panel"}>
            <span>
              <IconButton aria-label={panelOpen ? "Sembunyikan panel" : "Tampilkan panel"} onClick={() => setPanelOpen(!panelOpen)}>
                {panelOpen ? <PanelRightClose className="size-[18px]" /> : <PanelRightOpen className="size-[18px]" />}
              </IconButton>
            </span>
          </Tooltip>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <EditorToolbar onPickImage={insertImage} disabled={!canAnnotate || busy} showHints={showHints} onToggleHints={setShowHints} />
        {!canAnnotate ? <CapabilityNotice reason={capabilities.data.tools.qpdf.reason ?? "qpdf atau pdfinfo belum tersedia di PATH backend."} /> : null}
      </div>

      {lastLimit ? <p className="text-xs font-bold text-accent" role="alert">{limitMessages[lastLimit]}</p> : null}
      {notice ? <p className="text-xs font-bold text-accent" role="status">{notice}</p> : null}
      {exportMutation.isError ? (
        <p className="text-xs font-bold text-accent" role="alert">
          Gagal menyimpan: {userFacingError(exportMutation.error)} Original tetap aman.
        </p>
      ) : null}

      <div className="relative min-h-0 flex-1">
        <div ref={attachScroll} className="h-full overflow-auto rounded-[1.5rem] border border-ink bg-canvas">
          <div
            className="flex min-h-full w-max min-w-full cursor-grab items-center justify-center p-6 active:cursor-grabbing"
            onPointerDown={onBackdropPointerDown}
            onPointerMove={onBackdropPointerMove}
            onPointerUp={onBackdropPointerUp}
            onPointerCancel={onBackdropPointerUp}
          >
            {engine && pageSize ? (
              <EditorCanvas
                engine={engine}
                page={page}
                pageWidth={pageSize.width}
                pageHeight={pageSize.height}
                scale={zoom}
                fonts={fonts}
                activeColor={activeColor}
                showHints={showHints}
                onNotice={setNotice}
                onPan={panBy}
              />
            ) : (
              <div className="self-center"><LoadingState label="Menyiapkan halaman…" /></div>
            )}
          </div>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-ink bg-paper/95 px-2 py-1.5 shadow-[0_2px_10px_rgba(0,0,0,.12)] backdrop-blur">
            <IconButton size="sm" className="border-transparent bg-transparent" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Halaman sebelumnya"><ChevronLeft className="size-4" /></IconButton>
            <span className="text-xs font-bold text-ink">{page} / {pageCount || "…"}</span>
            <IconButton size="sm" className="border-transparent bg-transparent" disabled={page >= pageCount} onClick={() => setPage(page + 1)} aria-label="Halaman berikutnya"><ChevronRight className="size-4" /></IconButton>
          </div>
        </div>

        {panelOpen ? (
          <aside className="absolute right-3 top-3 flex max-h-[calc(100%-1.5rem)] w-72 flex-col gap-3 overflow-y-auto rounded-2xl">
            {textLayer === "absent" ? (
              <Card className="border-accent/40 bg-accent-soft p-4 text-xs leading-5 text-ink">
                <div className="flex items-start gap-2">
                  <FileSearch className="mt-0.5 size-4 shrink-0" />
                  <div>
                    <p className="font-bold">Halaman ini kemungkinan hasil scan.</p>
                    <p className="mt-1">Teksnya tidak bisa diambil alih karena berupa gambar. Jalankan OCR lebih dulu.</p>
                    <Button asChild className="mt-2"><Link to="/ocr">Buka OCR</Link></Button>
                  </div>
                </div>
              </Card>
            ) : null}
            <Card className="p-4">
              <h2 className="text-sm font-black text-ink">Warna untuk objek baru</h2>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="color"
                  value={activeColor}
                  aria-label="Warna untuk objek baru"
                  onChange={(event) => setActiveColor(event.target.value)}
                  className="size-9 shrink-0 cursor-pointer rounded-lg border border-line bg-paper p-1"
                />
                <input
                  type="text"
                  value={activeColor}
                  maxLength={7}
                  spellCheck={false}
                  aria-label="Warna untuk objek baru: kode hex"
                  onChange={(event) => {
                    const next = event.target.value;
                    if (/^#?[0-9a-fA-F]{6}$/.test(next)) setActiveColor(next.startsWith("#") ? next : `#${next}`);
                  }}
                  className="form-control font-mono text-sm uppercase"
                />
              </div>
            </Card>
            <PropertiesPanel fonts={fonts} fontsAvailable={fonts.length > 0} />
            <Card className="p-4 text-xs">
              <div className="flex justify-between"><span className="text-muted">Objek</span><b className="text-ink">{objects.length}</b></div>
              <div className="mt-1.5 flex justify-between"><span className="text-muted">Gambar</span><b className="text-ink">{Object.keys(assets).length}</b></div>
              <p className="mt-3 leading-5 text-muted">
                Klik teks atau garis di halaman untuk mengambil alih dan mengeditnya. Klik dua kali pada teks untuk mengubahnya langsung di kanvas.
                Tahan <b>Spasi</b> lalu tarik untuk menggeser halaman.
              </p>
            </Card>
            {result ? (
              <Card className="border-ink bg-paper p-4 shadow-[4px_4px_0_#ff2d2d]" role="status">
                <p className="text-sm font-black text-ink">Versi baru tersimpan</p>
                <p className="mt-1 text-xs leading-5 text-muted">Original tidak berubah dan hasilnya muncul di Recent Files.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button asChild className="grow"><a href={result.downloadUrl} download={result.outputName ?? session.data.session.filename}><Download className="size-4" /> Unduh</a></Button>
                  <Button type="button" variant="ghost" aria-label="Tutup ringkasan" onClick={() => { setResult(undefined); exportMutation.reset(); }}><RotateCcw className="size-4" /></Button>
                </div>
              </Card>
            ) : null}
          </aside>
        ) : null}
      </div>
    </main>
  );
}
