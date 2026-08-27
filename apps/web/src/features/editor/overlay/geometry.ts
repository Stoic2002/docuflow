import type { RegisteredFont } from "@pdf-studio/api-client";
import { type PathObject, type TextLayout, type TextObject } from "./types";

/**
 * The single conversion between PDF user space (origin bottom-left) and the
 * screen space SVG and pointer events use (origin top-left).
 */
export function flipY(y: number, pageHeight: number): number {
  return pageHeight - y;
}

/**
 * Preview font stack. The browser may not have the server's face installed, so
 * the generic fallback keeps the proportions close; the exported PDF always
 * uses the embedded font itself.
 */
export function fontStack(fontId: string, fonts: RegisteredFont[]): string {
  const font = fonts.find((entry) => entry.id === fontId);
  if (!font) return "Helvetica, Arial, sans-serif";
  const generic = font.fixed ? "monospace" : font.serif ? "serif" : "sans-serif";
  return `"${font.family}", ${generic}`;
}

/**
 * Measures a string the way the browser would draw it. The browser may not have
 * the server's font installed, so this is close rather than exact — good enough
 * to warn that replacement text has outgrown the words it covers, and never
 * used to position anything.
 */
let measuringContext: CanvasRenderingContext2D | null | undefined;

function measuring(): CanvasRenderingContext2D | null {
  if (measuringContext === undefined) {
    measuringContext = typeof document === "undefined"
      ? null
      : document.createElement("canvas").getContext("2d");
  }
  return measuringContext;
}

export function measureTextWidth(text: string, fontSize: number, family: string): number | null {
  const context = measuring();
  if (!context) return null;
  context.font = `${fontSize}px ${family}`;
  const width = context.measureText(text).width;
  return Number.isFinite(width) && width > 0 ? width : null;
}

/**
 * Where the baseline sits inside a line box, in pixels from its top.
 *
 * An SVG glyph is placed on its baseline, but text typed into a field is
 * placed inside a line box: the box is `lineHeight` tall, the glyphs occupy
 * the font's own ascent and descent within it, and the leftover space is split
 * above and below. Guessing that offset left the words a few per cent low
 * while the editor was open, so they visibly dropped on the way in and rose
 * again on the way out. This measures it instead.
 */
export function baselineOffset(fontSize: number, family: string, lineHeight: number): number {
  const leading = (fontSize * lineHeight - fontSize) / 2;
  const fallback = leading + fontSize * 0.8;
  const context = measuring();
  if (!context) return fallback;
  context.font = `${fontSize}px ${family}`;
  const metrics = context.measureText("Hg");
  const ascent = metrics.fontBoundingBoxAscent;
  const descent = metrics.fontBoundingBoxDescent;
  if (!Number.isFinite(ascent) || !Number.isFinite(descent) || ascent <= 0) return fallback;
  return (fontSize * lineHeight - (ascent + descent)) / 2 + ascent;
}

/**
 * Greedy word wrap: words are added to a line until one would overrun the box.
 * A single word wider than the box keeps its own line rather than being broken
 * mid-word, which is what a reader expects and what the exporter can place.
 */
export function wrapLines(
  text: string,
  maxWidth: number,
  measure: (value: string) => number | null,
): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(" ")) {
    const candidate = current ? `${current} ${word}` : word;
    const width = measure(candidate);
    if (width !== null && width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [text];
}

/**
 * A layout function for `setTextLayout`, bound to the faces the server
 * registered. Results are cached because bounds are recomputed on every
 * pointer move, and the cache is dropped wholesale once it grows large rather
 * than tracking ages.
 */
export function textLayout(fonts: RegisteredFont[]): (object: TextObject) => TextLayout {
  const cache = new Map<string, TextLayout>();
  return (object) => {
    const key = `${object.font}|${object.fontSize}|${object.boxWidth ?? 0}|${object.text}`;
    const hit = cache.get(key);
    if (hit) return hit;
    if (cache.size > 500) cache.clear();
    const family = fontStack(object.font, fonts);
    const measure = (value: string) => measureTextWidth(value, object.fontSize, family);
    const full = measure(object.text);
    // Without measurement there is no honest way to break a line, so the text
    // stays whole and the estimate carries the width.
    if (full === null) {
      return { lines: [object.text], width: object.boxWidth ?? object.text.length * object.fontSize * 0.52 };
    }
    const layout: TextLayout = object.boxWidth
      ? { lines: wrapLines(object.text, object.boxWidth, measure), width: object.boxWidth }
      : { lines: [object.text], width: full };
    cache.set(key, layout);
    return layout;
  };
}

/** Replacement text is flagged once it is this much wider than its patch. */
const OVERFLOW_TOLERANCE = 1.02;

export function overflowsCover(
  text: string,
  fontSize: number,
  family: string,
  coverWidth: number | undefined,
): boolean {
  if (!coverWidth) return false;
  const width = measureTextWidth(text, fontSize, family);
  return width !== null && width > coverWidth * OVERFLOW_TOLERANCE;
}

/**
 * Character offset closest to a point on the page, so a click that opens the
 * text editor puts the caret where the user aimed instead of at the end. The
 * browser may lack the server's face, so this is close rather than exact —
 * and when it cannot measure at all (jsdom, no canvas backend) the caret
 * simply lands after the last character.
 */
export function caretIndexAt(
  text: string,
  fontSize: number,
  family: string,
  offsetFromLeft: number,
): number {
  if (offsetFromLeft <= 0) return 0;
  let best = text.length;
  let bestDistance = Infinity;
  for (let index = 0; index <= text.length; index += 1) {
    const width = index === 0 ? 0 : measureTextWidth(text.slice(0, index), fontSize, family);
    if (width === null) return text.length;
    const distance = Math.abs(width - offsetFromLeft);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
    // Widths only grow, so once past the click nothing closer can follow.
    if (width > offsetFromLeft) break;
  }
  return best;
}

/**
 * Mirrors the arrow head the Go engine draws, so the preview and the exported
 * PDF agree on its size and angle.
 */
export function arrowHeadPoints(object: PathObject, pageHeight: number): string {
  const last = object.points[object.points.length - 1];
  const previous = object.points[object.points.length - 2];
  const angle = Math.atan2(last.y - previous.y, last.x - previous.x);
  const length = Math.max(Math.min(Math.max(object.strokeWidth, 0.1), 72) * 3.4, 4);
  const spread = 0.42;
  const corners: [number, number][] = [
    [last.x, last.y],
    [last.x - length * Math.cos(angle - spread), last.y - length * Math.sin(angle - spread)],
    [last.x - length * Math.cos(angle + spread), last.y - length * Math.sin(angle + spread)],
  ];
  return corners.map(([x, y]) => `${x},${flipY(y, pageHeight)}`).join(" ");
}
