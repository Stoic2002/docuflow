import type { RegisteredFont } from "@pdf-studio/api-client";

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

export function measureTextWidth(text: string, fontSize: number, family: string): number | null {
  if (measuringContext === undefined) {
    measuringContext = typeof document === "undefined"
      ? null
      : document.createElement("canvas").getContext("2d");
  }
  if (!measuringContext) return null;
  measuringContext.font = `${fontSize}px ${family}`;
  const width = measuringContext.measureText(text).width;
  return Number.isFinite(width) && width > 0 ? width : null;
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
