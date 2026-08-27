import type { AnnotationDocument, AnnotationPage } from "@pdf-studio/api-client";
import { LINE_HEIGHT, type OverlayObject, isBox, isPath, textLayoutOf } from "./types";

/**
 * Converts editor objects into the wire format. Both sides already use PDF
 * points with a bottom-left origin, so this only reshapes and never converts
 * coordinates.
 */
export function toAnnotationDocument(objects: OverlayObject[]): AnnotationDocument {
  const byPage = new Map<number, AnnotationPage>();
  const pageFor = (page: number): AnnotationPage => {
    let entry = byPage.get(page);
    if (!entry) {
      entry = { page, texts: [], shapes: [], images: [] };
      byPage.set(page, entry);
    }
    return entry;
  };

  for (const object of objects) {
    const page = pageFor(object.page);
    if (object.kind === "text") {
      // A wrapped box is drawn as one text per line, each on its own baseline:
      // the engine places runs, it does not reflow them, and the browser has
      // already measured the breaks with the very face that will be embedded.
      const lines = textLayoutOf(object).lines;
      lines.forEach((line, index) => page.texts?.push({
        text: line,
        x: object.x,
        y: object.y - index * object.fontSize * LINE_HEIGHT,
        fontSize: object.fontSize,
        ...(object.font ? { font: object.font } : {}),
        color: object.color,
        opacity: object.opacity,
        rotation: object.rotation,
        align: object.align,
        ...(object.bold ? { bold: true } : {}),
        ...(object.italic ? { italic: true } : {}),
        ...(object.underline ? { underline: true } : {}),
        ...(object.strikethrough ? { strikethrough: true } : {}),
      }));
      continue;
    }
    if (isBox(object)) {
      page.shapes?.push({
        kind: object.kind,
        points: [
          { x: object.x, y: object.y },
          { x: object.x + object.width, y: object.y + object.height },
        ],
        stroke: object.stroke,
        strokeWidth: object.strokeWidth,
        ...(object.fill ? { fill: object.fill } : {}),
        opacity: object.opacity,
        rotation: object.rotation,
      });
      continue;
    }
    if (isPath(object)) {
      page.shapes?.push({
        // The editor calls freehand "draw"; the engine calls the geometry a polyline.
        kind: object.kind === "draw" ? "polyline" : "line",
        points: object.points.map((point) => ({ x: point.x, y: point.y })),
        stroke: object.stroke,
        strokeWidth: object.strokeWidth,
        opacity: object.opacity,
        rotation: object.rotation,
        ...(object.arrow ? { arrow: true } : {}),
      });
      continue;
    }
    page.images?.push({
      asset: object.asset,
      centerX: object.centerX,
      centerY: object.centerY,
      width: object.width,
      height: object.height,
      opacity: object.opacity,
      rotation: object.rotation,
    });
  }

  const pages = [...byPage.values()]
    .sort((left, right) => left.page - right.page)
    .map((page) => ({
      page: page.page,
      ...(page.texts?.length ? { texts: page.texts } : {}),
      ...(page.shapes?.length ? { shapes: page.shapes } : {}),
      ...(page.images?.length ? { images: page.images } : {}),
    }));
  return { pages };
}

/** Only the files still referenced by an image object are uploaded. */
export function usedAssets(objects: OverlayObject[], assets: Record<string, File>): Record<string, File> {
  const used: Record<string, File> = {};
  for (const object of objects) {
    if (object.kind === "image" && assets[object.asset]) used[object.asset] = assets[object.asset];
  }
  return used;
}
