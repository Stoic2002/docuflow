import type { RegisteredFont } from "@pdf-studio/api-client";
import type { ViewablePdfEngine } from "@pdf-studio/pdf-engine";
import { useCallback, useEffect, useRef, useState } from "react";
import { ObjectLayer } from "./object-layer";
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
}: {
  engine: ViewablePdfEngine;
  page: number;
  pageWidth: number;
  pageHeight: number;
  scale: number;
  fonts: RegisteredFont[];
  activeFont: string;
  activeColor: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [gesture, setGesture] = useState<Gesture>({ mode: "idle" });
  const [draft, setDraft] = useState<OverlayObject | null>(null);
  const objects = useOverlayStore((state) => state.objects);
  const selectedId = useOverlayStore((state) => state.selectedId);
  const tool = useOverlayStore((state) => state.tool);
  const select = useOverlayStore((state) => state.select);
  const add = useOverlayStore((state) => state.add);
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
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [engine, page, scale, pageWidth, pageHeight]);

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
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (gesture.mode === "create" && draft) {
      if (isLargeEnough(draft)) add(draft);
    }
    setDraft(null);
    setGesture({ mode: "idle" });
  };

  const cursor = tool === "select" ? "default" : "crosshair";
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
