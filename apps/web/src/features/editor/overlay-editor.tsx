import { api, userFacingError, type DirectToolResult } from "@pdf-studio/api-client";
import { OverlayEditorEngine } from "@pdf-studio/pdf-engine";
import { Button, ColorInput, IconButton, PanelSection, Tooltip } from "@pdf-studio/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft, ChevronLeft, ChevronRight, Download, Minus,
  PanelRightClose, PanelRightOpen, Plus, RotateCcw, Save,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { capabilitiesQuery, documentFontsQuery, editSessionQuery, fontsQuery, queryKeys } from "../../api/queries";
import { ErrorState, LoadingState } from "../../components/async-state";
import { EditorCanvas } from "./overlay/editor-canvas";
import { HistoryControls } from "./overlay/history-controls";
import { PropertiesBar } from "./overlay/properties-bar";
import { aliasFamilyFor } from "./overlay/retype";
import { toAnnotationDocument, usedAssets } from "./overlay/serialize";
import { clampZoom, useOverlayStore } from "./overlay/store";
import { fromEditorChrome } from "./overlay/keyboard";
import { EditorToolbar } from "./overlay/toolbar";
import { DEFAULT_STROKE_COLOR, MAX_ASSETS } from "./overlay/types";
import { canvasPads, initialScroll, scrollForZoom } from "./overlay/viewport";

/** Loose match so a subset tag or a weight suffix still counts as installed. */
function matchesRegistered(name: string, fonts: { family: string }[]): boolean {
  const wanted = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return fonts.some((font) => {
    const family = font.family.toLowerCase().replace(/[^a-z0-9]/g, "");
    return family === wanted || (wanted.length > 3 && (family.includes(wanted) || wanted.includes(family)));
  });
}

const limitMessages: Record<string, string> = {
  page: "Halaman ini sudah mencapai batas 500 objek.",
  document: "Dokumen ini sudah mencapai batas 5000 objek.",
  assets: `Maksimal ${MAX_ASSETS} gambar per dokumen.`,
};

export function OverlayEditor({ sessionId }: { sessionId: string }) {
  const session = useQuery(editSessionQuery(sessionId));
  const capabilities = useQuery(capabilitiesQuery);
  const fontList = useQuery(fontsQuery);
  const documentFonts = useQuery(documentFontsQuery(sessionId));
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
  // On narrow viewports the open panel would cover the whole canvas, so it
  // starts closed there and the header toggle brings it up on demand.
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 1024);
  const scrollRef = useRef<HTMLDivElement>(null);
  const detachWheel = useRef<(() => void) | null>(null);

  const page = useOverlayStore((state) => state.page);
  const setPage = useOverlayStore((state) => state.setPage);
  const zoom = useOverlayStore((state) => state.zoom);
  const setZoom = useOverlayStore((state) => state.setZoom);
  const objects = useOverlayStore((state) => state.objects);
  const assets = useOverlayStore((state) => state.assets);
  const selectedId = useOverlayStore((state) => state.selectedId);
  const lastLimit = useOverlayStore((state) => state.lastLimit);
  const add = useOverlayStore((state) => state.add);
  const remove = useOverlayStore((state) => state.remove);
  const undo = useOverlayStore((state) => state.undo);
  const redo = useOverlayStore((state) => state.redo);
  const resetOverlay = useOverlayStore((state) => state.reset);

  useEffect(() => () => resetOverlay(), [sessionId, resetOverlay]);

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

  // Measured so the page gets half a viewport of empty travel on every side:
  // that is what makes dragging the paper feel free instead of clamped.
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  // Set by a pinch, in container coordinates; cleared once the zoom is applied.
  const zoomAnchor = useRef<{ x: number; y: number } | null>(null);

  // A callback ref, not an effect: this component returns early while the
  // session loads, so an effect keyed on stable deps would run once against a
  // ref that is still null and never fire again once the container mounts.
  const attachScroll = useCallback((container: HTMLDivElement | null) => {
    detachWheel.current?.();
    detachWheel.current = null;
    scrollRef.current = container;
    if (!container) return;
    // A trackpad fires wheel events faster than the browser paints, so the
    // steps are coalesced into one state change per frame; without that every
    // event re-rendered the whole editor and the pinch felt heavy.
    let frame = 0;
    const pending = { zoom: 0, clientX: 0, clientY: 0, queued: false };
    const onWheel = (event: WheelEvent) => {
      // A plain two-finger swipe keeps scrolling the page; only a pinch zooms.
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const current = pending.queued ? pending.zoom : zoomRef.current;
      const next = clampZoom(current * Math.exp(-event.deltaY / 180));
      if (Math.abs(next - current) < 0.0005) return;
      pending.zoom = next;
      pending.clientX = event.clientX;
      pending.clientY = event.clientY;
      pending.queued = true;
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        if (!pending.queued) return;
        pending.queued = false;
        // Read the box once per frame, not once per event.
        const rect = container.getBoundingClientRect();
        zoomAnchor.current = { x: pending.clientX - rect.left, y: pending.clientY - rect.top };
        setZoom(pending.zoom);
      });
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    const observer = new ResizeObserver(() => {
      setViewportSize({ width: container.clientWidth, height: container.clientHeight });
    });
    observer.observe(container);
    setViewportSize({ width: container.clientWidth, height: container.clientHeight });
    detachWheel.current = () => {
      container.removeEventListener("wheel", onWheel);
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [setZoom]);

  useEffect(() => () => detachWheel.current?.(), []);

  // Whatever sits under this point stays put across a zoom step: the pointer
  // during a pinch, and the middle of the viewport for the toolbar buttons.
  // The compensation must scale about the PAGE origin (which sits at the
  // constant padding offset inside the scroller), not about the wrapper origin
  // — padding itself does not grow with zoom, and ignoring that term is what
  // made the view slide while pinching. Same lesson as excalidraw's
  // getViewportForZoom.
  const committedZoomRef = useRef(zoom);
  useLayoutEffect(() => {
    const container = scrollRef.current;
    const factor = zoom / committedZoomRef.current;
    committedZoomRef.current = zoom;
    const anchor = zoomAnchor.current;
    zoomAnchor.current = null;
    if (!container || Math.abs(factor - 1) < 0.0001) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    const next = scrollForZoom(
      { left: container.scrollLeft, top: container.scrollTop },
      canvasPads(width, height),
      anchor ?? { x: width / 2, y: height / 2 },
      factor,
    );
    container.scrollLeft = next.left;
    container.scrollTop = next.top;
  }, [zoom]);

  // The scroller starts at the top-left of the empty travel around the page,
  // which put the paper down and to the right on open. Once the page size and
  // the viewport are both known, the view is placed on the page itself — once,
  // so it never fights the reader's own scrolling afterwards.
  const centred = useRef(false);
  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container || centred.current || !pageSize || viewportSize.width === 0) return;
    const start = initialScroll(pageSize, viewportSize, zoom);
    container.scrollLeft = start.left;
    container.scrollTop = start.top;
    centred.current = true;
  }, [pageSize, viewportSize, zoom]);

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
      if (fromEditorChrome(event)) return;
      if ((event.key === "Delete" || event.key === "Backspace") && selectedId) {
        // Backspace on a selected text object belongs to type-through editing
        // (the canvas deletes one character); it must not delete the object.
        const selected = objects.find((object) => object.id === selectedId);
        if (event.key === "Backspace" && selected?.kind === "text") return;
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
  }, [objects, selectedId, remove, undo, redo]);

  if (session.isPending || capabilities.isPending) return <main className="page-shell py-10"><LoadingState label="Membuka editor…" /></main>;
  if (session.isError) return <main className="page-shell py-10"><ErrorState error={session.error} /></main>;
  if (capabilities.isError) return <main className="page-shell py-10"><ErrorState error={capabilities.error} /></main>;

  const fonts = fontList.data?.fonts ?? [];
  const canAnnotate = capabilities.data.features.annotate;
  const busy = exportMutation.isPending;
  // One floating line carries whatever the editor most needs to say right now.
  const message = !canAnnotate
    ? (capabilities.data.tools.qpdf.reason ?? "qpdf atau pdfinfo belum tersedia di PATH backend.")
    : exportMutation.isError
      ? `Gagal menyimpan: ${userFacingError(exportMutation.error)} Original tetap aman.`
      : lastLimit
        ? limitMessages[lastLimit]
        : notice;

  return (
    <main className="flex h-[100dvh] w-full flex-col overflow-hidden bg-canvas">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-paper px-3 py-2 sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Tooltip content="Kembali ke Docuflow">
            <Link
              to="/edit"
              className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-line bg-paper text-ink transition hover:border-ink hover:bg-accent-soft hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label="Kembali ke Docuflow"
            >
              <ArrowLeft className="size-[18px]" />
            </Link>
          </Tooltip>
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.08em] text-muted">Edit PDF</p>
            <h1 className="max-w-[22rem] truncate text-base font-bold text-ink">{session.data.session.filename}</h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <HistoryControls disabled={!canAnnotate || busy} />
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

      <div className="relative min-h-0 flex-1">
        <div ref={attachScroll} className="h-full overflow-auto bg-canvas">
          <div
            className="flex min-h-full w-max min-w-full cursor-grab items-center justify-center active:cursor-grabbing"
            style={{
              paddingLeft: canvasPads(viewportSize.width, viewportSize.height).x,
              paddingRight: canvasPads(viewportSize.width, viewportSize.height).x,
              paddingTop: canvasPads(viewportSize.width, viewportSize.height).y,
              paddingBottom: canvasPads(viewportSize.width, viewportSize.height).y,
            }}
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

        <div className="absolute left-3 top-3 z-30 flex max-h-[calc(100%-1.5rem)]">
          <EditorToolbar onPickImage={insertImage} disabled={!canAnnotate || busy} showHints={showHints} onToggleHints={setShowHints} />
        </div>

        {/* One column above the page: the contextual bar first, then whatever
            the editor needs to say. Both float clear of the tool rail. */}
        <div className="pointer-events-none absolute inset-x-0 top-3 z-40 flex flex-col items-center gap-2 px-4 sm:px-24">
          <PropertiesBar fonts={fonts} fontsAvailable={fonts.length > 0} />
          {message ? (
            <p
              className="pointer-events-auto max-w-xl rounded-full border border-line bg-paper/95 px-4 py-2 text-xs font-semibold leading-5 text-ink shadow-[0_4px_16px_rgba(23,23,19,.12)] backdrop-blur"
              role="status"
            >
              {message}
            </p>
          ) : null}
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-ink bg-paper/95 px-2 py-1.5 shadow-[0_2px_10px_rgba(0,0,0,.12)] backdrop-blur">
            <IconButton size="sm" className="border-transparent bg-transparent" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Halaman sebelumnya"><ChevronLeft className="size-4" /></IconButton>
            <span className="text-xs font-bold text-ink">{page} / {pageCount || "…"}</span>
            <IconButton size="sm" className="border-transparent bg-transparent" disabled={page >= pageCount} onClick={() => setPage(page + 1)} aria-label="Halaman berikutnya"><ChevronRight className="size-4" /></IconButton>
          </div>
        </div>

        {panelOpen ? (
          <aside data-editor-chrome className="absolute right-3 top-3 z-40 flex max-h-[calc(100%-1.5rem)] w-[min(20rem,calc(100vw-1.5rem))] flex-col overflow-y-auto rounded-2xl border border-line bg-paper shadow-[0_6px_24px_rgba(23,23,19,.10)]">
            {textLayer === "absent" ? (
              <PanelSection title="Halaman ini hasil scan">
                <p className="text-xs leading-5 text-muted">
                  Teksnya berupa gambar, jadi tidak bisa diambil alih. Jalankan OCR lebih dulu.
                </p>
                <Button asChild className="w-full"><Link to="/ocr">Buka OCR</Link></Button>
              </PanelSection>
            ) : null}

            <PanelSection title="Warna untuk objek baru">
              <ColorInput label="Warna untuk objek baru" value={activeColor} onChange={setActiveColor} />
            </PanelSection>

            {documentFonts.data && documentFonts.data.fonts.length > 0 ? (
              <PanelSection
                title="Font di dokumen ini"
                aside={<span className="text-[11px] text-muted">{documentFonts.data.fonts.length}</span>}
              >
                <ul className="space-y-1.5">
                  {documentFonts.data.fonts.map((font) => {
                    const installed = matchesRegistered(font.name, fonts);
                    const alias = installed ? null : aliasFamilyFor(font.name);
                    return (
                      <li key={`${font.name}-${font.type}`} className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-xs text-ink" title={font.name}>{font.name}</span>
                        <span
                          title={alias ? `Ditangani oleh pengganti metrik: ${alias}` : undefined}
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            installed
                              ? "bg-emerald-100 text-emerald-800"
                              : alias
                                ? "bg-accent-soft text-accent"
                                : "bg-canvas text-muted"
                          }`}
                        >
                          {installed ? "terpasang" : alias ? `→ ${alias}` : "belum ada"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <p className="text-[11px] leading-4 text-muted">
                  Font proprietary tidak bisa disertakan di repo, jadi yang bertanda <b>→</b> otomatis memakai
                  pengganti bebas bermetrik identik (Times→Tinos, Arial→Arimo, Calibri→Carlito, PMincho→Shippori Mincho).
                  Yang bertanda <b>belum ada</b> memakai font terdekat; salin file <code className="font-mono">.ttf</code>-nya
                  ke <code className="font-mono">assets/fonts/</code> lalu jalankan ulang API untuk memakainya langsung.
                </p>
              </PanelSection>
            ) : null}

            <PanelSection title="Dokumen">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted">Objek</span><b className="text-ink">{objects.length}</b>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted">Gambar</span><b className="text-ink">{Object.keys(assets).length}</b>
              </div>
              <p className="text-[11px] leading-4 text-muted">
                Tahan <b>Spasi</b> lalu tarik, atau tarik area kosong, untuk menggeser halaman.
              </p>
            </PanelSection>

            {result ? (
              <PanelSection title="Versi baru tersimpan">
                <p className="text-xs leading-5 text-muted">Original tidak berubah dan hasilnya muncul di Recent Files.</p>
                <div className="flex gap-2">
                  <Button asChild className="grow"><a href={result.downloadUrl} download={result.outputName ?? session.data.session.filename}><Download className="size-4" /> Unduh</a></Button>
                  <IconButton aria-label="Tutup ringkasan" onClick={() => { setResult(undefined); exportMutation.reset(); }}><RotateCcw className="size-4" /></IconButton>
                </div>
              </PanelSection>
            ) : null}
          </aside>
        ) : null}
      </div>
    </main>
  );
}
