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
   * old, since nothing reflows it.
   */
  coverWidth?: number;
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

/** Mirrors the server limits so the UI refuses before the request does. */
export const MAX_OBJECTS_PER_PAGE = 500;
export const MAX_OBJECTS = 5000;
export const MAX_ASSETS = 20;
export const MAX_TEXT_LENGTH = 2000;

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
  // Text is measured from its baseline: most of a glyph sits above it.
  const width = object.text.length * object.fontSize * 0.52;
  const offset = object.align === "center" ? width / 2 : object.align === "right" ? width : 0;
  return { x: object.x - offset, y: object.y - object.fontSize * 0.22, width, height: object.fontSize };
}
