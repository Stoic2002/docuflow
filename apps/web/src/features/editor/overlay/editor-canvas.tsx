import type { RegisteredFont } from "@pdf-studio/api-client";
import type { PdfTextRun, PdfVectorRule, ViewablePdfEngine } from "@pdf-studio/pdf-engine";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRegisteredFonts } from "./font-loading";
import { baselineOffset, caretIndexAt, flipY, fontStack, textLayout } from "./geometry";
import { fromEditorChrome } from "./keyboard";
import { ObjectLayer } from "./object-layer";
import { colorSpans } from "./ink-spans";
import {
  analyzeBackground,
  coverBoxFor,
  detectedTargets,
  hitDetected,
  inkColorFor,
  matchFont,
  pickableRuns,
  ruleCoverBox,
  sampledInk,
  type CoverBox,
  type DetectedTarget,
} from "./retype";
import {
  HANDLE_CURSOR, gripRole, gripShape, gripsFor, handleCenter, ringStrips, scaleGroupPatches,
  unionBounds, wrapPatches, type ScaleHandle,
} from "./scale";
import { objectsOnPage, pickAt, useOverlayStore } from "./store";
import {
  DEFAULT_FONT_SIZE,
  DEFAULT_STROKE_WIDTH,
  DEFAULT_TEXT_COLOR,
  HIGHLIGHT_COLOR,
  HIGHLIGHT_OPACITY,
  MAX_TEXT_LENGTH,
  LINE_HEIGHT,
  MIN_DRAW_SIZE,
  boundsOf,
  setTextLayout,
  textLayoutOf,
  type OverlayObject,
  type OverlayPoint,
  type TextObject,
} from "./types";

type Gesture =
  | { mode: "idle" }
  | { mode: "move"; id: string; last: OverlayPoint; moved: boolean }
  | { mode: "create"; origin: OverlayPoint }
  | { mode: "pan"; lastX: number; lastY: number }
  // The selection is captured as it stood when the drag began, and every move
  // rescales that snapshot by the total travel since. Reading the live objects
  // instead — with only the travel of a single move — kept rewriting the same
  // near-original size, which is what made resizing feel stuck.
  | {
      mode: "scale";
      /** "wrap" sets the width of a text box; "size" changes the geometry. */
      intent: "size" | "wrap";
      handle: ScaleHandle;
      members: OverlayObject[];
      origin: OverlayPoint;
      moved: boolean;
    };

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
  // Text already taken over is no longer a printed target, so without this it
  // answered to nothing at all when the pointer came back to it.
  const [hoveredOwn, setHoveredOwn] = useState<string | null>(null);
  const [gesture, setGesture] = useState<Gesture>({ mode: "idle" });
  const [draft, setDraft] = useState<OverlayObject | null>(null);
  // `openedWith` is the text as it stood when the editor opened: if the object
  // was cut into pieces underneath, committing the whole string back would undo
  // the cut.
  const [editing, setEditing] = useState<{ id: string; value: string; openedWith: string } | null>(null);
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
  const setTextRange = useOverlayStore((state) => state.setTextRange);
  const revision = useOverlayStore((state) => state.revision);

  // The backing store is oversampled for sharpness while CSS fixes the layout
  // size, which is set up front so the page never jumps as a render resolves.
  // During a pinch the previous bitmap is merely stretched and the expensive
  // PDF.js re-render is debounced until the zoom settles — the same technique
  // PDF.js's own viewer uses to keep continuous zoom smooth.
  const lastSharpScaleRef = useRef<number | null>(null);
  const sharpTimerRef = useRef<number | undefined>(undefined);
  const previousPageRef = useRef(page);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.style.width = `${pageWidth * scale}px`;
    canvas.style.height = `${pageHeight * scale}px`;
    let cancelled = false;
    const renderSharp = () => {
      const density = window.devicePixelRatio || 1;
      const buffer = window.document.createElement("canvas");
      void engine
        .renderPageAtScale(page, buffer, scale * density)
        .then(() => {
          if (cancelled) return;
          canvas.width = buffer.width;
          canvas.height = buffer.height;
          canvas.getContext("2d")?.drawImage(buffer, 0, 0);
          bufferRef.current = buffer;
        })
        .catch(() => undefined);
    };
    if (previousPageRef.current !== page) {
      previousPageRef.current = page;
      lastSharpScaleRef.current = null;
    }
    const settled = lastSharpScaleRef.current == null || Math.abs(scale - lastSharpScaleRef.current) < 0.02;
    if (settled) {
      renderSharp();
      lastSharpScaleRef.current = scale;
    } else {
      window.clearTimeout(sharpTimerRef.current);
      sharpTimerRef.current = window.setTimeout(() => {
        if (cancelled) return;
        renderSharp();
        lastSharpScaleRef.current = scale;
      }, 180);
    }
    return () => {
      cancelled = true;
      window.clearTimeout(sharpTimerRef.current);
    };
  }, [engine, page, scale, pageWidth, pageHeight]);

  // Bounds are only as good as the width they assume for a string, so the
  // faces the document uses are pulled from the API and measured for real.
  // A newly arrived face changes those widths, hence the re-install.
  const fontsReady = useRegisteredFonts(
    fonts,
    objects.flatMap((object) => (object.kind === "text" ? [object.font] : [])),
  );
  useEffect(() => {
    setTextLayout(textLayout(fonts));
    return () => setTextLayout(null);
  }, [fonts, fontsReady]);

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
      if (event.code !== "Space" || fromEditorChrome(event)) return;
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

  // Canva-style type-through: a selected text object can be typed into
  // directly, no second click needed. Enter switches to the caret editor for
  // precise positioning; one history snapshot covers each typing burst.
  const typingRef = useRef(false);
  useEffect(() => {
    typingRef.current = false;
  }, [selectedId]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (editing || tool !== "select" || !selectedId || fromEditorChrome(event)) return;
      const object = objects.find((item) => item.id === selectedId && item.page === page);
      if (!object || object.kind !== "text") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Enter") {
        event.preventDefault();
        setEditing({ id: object.id, value: object.text, openedWith: object.text });
        return;
      }
      if (event.key === "Escape") {
        select(null);
        return;
      }
      if (event.key === "Backspace") {
        event.preventDefault();
        if (!typingRef.current) commit();
        typingRef.current = true;
        update(object.id, { text: object.text.slice(0, -1) }, { history: false });
        return;
      }
      if (event.key.length === 1) {
        event.preventDefault();
        if (!typingRef.current) commit();
        typingRef.current = true;
        update(object.id, { text: (object.text + event.key).slice(0, MAX_TEXT_LENGTH) }, { history: false });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [objects, selectedId, tool, page, editing, select, update, commit]);

  const firstRevision = useRef(revision);
  useEffect(() => {
    if (revision === firstRevision.current) return;
    firstRevision.current = revision;
    setEditing(null);
  }, [revision]);

  // The selection inside the editor is what a style change acts on, so the rest
  // of the editor has to be able to see it.
  useEffect(() => {
    if (!editing) setTextRange(null);
  }, [editing, setTextRange]);

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

  /**
   * The ink inside part of a box, used to see where a run changes colour. The
   * slice is given in points from the box's left edge.
   */
  const sampleInkSlice = useCallback((box: CoverBox, background: string, from: number, to: number) => {
    const buffer = bufferRef.current;
    const context = buffer?.getContext("2d", { willReadFrequently: true });
    if (!buffer || !context || to <= from) return null;
    const factor = buffer.width / pageWidth;
    const left = Math.max(0, Math.floor((box.x + from) * factor));
    const top = Math.max(0, Math.floor(flipY(box.y + box.height, pageHeight) * factor));
    const width = Math.min(buffer.width - left, Math.max(1, Math.ceil((to - from) * factor)));
    const height = Math.min(buffer.height - top, Math.ceil(box.height * factor));
    if (width <= 0 || height <= 0) return null;
    const region = context.getImageData(left, top, width, height);
    return sampledInk(region.data, width, height, { x: 0, y: 0, width, height }, background);
  }, [pageHeight, pageWidth]);

  /** The patch that hides a printed element, coloured like the page behind it. */
  const patchFor = useCallback((box: CoverBox, background: string, groupId: string): OverlayObject => ({
    id: crypto.randomUUID(), kind: "rectangle", page,
    x: box.x, y: box.y, width: box.width, height: box.height,
    stroke: background, strokeWidth: 0, fill: background,
    // Pinned: it hides printed text at a fixed spot, so only the replacement
    // above it moves and resizes.
    opacity: 1, rotation: box.rotation, groupId, pinned: true,
  }), [page]);

  /**
   * Takes over one printed fragment: covers it, then puts an editable copy on
   * top. Reading whole paragraphs out of the geometry was tried and dropped —
   * the grouping guessed wrong often enough that a click stopped being
   * predictable, and a fragment is what the file actually says.
   */
  const takeOverRun = useCallback((run: PdfTextRun) => {
    const box = coverBoxFor(run);
    const { background, ink, uniform } = sampleRegion(box);
    const groupId = crypto.randomUUID();
    const base: TextObject = {
      id: crypto.randomUUID(), kind: "text", page, text: run.text,
      x: run.x, y: run.y, fontSize: run.fontSize,
      // The declared emphasis is used only when the file really carries it;
      // otherwise the name decides, which is the usual case.
      font: matchFont(run.fontFamily, fonts, declaredStyle(run)),
      color: ink,
      align: "left", opacity: 1, rotation: run.rotation,
      coverWidth: box.width, groupId,
    };
    // A fragment can hold more than one colour, since a PDF changes ink with a
    // graphics operator rather than by starting a new run. Where it does, it
    // becomes one object per colour instead of one repainted the same all over.
    const spans = colorSpans(
      run.text,
      characterOffsets(base, run.width),
      (from, to) => sampleInkSlice(box, background, from, to),
      ink,
    );
    const replacements: OverlayObject[] = spans.map((span, index) => ({
      ...base,
      id: index === 0 ? base.id : crypto.randomUUID(),
      text: span.text,
      x: run.x + span.offset,
      color: span.color,
      // Only a whole run stands in for the patch beneath it; a piece of one
      // would raise a false overflow warning.
      coverWidth: spans.length === 1 ? box.width : undefined,
    }));
    const replacement = replacements[0];
    if (!addMany([patchFor(box, background, groupId), ...replacements])) return null;
    onNotice(
      uniform
        ? null
        : "Latar di belakang elemen ini tidak rata, jadi tambalannya akan terlihat. Periksa hasilnya sebelum menyimpan.",
    );
    return replacement;
  }, [addMany, fonts, onNotice, page, patchFor, sampleInkSlice, sampleRegion]);

  /** Takes over a printed rule: covers it, then puts an editable line on top. */
  const takeOverRule = useCallback((rule: PdfVectorRule) => {
    const box = ruleCoverBox(rule);
    const { background, ink, uniform } = sampleRegion(box);
    const groupId = crypto.randomUUID();
    const replacement: OverlayObject = {
      id: crypto.randomUUID(), kind: "line", page,
      points: [{ x: rule.x1, y: rule.y1 }, { x: rule.x2, y: rule.y2 }],
      stroke: ink, strokeWidth: Math.max(rule.thickness, 0.5),
      opacity: 1, rotation: 0, groupId,
    };
    if (!addMany([patchFor(box, background, groupId), replacement])) return null;
    onNotice(
      uniform
        ? null
        : "Latar di belakang elemen ini tidak rata, jadi tambalannya akan terlihat. Periksa hasilnya sebelum menyimpan.",
    );
    return replacement;
  }, [addMany, onNotice, page, patchFor, sampleRegion]);

  const startDraft = (origin: OverlayPoint): OverlayObject | null => {
    const shared = { id: crypto.randomUUID(), page, opacity: 1, rotation: 0 };
    switch (tool) {
      case "rectangle":
      case "ellipse":
        return { ...shared, kind: tool, x: origin.x, y: origin.y, width: 0, height: 0, stroke: activeColor, strokeWidth: DEFAULT_STROKE_WIDTH, fill: null };
      case "line":
        return { ...shared, kind: "line", points: [origin, origin], stroke: activeColor, strokeWidth: DEFAULT_STROKE_WIDTH };
      case "arrow":
        return { ...shared, kind: "line", points: [origin, origin], stroke: activeColor, strokeWidth: DEFAULT_STROKE_WIDTH, arrow: true };
      case "draw":
        return { ...shared, kind: "draw", points: [origin], stroke: activeColor, strokeWidth: DEFAULT_STROKE_WIDTH };
      default:
        return null;
    }
  };

  const panning = tool === "hand" || spaceHeld;

  // Opening the editor also places the caret where the click landed, so typing
  // continues from there rather than always appending at the end.
  const caretRef = useRef<number | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const openTextEditor = (object: TextObject, pdfX: number, pdfY: number) => {
    const layout = textLayoutOf(object);
    const family = fontStack(object.font, fonts);
    // Which line was clicked, counting down from the first baseline.
    const step = object.fontSize * LINE_HEIGHT;
    const index = Math.min(
      layout.lines.length - 1,
      Math.max(0, Math.floor((object.y + object.fontSize * 0.78 - pdfY) / step)),
    );
    // The lines were split on spaces, so each one costs its length plus the
    // space that joined it to the next.
    const before = layout.lines.slice(0, index).reduce((total, line) => total + line.length + 1, 0);
    caretRef.current = before + caretIndexAt(layout.lines[index], object.fontSize, family, pdfX - boundsOf(object).x);
    setEditing({ id: object.id, value: object.text, openedWith: object.text });
  };
  useEffect(() => {
    const node = editorRef.current;
    const caret = caretRef.current;
    caretRef.current = null;
    if (!node || caret === null) return;
    node.setSelectionRange(caret, caret);
  }, [editing?.id]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // Middle-button drag pans from anywhere — over objects and empty space
    // alike — matching how every canvas tool behaves.
    if (event.button === 1) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setGesture({ mode: "pan", lastX: event.clientX, lastY: event.clientY });
      return;
    }
    if (event.button !== 0) return;
    setEditing(null);
    if (panning) {
      event.currentTarget.setPointerCapture(event.pointerId);
      setGesture({ mode: "pan", lastX: event.clientX, lastY: event.clientY });
      return;
    }
    const point = toPdf(event.clientX, event.clientY);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === "highlight") {
      const printed = hitDetected(targets, point.x, point.y);
      if (!printed) return;
      const box = printed.kind === "run" ? coverBoxFor(printed.run) : ruleCoverBox(printed.rule);
      add({
        id: crypto.randomUUID(), kind: "rectangle", page,
        x: box.x, y: box.y, width: box.width, height: box.height,
        stroke: HIGHLIGHT_COLOR, strokeWidth: 0, fill: HIGHLIGHT_COLOR,
        opacity: HIGHLIGHT_OPACITY, rotation: box.rotation,
      });
      return;
    }
    if (tool === "select") {
      const hit = pickAt(objects, page, point.x, point.y);
      if (hit) {
        select(hit.id);
        setGesture({ mode: "move", id: hit.id, last: point, moved: false });
        return;
      }
      // Nothing of ours here: take over whatever the page itself printed.
      const printed = hitDetected(targets, point.x, point.y);
      if (printed) {
        const created = printed.kind === "run" ? takeOverRun(printed.run) : takeOverRule(printed.rule);
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
        setEditing({ id: created.id, value: created.text, openedWith: created.text });
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
      if ((tool === "select" || tool === "highlight") && !panning) {
        const point = toPdf(event.clientX, event.clientY);
        const ours = tool === "select" ? pickAt(objects, page, point.x, point.y) : null;
        setHoveredOwn(ours?.id ?? null);
        setHovered(ours ? null : hitDetected(targets, point.x, point.y));
      } else if (hovered || hoveredOwn) {
        setHovered(null);
        setHoveredOwn(null);
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
    if (gesture.mode === "scale") {
      if (!gesture.moved) commit();
      const patches = gesture.intent === "wrap"
        ? wrapPatches(gesture.members, gesture.handle, point.x - gesture.origin.x)
        : scaleGroupPatches(gesture.members, gesture.handle, point.x - gesture.origin.x, point.y - gesture.origin.y);
      for (const [memberId, patch] of patches) {
        update(memberId, patch, { history: false });
      }
      setGesture({ ...gesture, moved: true });
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
    // A press that never travelled is a click, not a drag: on text that means
    // "edit this", so the caret opens right there instead of behind a second
    // click. Dragging in the same motion still moves the object.
    if (gesture.mode === "move" && !gesture.moved) {
      const object = objects.find((item) => item.id === gesture.id);
      if (object?.kind === "text") {
        const point = toPdf(event.clientX, event.clientY);
        openTextEditor(object, point.x, point.y);
      }
    }
    setDraft(null);
    setGesture({ mode: "idle" });
  };

  const handleDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const point = toPdf(event.clientX, event.clientY);
    const hit = pickAt(objects, page, point.x, point.y);
    if (hit?.kind === "text") openTextEditor(hit, point.x, point.y);
  };

  const beginMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const selected = objects.find((object) => object.id === selectedId && object.page === page);
    if (!selected || event.button !== 0 || gesture.mode !== "idle") return;
    event.stopPropagation();
    // Keeping the default away leaves the caret editor focused while dragging.
    event.preventDefault();
    surfaceRef.current?.setPointerCapture(event.pointerId);
    setGesture({ mode: "move", id: selected.id, last: toPdf(event.clientX, event.clientY), moved: false });
  };

  const beginScale = (handle: ScaleHandle, event: React.PointerEvent<HTMLDivElement>) => {
    const selected = objects.find((object) => object.id === selectedId && object.page === page);
    if (!selected || gesture.mode !== "idle") return;
    event.stopPropagation();
    event.preventDefault();
    // A retype pair scales as one unit; anything else scales on its own.
    const members = selected.groupId
      ? objects.filter((object) => object.groupId === selected.groupId && !object.pinned)
      : [selected];
    // Capture on the surface so the existing move/up handlers drive the drag.
    surfaceRef.current?.setPointerCapture(event.pointerId);
    // A side handle on text reflows it; on anything else it stretches the one
    // axis it sits on. Corners resize.
    const reflows = gripRole(handle) === "side" && members.every((member) => member.kind === "text");
    setGesture({
      mode: "scale",
      intent: reflows ? "wrap" : "size",
      handle,
      members,
      origin: toPdf(event.clientX, event.clientY),
      moved: false,
    });
  };

  const editingObject = editing
    ? (objects.find((object) => object.id === editing.id) as TextObject | undefined)
    : undefined;

  // Canva-style grips: shown for the selected object while the select tool is
  // active, and kept up during typing so text can be edited and resized in one
  // go. Freehand paths stay excluded — their points do not scale cleanly.
  const selectedObject = tool === "select" && !panning && gesture.mode !== "create"
    ? objects.find((object) => object.id === selectedId && object.page === page)
    : undefined;
  // While the caret editor is open the stored text is one keystroke behind what
  // the user sees, so the frame is measured against the value being typed.
  const withLiveText = (object: OverlayObject): OverlayObject =>
    editing && object.id === editing.id && object.kind === "text" ? { ...object, text: editing.value } : object;
  // A retype pair resizes as a unit, so the frame has to enclose the whole
  // group; drawing it around the hit member alone left the grips off the mark.
  const selection = (selectedObject
    ? selectedObject.groupId
      ? objects.filter((object) => object.groupId === selectedObject.groupId && object.page === page && !object.pinned)
      : [selectedObject]
    : []
  ).map(withLiveText);
  // Freehand paths get the frame but no grips: scaling their points cleanly is
  // another problem, and without a frame a selected scribble looks unselected.
  const frame = selectedObject ? unionBounds(selection) : null;
  // Edge grips would stretch a retype pair non-uniformly and distort its text,
  // so groups containing text get corner grips only.
  const groupHasText = selection.some((object) => object.kind === "text");

  const hoveredBox = hovered?.box ?? null;
  // Everything that travels with the hovered object, so a retype pair lights up
  // as the single thing it behaves like.
  const hoveredObject = hoveredOwn && hoveredOwn !== selectedId
    ? objects.find((object) => object.id === hoveredOwn && object.page === page)
    : undefined;
  const hoveredFrame = hoveredObject
    ? unionBounds(
        hoveredObject.groupId
          ? objects.filter((object) => object.groupId === hoveredObject.groupId && object.page === page && !object.pinned)
          : [hoveredObject],
      )
    : null;

  const cursor = panning
    ? gesture.mode === "pan" ? "grabbing" : "grab"
    : tool === "select" || tool === "highlight"
      ? hoveredOwn ? "move" : hovered ? "pointer" : "default"
      : "crosshair";

  return (
    // `z-0` is deliberate: it makes the page its own stacking context, so the
    // frame, grips, and caret editor inside stack against each other and stay
    // under the editor's own chrome. Without it their z-indexes competed with
    // the toolbars and a selection near the edge drew straight over them.
    <div className="relative z-0 inline-block shadow-[0_2px_12px_rgba(0,0,0,.10)]" style={{ width: pageWidth * scale, height: pageHeight * scale }}>
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
        onPointerLeave={() => {
          setHovered(null);
          setHoveredOwn(null);
        }}
        onDoubleClick={handleDoubleClick}
      >
        <ObjectLayer
          objects={objectsOnPage(objects, page)}
          pageWidth={pageWidth}
          pageHeight={pageHeight}
          scale={scale}
          fonts={fonts}
          draft={draft}
          hiddenId={editing?.id}
        />
        {hoveredFrame ? (
          <div
            className="pointer-events-none absolute z-20 rounded-[2px] border border-accent/45"
            style={{
              left: hoveredFrame.x * scale,
              top: flipY(hoveredFrame.y + hoveredFrame.height, pageHeight) * scale,
              width: hoveredFrame.width * scale,
              height: hoveredFrame.height * scale,
            }}
          />
        ) : null}
        {frame && selectedObject ? (
          <>
            <div
              className="pointer-events-none absolute z-30 border border-accent"
              style={{
                left: frame.x * scale,
                top: flipY(frame.y + frame.height, pageHeight) * scale,
                width: frame.width * scale,
                height: frame.height * scale,
              }}
            />
            {/* A ring just outside the frame drags the selection. The glyphs
                themselves belong to the caret editor while typing, so the box
                border is what stays grabbable. */}
            {ringStrips(frame, pageHeight, scale).map(({ edge, style }) => (
              <div
                key={`move-${edge}`}
                role="presentation"
                aria-hidden="true"
                onPointerDown={beginMove}
                className="absolute z-30"
                style={{ ...style, cursor: "move", touchAction: "none" }}
              />
            ))}
            {gripsFor({
              kind: selectedObject.kind,
              hasText: groupHasText,
              widthPx: frame.width * scale,
              heightPx: frame.height * scale,
            }).map((handle) => {
              const { width, height } = gripShape(handle);
              const { x: cx, y: cyPdf } = handleCenter(handle, frame);
              const role = gripRole(handle);
              return (
                <div
                  key={handle}
                  role="separator"
                  aria-label={role === "side" ? `Ubah lebar ${handle}` : `Ubah ukuran ${handle}`}
                  onPointerDown={(event) => beginScale(handle, event)}
                  className="absolute z-30 rounded-full border border-accent bg-paper shadow-sm"
                  style={{
                    left: cx * scale - width / 2,
                    top: flipY(cyPdf, pageHeight) * scale - height / 2,
                    width,
                    height,
                    cursor: HANDLE_CURSOR[handle],
                    touchAction: "none",
                  }}
                />
              );
            })}
          </>
        ) : null}
        <svg
          viewBox={`0 0 ${pageWidth} ${pageHeight}`}
          width={pageWidth * scale}
          height={pageHeight * scale}
          className="pointer-events-none absolute left-0 top-0"
          aria-hidden="true"
        >
          {(showHints || tool === "highlight" ? targets.map((target) => target.box) : []).map((box, index) => (
            <HintRect key={`hint-${index}-${box.x}-${box.y}`} box={box} pageHeight={pageHeight} scale={scale} />
          ))}
          {hoveredBox ? <HintRect box={hoveredBox} pageHeight={pageHeight} scale={scale} strong /> : null}
        </svg>
      </div>

      {editingObject ? (
        <textarea
          autoFocus
          ref={editorRef}
          rows={1}
          wrap="soft"
          value={editing?.value ?? ""}
          aria-label="Ubah teks di kanvas"
          onChange={(event) => setEditing({
            id: editingObject.id,
            value: event.target.value.replace(/[\r\n]+/g, " "),
            openedWith: editing?.openedWith ?? editingObject.text,
          })}
          onSelect={(event) => {
            const field = event.currentTarget;
            setTextRange(
              field.selectionStart === field.selectionEnd
                ? null
                : { id: editingObject.id, start: field.selectionStart, end: field.selectionEnd },
            );
          }}
          onBlur={() => {
            // Cut into pieces underneath? Then this editor is holding the text
            // of an object that no longer exists as one, and writing it back
            // would glue the pieces together again.
            if (editingObject.text === editing?.openedWith) {
              update(editingObject.id, { text: editing?.value?.trim() || editingObject.text });
            }
            setEditing(null);
          }}
          onKeyDown={(event) => {
            // The engine places runs and never reflows them, so a newline has
            // no meaning here; Enter finishes the edit instead of making one.
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
            if (event.key === "Escape") setEditing(null);
            event.stopPropagation();
          }}
          // No border, padding, or background of its own: the selection frame
          // is the box, and the glyphs must land exactly where they are drawn
          // when the editor is closed.
          className="absolute z-20 resize-none overflow-hidden border-0 bg-transparent p-0 caret-accent outline-none"
          style={{
            left: boundsOf(withLiveText(editingObject)).x * scale,
            // Sit the box so its first line lands on the very baseline the SVG
            // draws on, measured rather than guessed.
            top: flipY(editingObject.y, pageHeight) * scale
              - baselineOffset(editingObject.fontSize * scale, fontStack(editingObject.font, fonts), LINE_HEIGHT),
            // Room past the last glyph so a caret at the end stays visible.
            width: (boundsOf(withLiveText(editingObject)).width + (editingObject.boxWidth ? 0 : editingObject.fontSize * 0.25)) * scale,
            height: boundsOf(withLiveText(editingObject)).height * LINE_HEIGHT * scale,
            fontSize: editingObject.fontSize * scale,
            fontFamily: fontStack(editingObject.font, fonts),
            color: editingObject.color,
            textAlign: editingObject.align,
            lineHeight: LINE_HEIGHT,
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Where each character of a run starts, in points from its left edge. The face
 * on screen is rarely the one the file used, so the browser's advances are
 * scaled to the width the PDF itself reports — the cuts then land on the page
 * where the glyphs really are.
 */
function characterOffsets(object: TextObject, runWidth: number): number[] {
  const measured = [...object.text].map((_, index) =>
    textLayoutOf({ ...object, text: object.text.slice(0, index + 1), boxWidth: undefined }).width,
  );
  const total = measured[measured.length - 1] ?? 0;
  const factor = total > 0 && runWidth > 0 ? runWidth / total : 1;
  return [0, ...measured.map((width) => width * factor)];
}

/** Emphasis the font object stated, or nothing when it stated none. */
function declaredStyle(run: PdfTextRun): { bold: boolean; italic: boolean } | undefined {
  if (run.bold === undefined && run.italic === undefined) return undefined;
  return { bold: Boolean(run.bold), italic: Boolean(run.italic) };
}

/** The dotted outline that shows what a click would take over. */
function HintRect({ box, pageHeight, scale, strong = false }: {
  box: CoverBox;
  pageHeight: number;
  scale: number;
  strong?: boolean;
}) {
  return (
    <rect
      x={box.x}
      y={flipY(box.y + box.height, pageHeight)}
      width={box.width}
      height={Math.max(box.height, 4 / scale)}
      transform={box.rotation ? `rotate(${-box.rotation} ${box.x + box.width / 2} ${flipY(box.y + box.height / 2, pageHeight)})` : undefined}
      className={strong ? "fill-[#2563eb]/20 stroke-[#2563eb]" : "fill-[#2563eb]/8 stroke-[#2563eb]/40"}
      strokeWidth={0.6 / scale}
    />
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
