import type { RegisteredFont } from "@pdf-studio/api-client";
import type { PdfTextRun, PdfVectorRule, ViewablePdfEngine } from "@pdf-studio/pdf-engine";
import { useCallback, useEffect, useRef, useState } from "react";
import { flipY, fontStack } from "./geometry";
import { ObjectLayer } from "./object-layer";
import {
  analyzeBackground,
  coverBoxFor,
  detectedTargets,
  hitDetected,
  inkColorFor,
  matchFont,
  pickableRuns,
  ruleCoverBox,
  type CoverBox,
  type DetectedTarget,
} from "./retype";
import { hitTest, objectsOnPage, useOverlayStore } from "./store";
import {
  DEFAULT_FONT_SIZE,
  DEFAULT_STROKE_WIDTH,
  DEFAULT_TEXT_COLOR,
  type OverlayObject,
  type OverlayPoint,
  type TextObject,
} from "./types";

/** A click that never moves should not leave a zero-sized object behind. */
const MIN_DRAW_SIZE = 4;

type Gesture =
  | { mode: "idle" }
  | { mode: "move"; id: string; last: OverlayPoint; moved: boolean }
  | { mode: "create"; origin: OverlayPoint }
  | { mode: "pan"; lastX: number; lastY: number };

export function EditorCanvas({
  engine,
  page,
  pageWidth,
  pageHeight,
  scale,
  fonts,
  activeColor,
  showHints,
  onNotice,
  onPan,
}: {
  engine: ViewablePdfEngine;
  page: number;
  pageWidth: number;
  pageHeight: number;
  scale: number;
  fonts: RegisteredFont[];
  activeColor: string;
  showHints: boolean;
  onNotice: (message: string | null) => void;
  onPan: (deltaX: number, deltaY: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  // The last completed render, kept so a pick can read the pixels behind it.
  const bufferRef = useRef<HTMLCanvasElement>(null);
  const [targets, setTargets] = useState<DetectedTarget[]>([]);
  const [hovered, setHovered] = useState<DetectedTarget | null>(null);
  const [gesture, setGesture] = useState<Gesture>({ mode: "idle" });
  const [draft, setDraft] = useState<OverlayObject | null>(null);
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);

  const objects = useOverlayStore((state) => state.objects);
  const selectedId = useOverlayStore((state) => state.selectedId);
  const tool = useOverlayStore((state) => state.tool);
  const select = useOverlayStore((state) => state.select);
  const add = useOverlayStore((state) => state.add);
  const addMany = useOverlayStore((state) => state.addMany);
  const setTool = useOverlayStore((state) => state.setTool);
  const update = useOverlayStore((state) => state.update);
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

  // Printed text and rules are detected as soon as a page opens, so clicking
  // one works straight away instead of behind a mode switch.
  useEffect(() => {
    let active = true;
    setTargets([]);
    setHovered(null);
    void Promise.all([engine.getTextRuns(page), engine.getVectorRules(page)])
      .then(([runs, rules]: [PdfTextRun[], PdfVectorRule[]]) => {
        if (!active) return;
        setTargets(detectedTargets(pickableRuns(runs), rules));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [engine, page]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.code !== "Space" || (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      event.preventDefault();
      setSpaceHeld(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpaceHeld(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

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

  /**
   * Reads the page pixels behind a patch: the surrounding background colour,
   * whether that background is flat, and the ink colour of what is covered.
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

  /** Takes over a printed element: covers it, then puts an editable copy on top. */
  const takeOver = useCallback((target: DetectedTarget) => {
    const box = target.kind === "run" ? coverBoxFor(target.run) : ruleCoverBox(target.rule);
    const { background, ink, uniform } = sampleRegion(box);
    const cover: OverlayObject = {
      id: crypto.randomUUID(), kind: "rectangle", page,
      x: box.x, y: box.y, width: box.width, height: box.height,
      stroke: background, strokeWidth: 0, fill: background,
      opacity: 1, rotation: box.rotation,
    };
    const replacement: OverlayObject = target.kind === "run"
      ? {
          id: crypto.randomUUID(), kind: "text", page, text: target.run.text,
          x: target.run.x, y: target.run.y, fontSize: target.run.fontSize,
          font: matchFont(target.run.fontFamily, fonts), color: ink,
          align: "left", opacity: 1, rotation: target.run.rotation,
          coverWidth: box.width,
        }
      : {
          id: crypto.randomUUID(), kind: "line", page,
          points: [{ x: target.rule.x1, y: target.rule.y1 }, { x: target.rule.x2, y: target.rule.y2 }],
          stroke: ink, strokeWidth: Math.max(target.rule.thickness, 0.5),
          opacity: 1, rotation: 0,
        };
    if (!addMany([cover, replacement])) return null;
    onNotice(
      uniform
        ? null
        : "Latar di belakang elemen ini tidak rata, jadi tambalannya akan terlihat. Periksa hasilnya sebelum menyimpan.",
    );
    return replacement;
  }, [addMany, fonts, onNotice, page, sampleRegion]);

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

  const panning = tool === "hand" || spaceHeld;

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    setEditing(null);
    if (panning) {
      event.currentTarget.setPointerCapture(event.pointerId);
      setGesture({ mode: "pan", lastX: event.clientX, lastY: event.clientY });
      return;
    }
    const point = toPdf(event.clientX, event.clientY);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === "select") {
      const hit = hitTest(objects, page, point.x, point.y);
      if (hit) {
        select(hit.id);
        setGesture({ mode: "move", id: hit.id, last: point, moved: false });
        return;
      }
      // Nothing of ours here: take over whatever the page itself printed.
      const printed = hitDetected(targets, point.x, point.y);
      if (printed) {
        const created = takeOver(printed);
        if (created) setGesture({ mode: "move", id: created.id, last: point, moved: false });
        return;
      }
      // Empty space drags the page, which is what a bare drag means everywhere else.
      select(null);
      setGesture({ mode: "pan", lastX: event.clientX, lastY: event.clientY });
      return;
    }
    if (tool === "text") {
      const created: TextObject = {
        id: crypto.randomUUID(), kind: "text", page, text: "Teks baru",
        x: point.x, y: point.y, fontSize: DEFAULT_FONT_SIZE, font: "",
        color: activeColor || DEFAULT_TEXT_COLOR, align: "left", opacity: 1, rotation: 0,
      };
      if (add(created)) {
        setTool("select");
        setEditing({ id: created.id, value: created.text });
      }
      return;
    }
    const next = startDraft(point);
    if (!next) return;
    setDraft(next);
    setGesture({ mode: "create", origin: point });
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (gesture.mode === "idle") {
      if (tool === "select" && !panning) {
        const point = toPdf(event.clientX, event.clientY);
        setHovered(hitTest(objects, page, point.x, point.y) ? null : hitDetected(targets, point.x, point.y));
      } else if (hovered) {
        setHovered(null);
      }
      return;
    }
    if (gesture.mode === "pan") {
      onPan(gesture.lastX - event.clientX, gesture.lastY - event.clientY);
      setGesture({ mode: "pan", lastX: event.clientX, lastY: event.clientY });
      return;
    }
    const point = toPdf(event.clientX, event.clientY);
    if (gesture.mode === "move") {
      if (!gesture.moved) commit();
      move(gesture.id, point.x - gesture.last.x, point.y - gesture.last.y);
      setGesture({ ...gesture, last: point, moved: true });
      return;
    }
    setDraft((current) => {
      if (!current) return current;
      if (current.kind === "draw") return { ...current, points: [...current.points, point] };
      if (current.kind === "line") return { ...current, points: [gesture.origin, point] };
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
    if (gesture.mode === "create" && draft && isLargeEnough(draft)) add(draft);
    setDraft(null);
    setGesture({ mode: "idle" });
  };

  const handleDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const point = toPdf(event.clientX, event.clientY);
    const hit = hitTest(objects, page, point.x, point.y);
    if (hit?.kind === "text") setEditing({ id: hit.id, value: hit.text });
  };

  const editingObject = editing
    ? (objects.find((object) => object.id === editing.id) as TextObject | undefined)
    : undefined;

  const cursor = panning
    ? gesture.mode === "pan" ? "grabbing" : "grab"
    : tool === "select"
      ? hovered ? "pointer" : "default"
      : "crosshair";

  return (
    <div className="relative inline-block shadow-[0_2px_12px_rgba(0,0,0,.10)]" style={{ width: pageWidth * scale, height: pageHeight * scale }}>
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
        onPointerLeave={() => setHovered(null)}
        onDoubleClick={handleDoubleClick}
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
        <svg
          viewBox={`0 0 ${pageWidth} ${pageHeight}`}
          width={pageWidth * scale}
          height={pageHeight * scale}
          className="pointer-events-none absolute left-0 top-0"
          aria-hidden="true"
        >
          {(showHints ? targets : hovered ? [hovered] : []).map((target, index) => (
            <rect
              key={`hint-${index}-${target.box.x}-${target.box.y}`}
              x={target.box.x}
              y={flipY(target.box.y + target.box.height, pageHeight)}
              width={target.box.width}
              height={Math.max(target.box.height, 4 / scale)}
              transform={target.box.rotation ? `rotate(${-target.box.rotation} ${target.box.x + target.box.width / 2} ${flipY(target.box.y + target.box.height / 2, pageHeight)})` : undefined}
              className={target === hovered ? "fill-[#2563eb]/20 stroke-[#2563eb]" : "fill-[#2563eb]/8 stroke-[#2563eb]/40"}
              strokeWidth={0.6 / scale}
            />
          ))}
        </svg>
      </div>

      {editingObject ? (
        <input
          autoFocus
          value={editing?.value ?? ""}
          aria-label="Ubah teks di kanvas"
          onChange={(event) => setEditing({ id: editingObject.id, value: event.target.value })}
          onBlur={() => {
            update(editingObject.id, { text: editing?.value?.trim() || editingObject.text });
            setEditing(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") setEditing(null);
            event.stopPropagation();
          }}
          className="absolute z-20 rounded border-2 border-accent bg-white/95 px-1 outline-none"
          style={{
            left: editingObject.x * scale,
            // Sit the box on the baseline, where the glyphs actually rest.
            top: (flipY(editingObject.y, pageHeight) - editingObject.fontSize * 0.82) * scale,
            minWidth: Math.max(80, (editingObject.coverWidth ?? 120) * scale),
            fontSize: editingObject.fontSize * scale,
            fontFamily: fontStack(editingObject.font, fonts),
            color: editingObject.color,
            lineHeight: 1.15,
          }}
        />
      ) : null}
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
