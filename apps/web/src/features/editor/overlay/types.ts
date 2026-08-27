/**
 * The editor keeps every object in PDF user space: points, with the origin at
 * the bottom-left of the page. That matches what the API expects, so submitting
 * is a straight copy and no rounding drift accumulates while editing. The one
 * conversion lives in the SVG object layer, which flips Y for the screen.
 */

export type OverlayTool =
  | "select"
  | "text"
  | "rectangle"
  | "ellipse"
  | "line"
  | "draw"
  | "image"
  | "highlight"
  | "arrow"
  | "hand";

export type TextAlign = "left" | "center" | "right";

export type OverlayPoint = { x: number; y: number };

type Base = {
  id: string;
  page: number;
  opacity: number;
  rotation: number;
  /**
   * Objects that form one visual unit — a cover patch plus its replacement
   * text — share a group id, so dragging, scaling, duplicating, or deleting
   * any of them treats the pair as a single object.
   */
  groupId?: string;
  /**
   * A patch that hides something printed on the page. It stays where it is
   * even when the rest of its group is moved or resized — dragging it away
   * would uncover the original text it was placed there to replace.
   */
  pinned?: boolean;
};

/** `x`/`y` is the baseline anchor, exactly as PDF text placement works. */
export type TextObject = Base & {
  kind: "text";
  text: string;
  x: number;
  y: number;
  fontSize: number;
  font: string;
  color: string;
  align: TextAlign;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  /**
   * Width of the patch a cover-and-retype pick placed underneath. Present only
   * for replacement text, and used to warn when the new wording outgrows the
   * old while nothing is reflowing it.
   */
  coverWidth?: number;
  /**
   * Width of the text box, in points. Set by dragging a side grip, and the
   * wording wraps inside it; without one the text stays on a single line
   * however long it grows.
   */
  boxWidth?: number;
};

/** `x`/`y` is the bottom-left corner of the bounding box. */
export type BoxObject = Base & {
  kind: "rectangle" | "ellipse";
  x: number;
  y: number;
  width: number;
  height: number;
  stroke: string;
  strokeWidth: number;
  fill: string | null;
};

export type PathObject = Base & {
  kind: "line" | "draw";
  points: OverlayPoint[];
  stroke: string;
  strokeWidth: number;
  /** Solid head on the final point. */
  arrow?: boolean;
};

export type ImageObject = Base & {
  kind: "image";
  asset: string;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  previewUrl: string;
};

export type OverlayObject = TextObject | BoxObject | PathObject | ImageObject;

export const DEFAULT_TEXT_COLOR = "#111111";
export const DEFAULT_STROKE_COLOR = "#c62828";
export const DEFAULT_FONT_SIZE = 16;
export const DEFAULT_STROKE_WIDTH = 2;
export const HIGHLIGHT_COLOR = "#ffe14d";
export const HIGHLIGHT_OPACITY = 0.4;
/** A click that never moves should not leave a zero-sized object behind. */
export const MIN_DRAW_SIZE = 4;

/** Mirrors the server limits so the UI refuses before the request does. */
export const MAX_OBJECTS_PER_PAGE = 500;
export const MAX_OBJECTS = 5000;
export const MAX_ASSETS = 20;
export const MAX_TEXT_LENGTH = 2000;

/** Baseline to baseline, as a share of the type size. */
export const LINE_HEIGHT = 1.2;

/** Where a text object breaks, and how wide it draws. */
export type TextLayout = { lines: string[]; width: number };

/**
 * How a string really sets, installed by the editor once the font list is
 * known. Bounds used to assume an average glyph width, so a frame around
 * "Iliad" was far too wide and one around "WWW" too narrow; measuring the
 * actual face fixes the box, the hit area, and the grips at once, and is what
 * makes wrapping to a box width possible at all.
 */
let layoutText: ((object: TextObject) => TextLayout) | null = null;

export function setTextLayout(layout: ((object: TextObject) => TextLayout) | null): void {
  layoutText = layout;
}

export function textLayoutOf(object: TextObject): TextLayout {
  const measured = layoutText?.(object);
  if (measured) return measured;
  // Nothing can measure here (no canvas backend), so the text stays on one
  // line and its width is the old average-glyph estimate.
  return { lines: [object.text], width: object.boxWidth ?? object.text.length * object.fontSize * 0.52 };
}

export function isBox(object: OverlayObject): object is BoxObject {
  return object.kind === "rectangle" || object.kind === "ellipse";
}

export function isPath(object: OverlayObject): object is PathObject {
  return object.kind === "line" || object.kind === "draw";
}

/** Bounding box in PDF space, used for selection outlines and drag bounds. */
export function boundsOf(object: OverlayObject): { x: number; y: number; width: number; height: number } {
  if (isBox(object)) {
    return { x: object.x, y: object.y, width: object.width, height: object.height };
  }
  if (object.kind === "image") {
    return {
      x: object.centerX - object.width / 2,
      y: object.centerY - object.height / 2,
      width: object.width,
      height: object.height,
    };
  }
  if (isPath(object)) {
    const xs = object.points.map((point) => point.x);
    const ys = object.points.map((point) => point.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  }
  // Text is measured from its baseline: most of a glyph sits above it, and
  // wrapped lines hang below it.
  const layout = textLayoutOf(object);
  const width = object.boxWidth ?? layout.width;
  const offset = object.align === "center" ? width / 2 : object.align === "right" ? width : 0;
  const extra = (layout.lines.length - 1) * object.fontSize * LINE_HEIGHT;
  return {
    x: object.x - offset,
    y: object.y - object.fontSize * 0.22 - extra,
    width,
    height: object.fontSize + extra,
  };
}
