import { FallbackViewerEngine, type ViewablePdfEngine } from "@pdf-studio/pdf-engine";
import { Button, Card } from "@pdf-studio/ui";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, FileWarning } from "lucide-react";
import { useEffect, useRef, useState } from "react";

function PageChoice({
  engine,
  pageNumber,
  selected,
  onToggle,
}: {
  engine: ViewablePdfEngine;
  pageNumber: number;
  selected: boolean;
  onToggle: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvas.current) return;
    void engine.renderPage(pageNumber, canvas.current, 124).catch(() => undefined);
  }, [engine, pageNumber]);

  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`${selected ? "Batalkan" : "Pilih"} halaman ${pageNumber}`}
      onClick={onToggle}
      className={`relative h-[196px] w-40 rounded-2xl border-2 p-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ${selected ? "border-accent bg-accent-soft shadow-sm" : "border-line bg-paper hover:border-accent"}`}
    >
      <span className={`absolute right-3 top-3 z-10 flex size-6 items-center justify-center rounded-full border ${selected ? "border-accent bg-accent text-white" : "border-line bg-paper text-transparent"}`}>
        <Check className="size-4" aria-hidden="true" />
      </span>
      <div className="flex h-[148px] items-center justify-center overflow-hidden rounded-xl bg-canvas">
        <canvas ref={canvas} className="max-h-full max-w-full bg-white shadow-sm" aria-hidden="true" />
      </div>
      <span className="mt-2 block text-center text-xs font-bold text-ink">Halaman {pageNumber}</span>
    </button>
  );
}

export function SplitPagePicker({
  file,
  selectedPages,
  onChange,
  onReady,
}: {
  file: File;
  selectedPages: number[];
  onChange: (pages: number[]) => void;
  onReady: (pageCount: number) => void;
}) {
  const [engine, setEngine] = useState<ViewablePdfEngine>();
  const [pageCount, setPageCount] = useState(0);
  const [failed, setFailed] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const virtualizer = useVirtualizer({
    count: pageCount,
    getScrollElement: () => scroller.current,
    estimateSize: () => 176,
    horizontal: true,
    overscan: 2,
  });

  useEffect(() => {
    const nextEngine = new FallbackViewerEngine();
    let active = true;
    setEngine(undefined);
    setPageCount(0);
    setFailed(false);
    void file.arrayBuffer()
      .then((buffer) => nextEngine.load(buffer))
      .then(() => nextEngine.getPageCount())
      .then((count) => {
        if (!active || count < 1) throw new Error("Page count unavailable");
        setEngine(nextEngine);
        setPageCount(count);
        onReadyRef.current(count);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      void nextEngine.destroy();
    };
  }, [file]);

  const toggle = (page: number) => {
    const next = selectedPages.includes(page)
      ? selectedPages.filter((candidate) => candidate !== page)
      : [...selectedPages, page].sort((left, right) => left - right);
    onChange(next);
  };

  if (failed) {
    return (
      <Card className="border-accent bg-accent-soft p-5 text-sm text-ink" role="alert">
        <div className="flex gap-3"><FileWarning className="size-5 shrink-0" /><p>Halaman PDF tidak dapat dibaca. Pilih PDF lain yang valid.</p></div>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="font-display text-2xl font-medium text-ink">Pilih halaman untuk dipisahkan</h2>
          <p className="mt-1 text-sm text-muted">
            {pageCount ? `${selectedPages.length} dari ${pageCount} halaman dipilih. Setiap halaman menjadi satu PDF.` : "Membaca halaman PDF…"}
          </p>
        </div>
        {pageCount ? (
          <div className="flex gap-2">
            <Button type="button" variant="secondary" className="px-3" onClick={() => onChange(Array.from({ length: pageCount }, (_, index) => index + 1))}>Pilih semua</Button>
            <Button type="button" variant="ghost" className="px-3" onClick={() => onChange([])} disabled={!selectedPages.length}>Bersihkan</Button>
          </div>
        ) : null}
      </div>
      <div ref={scroller} className="overflow-x-auto p-4" aria-label="Pilihan halaman PDF">
        <div className="relative h-[196px]" style={{ width: virtualizer.getTotalSize() }}>
          {engine ? virtualizer.getVirtualItems().map((item) => (
            <div key={item.key} className="absolute left-0 top-0 pr-4" style={{ transform: `translateX(${item.start}px)` }}>
              <PageChoice engine={engine} pageNumber={item.index + 1} selected={selectedPages.includes(item.index + 1)} onToggle={() => toggle(item.index + 1)} />
            </div>
          )) : null}
        </div>
      </div>
    </Card>
  );
}
