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
