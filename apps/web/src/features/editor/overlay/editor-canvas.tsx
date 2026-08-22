import type { RegisteredFont } from "@pdf-studio/api-client";
import type { PdfTextRun, PdfVectorRule, ViewablePdfEngine } from "@pdf-studio/pdf-engine";
import { useCallback, useEffect, useRef, useState } from "react";
import { flipY } from "./geometry";
import { ObjectLayer } from "./object-layer";
import { analyzeBackground, countTableGrids, coverBoxFor, inkColorFor, matchFont, pickableRuns, ruleCoverBox, type CoverBox } from "./retype";
import { hitTest, objectsOnPage, useOverlayStore } from "./store";
import {
  DEFAULT_FONT_SIZE,
  DEFAULT_STROKE_WIDTH,
  DEFAULT_TEXT_COLOR,
  type OverlayObject,
  type OverlayPoint,
} from "./types";

/** A click that never moves should not leave a zero-sized object behind. */
const MIN_DRAW_SIZE = 4;

type Gesture =
  | { mode: "idle" }
  | { mode: "move"; id: string; last: OverlayPoint; moved: boolean }
  | { mode: "create"; origin: OverlayPoint };

export function EditorCanvas({
  engine,
  page,
  pageWidth,
  pageHeight,
  scale,
  fonts,
  activeFont,
  activeColor,
  onNotice,
}: {
  engine: ViewablePdfEngine;
  page: number;
  pageWidth: number;
  pageHeight: number;
  scale: number;
  fonts: RegisteredFont[];
  activeFont: string;
  activeColor: string;
  onNotice: (message: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  // The last completed render, kept so retype can read the pixels behind a run.
  const bufferRef = useRef<HTMLCanvasElement>(null);
  const [runs, setRuns] = useState<PdfTextRun[]>([]);
  const [rules, setRules] = useState<PdfVectorRule[]>([]);
  const [gesture, setGesture] = useState<Gesture>({ mode: "idle" });
  const [draft, setDraft] = useState<OverlayObject | null>(null);
  const objects = useOverlayStore((state) => state.objects);
  const selectedId = useOverlayStore((state) => state.selectedId);
  const tool = useOverlayStore((state) => state.tool);
  const select = useOverlayStore((state) => state.select);
  const add = useOverlayStore((state) => state.add);
  const addMany = useOverlayStore((state) => state.addMany);
  const setTool = useOverlayStore((state) => state.setTool);
  const move = useOverlayStore((state) => state.move);
  const commit = useOverlayStore((state) => state.commit);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // The backing store is oversampled for sharpness while CSS fixes the layout
    // size, which is set up front so the page never jumps as a render resolves.
    canvas.style.width = `${pageWidth * scale}px`;
    canvas.style.height = `${pageHeight * scale}px`;
    // Each render targets its own buffer and is blitted only if it is still the
    // current one, so a slow render of a page the user already left cannot
    // overwrite the page now on screen.
    let active = true;
    const density = window.devicePixelRatio || 1;
    const buffer = window.document.createElement("canvas");
    void engine
      .renderPageAtScale(page, buffer, scale * density)
      .then(() => {
        if (!active) return;
        canvas.width = buffer.width;
        canvas.height = buffer.height;
        canvas.getContext("2d")?.drawImage(buffer, 0, 0);
        bufferRef.current = buffer;
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [engine, page, scale, pageWidth, pageHeight]);

  useEffect(() => {
    if (tool !== "retype") {
      setRuns([]);
      return;
    }
    let active = true;
    void engine.getTextRuns(page).then((found) => {
      if (!active) return;
      const usable = pickableRuns(found);
      setRuns(usable);
      onNotice(
        usable.length === 0
          ? "Tidak ada teks yang dapat dipilih di halaman ini. Halaman hasil scan perlu OCR lebih dulu."
          : null,
      );
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, [engine, page, tool, onNotice]);

  useEffect(() => {
    if (tool !== "rules") {
      setRules([]);
      return;
    }
    let active = true;
    void engine.getVectorRules(page).then((found) => {
      if (!active) return;
      setRules(found);
      const grids = countTableGrids(found);
      onNotice(
        found.length === 0
          ? "Tidak ada garis lurus yang terdeteksi di halaman ini. Garis pada halaman hasil scan adalah gambar, bukan vektor, jadi tidak dapat dikenali."
          : `${found.length} garis terdeteksi${grids > 0 ? `, membentuk ${grids} tabel` : ""}. Klik salah satunya untuk menggantinya.`,
      );
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, [engine, page, tool, onNotice]);

  /**
   * Reads the page pixels behind a patch: the surrounding background colour,
   * whether that background is flat, and the ink colour of what is being
   * covered. Shared by the text and rule pickers.
   */
  const sampleRegion = useCallback((box: CoverBox) => {
    const buffer = bufferRef.current;
    const context = buffer?.getContext("2d", { willReadFrequently: true });
    const fallback = { background: "#ffffff", ink: "#111111", uniform: false };
    if (!buffer || !context) return fallback;
    const factor = buffer.width / pageWidth;
    const margin = Math.ceil(8 * factor);
    const left = Math.max(0, Math.floor(box.x * factor) - margin);
    const top = Math.max(0, Math.floor(flipY(box.y + box.height, pageHeight) * factor) - margin);
    const width = Math.min(buffer.width - left, Math.ceil(box.width * factor) + margin * 2);
    const height = Math.min(buffer.height - top, Math.ceil(box.height * factor) + margin * 2);
    if (width <= 0 || height <= 0) return fallback;
    const region = context.getImageData(left, top, width, height);
    const local = {
      x: box.x * factor - left,
      y: flipY(box.y + box.height, pageHeight) * factor - top,
      width: box.width * factor,
      height: box.height * factor,
    };
    const sample = analyzeBackground(region.data, width, height, local, Math.max(2, Math.round(factor * 2)));
    return {
      background: sample.color,
      uniform: sample.uniform,
      ink: inkColorFor(region.data, width, height, local, sample.color),
    };
  }, [pageHeight, pageWidth]);

  const replaceRule = useCallback((rule: PdfVectorRule) => {
    const box = ruleCoverBox(rule);
    const { background, ink, uniform } = sampleRegion(box);
    const added = addMany([
      {
        id: crypto.randomUUID(), kind: "rectangle", page,
        x: box.x, y: box.y, width: box.width, height: box.height,
        stroke: background, strokeWidth: 0, fill: background,
        opacity: 1, rotation: 0,
      },
      {
        id: crypto.randomUUID(), kind: "line", page,
        points: [{ x: rule.x1, y: rule.y1 }, { x: rule.x2, y: rule.y2 }],
        stroke: ink, strokeWidth: Math.max(rule.thickness, 0.5),
        opacity: 1, rotation: 0,
      },
    ]);
    if (added) {
      setTool("select");
      onNotice(
        uniform
          ? "Garis ini sekarang bisa digeser, diubah warnanya, atau dihapus lewat panel Properti."
          : "Latar di sekitar garis ini tidak rata, jadi tambalannya akan terlihat. Periksa hasilnya sebelum menyimpan.",
      );
    }
  }, [addMany, onNotice, page, sampleRegion, setTool]);

  const replaceRun = useCallback((run: PdfTextRun) => {
    const box = coverBoxFor(run);
    const { background, ink, uniform } = sampleRegion(box);
    const added = addMany([
      {
        id: crypto.randomUUID(), kind: "rectangle", page,
        x: box.x, y: box.y, width: box.width, height: box.height,
        stroke: background, strokeWidth: 0, fill: background,
        opacity: 1, rotation: box.rotation,
      },
      {
        id: crypto.randomUUID(), kind: "text", page, text: run.text,
        x: run.x, y: run.y, fontSize: run.fontSize,
        font: matchFont(run.fontFamily, fonts), color: ink,
        align: "left", opacity: 1, rotation: run.rotation,
        coverWidth: box.width,
      },
    ]);
    if (added) {
      // Hand the user straight to Select: the replacement is already the
      // selected object, so it can be retyped in the panel and dragged at once.
      setTool("select");
      onNotice(
        uniform
          ? null
          : "Latar di belakang teks ini tidak rata, jadi tambalannya akan terlihat. Periksa hasilnya sebelum menyimpan.",
      );
    }
  }, [addMany, fonts, onNotice, page, sampleRegion, setTool]);

  const toPdf = useCallback(
    (clientX: number, clientY: number): OverlayPoint => {
      const rect = surfaceRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return { x: 0, y: 0 };
      return {
        x: ((clientX - rect.left) * pageWidth) / rect.width,
        y: pageHeight - ((clientY - rect.top) * pageHeight) / rect.height,
      };
    },
    [pageWidth, pageHeight],
  );

  const startDraft = (origin: OverlayPoint): OverlayObject | null => {
    const shared = { id: crypto.randomUUID(), page, opacity: 1, rotation: 0 };
    switch (tool) {
      case "rectangle":
      case "ellipse":
        return { ...shared, kind: tool, x: origin.x, y: origin.y, width: 0, height: 0, stroke: activeColor, strokeWidth: DEFAULT_STROKE_WIDTH, fill: null };
      case "line":
        return { ...shared, kind: "line", points: [origin, origin], stroke: activeColor, strokeWidth: DEFAULT_STROKE_WIDTH };
      case "draw":
        return { ...shared, kind: "draw", points: [origin], stroke: activeColor, strokeWidth: DEFAULT_STROKE_WIDTH };
      default:
        return null;
    }
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // Retype picks are handled by the hotspots themselves. Capturing the
    // pointer here would retarget pointerup to this element and stop the
    // browser from ever synthesising a click on the hotspot.
    if (tool === "retype" || tool === "rules") return;
    const point = toPdf(event.clientX, event.clientY);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === "select") {
      const hit = hitTest(objects, page, point.x, point.y);
      select(hit?.id ?? null);
      // History is recorded on the first actual movement, so a plain click to
      // select does not leave an empty step to undo.
      if (hit) setGesture({ mode: "move", id: hit.id, last: point, moved: false });
      return;
    }
    if (tool === "text") {
      add({
        id: crypto.randomUUID(), kind: "text", page, text: "Teks baru",
        x: point.x, y: point.y, fontSize: DEFAULT_FONT_SIZE, font: activeFont,
        color: activeColor || DEFAULT_TEXT_COLOR, align: "left", opacity: 1, rotation: 0,
      });
      return;
    }
    const next = startDraft(point);
    if (!next) return;
    setDraft(next);
    setGesture({ mode: "create", origin: point });
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (gesture.mode === "idle") return;
    const point = toPdf(event.clientX, event.clientY);
    if (gesture.mode === "move") {
      if (!gesture.moved) commit();
      move(gesture.id, point.x - gesture.last.x, point.y - gesture.last.y);
      setGesture({ ...gesture, last: point, moved: true });
      return;
    }
    setDraft((current) => {
      if (!current) return current;
      if (current.kind === "draw") {
        return { ...current, points: [...current.points, point] };
      }
      if (current.kind === "line") {
        return { ...current, points: [gesture.origin, point] };
      }
      if (current.kind === "rectangle" || current.kind === "ellipse") {
        return {
          ...current,
          x: Math.min(gesture.origin.x, point.x),
          y: Math.min(gesture.origin.y, point.y),
          width: Math.abs(point.x - gesture.origin.x),
          height: Math.abs(point.y - gesture.origin.y),
        };
      }
      return current;
    });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (gesture.mode === "create" && draft) {
      if (isLargeEnough(draft)) add(draft);
    }
    setDraft(null);
    setGesture({ mode: "idle" });
  };

  const picking = tool === "retype" || tool === "rules";
  const cursor = tool === "select" ? "default" : picking ? "pointer" : "crosshair";
  return (
    <div className="relative inline-block shadow-[0_1px_0_rgba(0,0,0,.08)]" style={{ width: pageWidth * scale, height: pageHeight * scale }}>
      <canvas ref={canvasRef} className="block bg-white" />
      <div
        ref={surfaceRef}
        role="application"
        aria-label={`Kanvas edit halaman ${page}`}
        className="absolute left-0 top-0 touch-none"
        style={{ width: pageWidth * scale, height: pageHeight * scale, cursor }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <ObjectLayer
          objects={objectsOnPage(objects, page)}
          pageWidth={pageWidth}
          pageHeight={pageHeight}
          selectedId={selectedId}
          scale={scale}
          fonts={fonts}
          draft={draft}
        />
        {picking ? (
          <svg
            viewBox={`0 0 ${pageWidth} ${pageHeight}`}
            width={pageWidth * scale}
            height={pageHeight * scale}
            className="absolute left-0 top-0"
          >
            {(tool === "retype" ? runs : rules).map((target, index) => {
              const isRun = "text" in target;
              const box = isRun ? coverBoxFor(target) : ruleCoverBox(target);
              // A hairline rule needs a taller target than its own thickness.
              const height = isRun ? box.height : Math.max(box.height, 6 / scale);
              const width = isRun ? box.width : Math.max(box.width, 6 / scale);
              return (
                <rect
                  key={`${index}-${box.x}-${box.y}`}
                  x={box.x - (width - box.width) / 2}
                  y={flipY(box.y + box.height, pageHeight) - (height - box.height) / 2}
                  width={width}
                  height={height}
                  transform={box.rotation ? `rotate(${-box.rotation} ${box.x + box.width / 2} ${flipY(box.y + box.height / 2, pageHeight)})` : undefined}
                  className="cursor-pointer fill-[#2563eb]/10 stroke-[#2563eb]/60 hover:fill-[#2563eb]/25"
                  strokeWidth={0.5 / scale}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    event.preventDefault();
                    if (isRun) replaceRun(target);
                    else replaceRule(target);
                  }}
                >
                  <title>{isRun ? `Ganti teks: ${target.text}` : `Ganti garis ${target.orientation === "horizontal" ? "mendatar" : "tegak"}`}</title>
                </rect>
              );
            })}
          </svg>
        ) : null}
      </div>
    </div>
  );
}

function isLargeEnough(object: OverlayObject): boolean {
  if (object.kind === "rectangle" || object.kind === "ellipse") {
    return object.width >= MIN_DRAW_SIZE && object.height >= MIN_DRAW_SIZE;
  }
  if (object.kind === "line") {
    const [from, to] = object.points;
    return Math.hypot(to.x - from.x, to.y - from.y) >= MIN_DRAW_SIZE;
  }
  if (object.kind === "draw") return object.points.length > 2;
  return true;
}
