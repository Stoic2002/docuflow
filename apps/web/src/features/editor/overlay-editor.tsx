import { api, userFacingError, type DirectToolResult } from "@pdf-studio/api-client";
import { OverlayEditorEngine } from "@pdf-studio/pdf-engine";
import { Button, Card, Tooltip } from "@pdf-studio/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Download, FileSearch, Minus, Plus, RotateCcw, Save } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { capabilitiesQuery, fontsQuery, editSessionQuery, queryKeys } from "../../api/queries";
import { ErrorState, LoadingState } from "../../components/async-state";
import { clampZoom, useEditorStore } from "../../stores/editor-store";
import { CapabilityNotice } from "../tools/tool-components";
import { EditorCanvas } from "./overlay/editor-canvas";
import { EditorToolbar } from "./overlay/toolbar";
import { PropertiesPanel } from "./overlay/properties-panel";
import { toAnnotationDocument, usedAssets } from "./overlay/serialize";
import { useOverlayStore } from "./overlay/store";
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
  const tool = useOverlayStore((state) => state.tool);
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

  // Object URLs are created per inserted image and released on unmount.
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

  // Trackpad pinch and Ctrl+wheel arrive as a wheel event with ctrlKey set.
  // The listener is native because it must call preventDefault, which React's
  // passive wheel handler cannot do.
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
      // Exponential steps keep a pinch smooth across the whole zoom range.
      const next = clampZoom(current * Math.exp(-event.deltaY / 180));
      if (Math.abs(next - current) < 0.0005) return;
      const rect = container.getBoundingClientRect();
      zoomAnchor.current = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        factor: next / current,
      };
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

  const exportMutation = useMutation({
    mutationFn: () => api.exportEditSession(sessionId, toAnnotationDocument(objects), usedAssets(objects, assets)),
    onSuccess: async (data) => {
      setResult(data);
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
    <main className="mx-auto max-w-[1600px] px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Edit PDF</p>
          <h1 className="font-display mt-1 max-w-xl truncate text-3xl font-medium text-ink">{session.data.session.filename}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" onClick={() => setZoom(zoom - 0.15)} aria-label="Perkecil"><Minus className="size-4" /></Button>
          <Tooltip content="Cubit dua jari di trackpad, atau Ctrl + scroll, untuk zoom ke titik kursor">
            <span className="min-w-14 cursor-help text-center text-sm font-semibold">{Math.round(zoom * 100)}%</span>
          </Tooltip>
          <Button type="button" variant="secondary" onClick={() => setZoom(zoom + 0.15)} aria-label="Perbesar"><Plus className="size-4" /></Button>
          <Button asChild variant="secondary">
            <a href={session.data.session.downloadUrl} download={session.data.session.filename}><Download className="size-4" /> Unduh original</a>
          </Button>
          <Button type="button" disabled={!canAnnotate || objects.length === 0 || busy} onClick={() => exportMutation.mutate()}>
            <Save className="size-4" /> {busy ? "Menyimpan…" : "Simpan sebagai versi baru"}
          </Button>
        </div>
      </div>

      {!canAnnotate ? <div className="mt-3"><CapabilityNotice reason={capabilities.data.tools.qpdf.reason ?? "qpdf atau pdfinfo belum tersedia di PATH backend."} /></div> : null}
      {textLayer === "absent" ? (
        <Card className="mt-3 border-accent/40 bg-accent-soft p-4 text-sm text-ink">
          <div className="flex items-start gap-3">
            <FileSearch className="mt-0.5 size-5" />
            <div>
              <p className="font-bold">Text layer tidak ditemukan pada halaman sampel.</p>
              <p className="mt-1">Dokumen ini kemungkinan hasil scan. Anotasi tetap bisa ditambahkan di atasnya.</p>
              <Button asChild className="mt-3"><Link to="/ocr">Buka OCR</Link></Button>
            </div>
          </div>
        </Card>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-3">
          <EditorToolbar onPickImage={insertImage} disabled={!canAnnotate || busy} />
          {lastLimit ? <p className="text-xs font-bold text-accent" role="alert">{limitMessages[lastLimit]}</p> : null}
          {tool === "rules" ? (
            <p className="text-xs leading-5 text-muted">
              Docuflow membaca garis vektor pada halaman — pembatas tabel, garis bawah, dan pemisah. Klik salah satunya untuk menutupnya lalu menggantinya dengan garis baru yang bisa digeser, diubah warnanya, atau dihapus. Tabel dikenali sebagai kumpulan garisnya, bukan sebagai satu objek utuh.
            </p>
          ) : null}
          {tool === "retype" ? (
            <p className="text-xs leading-5 text-muted">
              Klik teks yang disorot untuk menggantinya. Docuflow menutup teks lama dengan warna latar di sekitarnya lalu menulis teks baru di atasnya — rapi pada latar polos, terlihat pada latar bergambar atau bergradasi. Teks pengganti tidak mengalir ulang, jadi teks yang lebih panjang akan melewati batas teks lama. Teks asli juga tetap ada di dalam file, tertutup, sehingga cara ini <b>bukan</b> redaksi yang aman.
            </p>
          ) : null}
          {notice ? <p className="text-xs font-bold text-accent" role="status">{notice}</p> : null}
          <div ref={attachScroll} className="flex max-h-[74vh] justify-center overflow-auto rounded-[1.75rem] border border-ink bg-canvas p-5">
            {engine && pageSize ? (
              <EditorCanvas
                engine={engine}
                page={page}
                pageWidth={pageSize.width}
                pageHeight={pageSize.height}
                scale={zoom}
                fonts={fonts}
                activeFont=""
                activeColor={activeColor}
                onNotice={setNotice}
              />
            ) : (
              <LoadingState label="Menyiapkan halaman…" />
            )}
          </div>
          <div className="flex items-center justify-center gap-3">
            <Button type="button" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Halaman sebelumnya"><ChevronLeft className="size-4" /></Button>
            <span className="text-sm font-semibold text-muted">Halaman {page} dari {pageCount || "…"}</span>
            <Button type="button" variant="secondary" disabled={page >= pageCount} onClick={() => setPage(page + 1)} aria-label="Halaman berikutnya"><ChevronRight className="size-4" /></Button>
          </div>
        </div>

        <aside className="space-y-4">
          <Card className="p-5">
            <h2 className="text-lg font-black text-ink">Warna aktif</h2>
            <p className="mt-1 text-xs leading-5 text-muted">Dipakai untuk objek baru. Objek yang sudah ada diubah lewat panel Properti.</p>
            <input
              type="color"
              value={activeColor}
              aria-label="Warna aktif"
              onChange={(event) => setActiveColor(event.target.value)}
              className="mt-3 h-10 w-full cursor-pointer rounded-lg border border-line bg-paper p-1"
            />
          </Card>
          <PropertiesPanel fonts={fonts} fontsAvailable={fonts.length > 0} />
          <Card className="p-5 text-sm">
            <div className="flex justify-between"><span className="text-muted">Objek di dokumen</span><b className="text-ink">{objects.length}</b></div>
            <div className="mt-2 flex justify-between"><span className="text-muted">Gambar</span><b className="text-ink">{Object.keys(assets).length}</b></div>
          </Card>
        </aside>
      </div>

      {exportMutation.isError ? (
        <Card className="mt-4 border-accent bg-accent-soft p-5 text-sm text-ink" role="alert">
          <b>Gagal menyimpan.</b> {userFacingError(exportMutation.error)} Original tetap aman.
        </Card>
      ) : null}
      {result ? (
        <Card className="mt-4 border-ink bg-paper p-6 shadow-[6px_6px_0_#ff2d2d]" role="status">
          <p className="eyebrow">Tersimpan</p>
          <h2 className="font-display mt-2 text-3xl font-medium text-ink">Versi baru siap diunduh</h2>
          <p className="mt-2 text-sm text-muted">Original tidak berubah. Hasilnya juga muncul di Recent Files.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button asChild><a href={result.downloadUrl} download={result.outputName ?? session.data.session.filename}><Download className="size-4" /> Unduh hasil</a></Button>
            <Button type="button" variant="secondary" onClick={() => { setResult(undefined); exportMutation.reset(); }}><RotateCcw className="size-4" /> Lanjut mengedit</Button>
          </div>
        </Card>
      ) : null}
    </main>
  );
}
