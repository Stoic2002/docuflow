import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";

export type PdfCapability =
  | "view"
  | "annotate"
  | "edit-content"
  | "edit-pages"
  | "export";

export interface PdfEngine {
  load(source: ArrayBuffer | string): Promise<void>;
  export(): Promise<Uint8Array>;
  getPageCount(): Promise<number>;
  isDirty(): boolean;
  supports(capability: PdfCapability): boolean;
  destroy(): Promise<void>;
}

export type PdfPageSize = { width: number; height: number };

/**
 * A horizontal or vertical rule already drawn on the page: a table border, an
 * underline, a separator. Diagonal strokes and curves are ignored because the
 * editor can only offer a straight replacement for them.
 */
export type PdfVectorRule = {
  orientation: "horizontal" | "vertical";
  /** Endpoints in PDF user space, ordered left-to-right or bottom-to-top. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  thickness: number;
};

/**
 * One run of text already on the page, positioned in PDF user space. The
 * cover-and-retype flow uses it to place a patch exactly over existing words.
 */
export type PdfTextRun = {
  text: string;
  /** Baseline origin, the same anchor PDF text placement uses. */
  x: number;
  y: number;
  width: number;
  fontSize: number;
  /** Degrees, counter-clockwise, matching PDF rotation. */
  rotation: number;
  /** Em fractions from the font's own metrics, used to size the patch. */
  ascent: number;
  descent: number;
  fontFamily: string;
};

export interface ViewablePdfEngine extends PdfEngine {
  getViewerSource(): string | undefined;
  detectTextLayer(samplePages?: number): Promise<"present" | "absent" | "unknown">;
  renderPage(pageNumber: number, canvas: HTMLCanvasElement, maxWidth?: number): Promise<void>;
  /** Unscaled page box in PDF points, which the editor uses to map coordinates. */
  getPageSize(pageNumber: number): Promise<PdfPageSize>;
  /** Renders at an explicit scale rather than fitting a width. */
  renderPageAtScale(pageNumber: number, canvas: HTMLCanvasElement, scale: number): Promise<void>;
  /** Text already on the page, positioned in PDF user space. */
  getTextRuns(pageNumber: number): Promise<PdfTextRun[]>;
  /** Straight rules already drawn on the page, in PDF user space. */
  getVectorRules(pageNumber: number): Promise<PdfVectorRule[]>;
}

/**
 * Browser-native, view-only fallback. It deliberately does not claim annotation,
 * content editing, page editing, or export capabilities.
 */
export class FallbackViewerEngine implements ViewablePdfEngine {
  private viewerSource?: string;
  private objectUrl?: string;
  private loadingTask?: PDFDocumentLoadingTask;
  private document?: PDFDocumentProxy;

  async load(source: ArrayBuffer | string): Promise<void> {
    await this.destroy();
    if (typeof source === "string") {
      this.viewerSource = source;
    } else {
      const copy = source.slice(0);
      this.objectUrl = URL.createObjectURL(new Blob([source], { type: "application/pdf" }));
      this.viewerSource = this.objectUrl;
      source = copy;
    }
    try {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      this.loadingTask = pdfjs.getDocument(
        typeof source === "string" ? { url: source } : { data: new Uint8Array(source) },
      );
      this.document = await this.loadingTask.promise;
    } catch {
      // Browser preview remains usable even when structural inspection fails.
      this.loadingTask = undefined;
      this.document = undefined;
    }
  }

  async export(): Promise<Uint8Array> {
    throw new Error("Export is unavailable in the fallback viewer");
  }

  async getPageCount(): Promise<number> {
    return this.document?.numPages ?? 0;
  }

  isDirty(): boolean {
    return false;
  }

  supports(capability: PdfCapability): boolean {
    return capability === "view";
  }

  getViewerSource(): string | undefined {
    return this.viewerSource;
  }

  async detectTextLayer(samplePages = 3): Promise<"present" | "absent" | "unknown"> {
    if (!this.document) return "unknown";
    const count = Math.min(this.document.numPages, Math.max(1, samplePages));
    try {
      for (let pageNumber = 1; pageNumber <= count; pageNumber += 1) {
        const page = await this.document.getPage(pageNumber);
        const text = await page.getTextContent();
        if (text.items.some((item) => "str" in item && item.str.trim().length > 0)) {
          return "present";
        }
      }
      return "absent";
    } catch {
      return "unknown";
    }
  }

  async renderPage(pageNumber: number, canvas: HTMLCanvasElement, maxWidth = 180): Promise<void> {
    if (!this.document) throw new Error("PDF structure is unavailable for thumbnails");
    const page = await this.document.getPage(pageNumber);
    const natural = page.getViewport({ scale: 1 });
    await this.renderPageAtScale(pageNumber, canvas, maxWidth / natural.width);
  }

  async getPageSize(pageNumber: number): Promise<PdfPageSize> {
    if (!this.document) throw new Error("PDF structure is unavailable");
    const page = await this.document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    return { width: viewport.width, height: viewport.height };
  }

  /**
   * PDF.js reports each item's transform in PDF user space, so the origin and
   * axis direction already match the editor and no conversion is needed here.
   */
  async getTextRuns(pageNumber: number): Promise<PdfTextRun[]> {
    if (!this.document) return [];
    const page = await this.document.getPage(pageNumber);
    const content = await page.getTextContent();
    const runs: PdfTextRun[] = [];
    for (const item of content.items) {
      if (!("str" in item) || item.str.trim() === "") continue;
      const [scaleX, skewY, , scaleYRaw, x, y] = item.transform;
      const fontSize = Math.hypot(skewY, scaleYRaw);
      if (fontSize <= 0 || item.width <= 0) continue;
      const style = content.styles?.[item.fontName];
      runs.push({
        text: item.str,
        x,
        y,
        width: item.width,
        fontSize,
        rotation: (Math.atan2(skewY, scaleX) * 180) / Math.PI,
        // Fall back to typical Latin proportions when the font omits metrics.
        ascent: style?.ascent && style.ascent > 0 ? style.ascent : 0.83,
        descent: style?.descent ? Math.abs(style.descent) : 0.22,
        fontFamily: style?.fontFamily ?? "sans-serif",
      });
    }
    return runs;
  }

  /**
   * Walks the page's operator list and collects straight rules. Coordinates in
   * that list are in unrotated user space with the MediaBox origin at zero, so
   * a page that is rotated or whose box is offset is reported as having none
   * rather than silently returning rules in the wrong place.
   */
  async getVectorRules(pageNumber: number): Promise<PdfVectorRule[]> {
    if (!this.document) return [];
    const page = await this.document.getPage(pageNumber);
    const [boxX, boxY] = page.view;
    if (page.rotate % 360 !== 0 || boxX !== 0 || boxY !== 0) return [];
    const { OPS } = await import("pdfjs-dist");
    const list = await page.getOperatorList();
    const collector = new RuleCollector(OPS as unknown as PathOps);
    for (let index = 0; index < list.fnArray.length; index += 1) {
      collector.step(list.fnArray[index], list.argsArray[index]);
    }
    return collector.rules();
  }

  async renderPageAtScale(pageNumber: number, canvas: HTMLCanvasElement, scale: number): Promise<void> {
    if (!this.document) throw new Error("PDF structure is unavailable");
    const page = await this.document.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
  }

  async destroy(): Promise<void> {
    await this.loadingTask?.destroy();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.loadingTask = undefined;
    this.document = undefined;
    this.objectUrl = undefined;
    this.viewerSource = undefined;
  }
}

/**
 * Adds annotation to the browser-native engine. Objects are flattened by the Go
 * API, not in the browser, so export() stays unsupported here: this engine can
 * describe edits but cannot produce edited PDF bytes on its own.
 */
export class OverlayEditorEngine extends FallbackViewerEngine {
  private dirty = false;

  markDirty(dirty: boolean): void {
    this.dirty = dirty;
  }

  override isDirty(): boolean {
    return this.dirty;
  }

  override supports(capability: PdfCapability): boolean {
    return capability === "view" || capability === "annotate";
  }
}

export type PdfEngineProvider = "fallback" | "overlay" | "apryse" | "nutrient";

export function createPdfEngine(provider: PdfEngineProvider = "fallback"): PdfEngine {
  if (provider === "fallback") return new FallbackViewerEngine();
  if (provider === "overlay") return new OverlayEditorEngine();
  throw new Error(`${provider} is not configured; use the fallback viewer`);
}

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function apply(matrix: Matrix, x: number, y: number): [number, number] {
  return [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
}

function multiply(outer: Matrix, inner: Matrix): Matrix {
  return [
    outer[0] * inner[0] + outer[2] * inner[1],
    outer[1] * inner[0] + outer[3] * inner[1],
    outer[0] * inner[2] + outer[2] * inner[3],
    outer[1] * inner[2] + outer[3] * inner[3],
    outer[0] * inner[4] + outer[2] * inner[5] + outer[4],
    outer[1] * inner[4] + outer[3] * inner[5] + outer[5],
  ];
}

/**
 * The operator identifiers RuleCollector needs, named so it can be driven with
 * a stub in tests instead of a live pdf.js.
 */
export type PathOps = {
  save: number;
  restore: number;
  transform: number;
  setLineWidth: number;
  constructPath: number;
  endPath: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
};

/**
 * Path element codes inside the flat buffer pdf.js hands to constructPath.
 * Each code is followed by its own number of coordinates.
 */
export const DRAW_OPS = {
  moveTo: 0,
  lineTo: 1,
  curveTo: 2,
  quadraticCurveTo: 3,
  closePath: 4,
} as const;

type SubPath = { points: [number, number][]; closed: boolean };

/** A stroke or bar thinner than this reads as a rule rather than a filled box. */
const MAX_RULE_THICKNESS = 4;
/** Shorter marks are decoration or glyph artefacts, not separators. */
const MIN_RULE_LENGTH = 8;
/** How far an endpoint may drift and still count as axis aligned. */
const AXIS_TOLERANCE = 0.6;

/**
 * Interprets the path-building operators of one page.
 *
 * pdf.js does not hand over the original PDF path operators. It flattens each
 * path into one buffer of element codes and coordinates, already resolving
 * rectangles into their four corners, and reports it once the path is painted.
 * Only the transform stack and that geometry are tracked here; paint colour is
 * read back from the rendered page instead, which is far simpler than
 * following the colour-space operators.
 */
export class RuleCollector {
  private stack: Matrix[] = [];
  private matrix: Matrix = IDENTITY;
  private lineWidth = 1;
  private found: PdfVectorRule[] = [];

  constructor(private readonly ops: PathOps) {}

  step(fn: number, args: unknown[]): void {
    if (fn === this.ops.save || fn === this.ops.paintFormXObjectBegin) {
      this.stack.push(this.matrix);
      // A form XObject carries its own matrix, and tables are often drawn
      // inside one, so its content would land in the wrong place without it.
      if (fn === this.ops.paintFormXObjectBegin && isMatrix(args[0])) {
        this.matrix = multiply(this.matrix, args[0]);
      }
      return;
    }
    if (fn === this.ops.restore || fn === this.ops.paintFormXObjectEnd) {
      this.matrix = this.stack.pop() ?? IDENTITY;
      return;
    }
    if (fn === this.ops.transform) {
      if (isMatrix(args)) this.matrix = multiply(this.matrix, args);
      return;
    }
    if (fn === this.ops.setLineWidth) {
      this.lineWidth = Number(args[0]) || 1;
      return;
    }
    if (fn !== this.ops.constructPath) return;
    // endPath means the geometry was only used for clipping, never painted.
    if (args[0] === this.ops.endPath) return;
    const buffer = readPathBuffer(args[1]);
    if (!buffer) return;
    for (const subPath of decodePath(buffer, this.matrix)) {
      this.emit(subPath, Math.max(this.lineWidth * this.scale(), 0.1));
    }
  }

  private scale(): number {
    const x = Math.hypot(this.matrix[0], this.matrix[1]);
    const y = Math.hypot(this.matrix[2], this.matrix[3]);
    return (x + y) / 2 || 1;
  }

  /**
   * A closed thin quad is one rule down its middle, not four edges. Anything
   * else contributes whichever of its edges are axis aligned.
   */
  private emit(subPath: SubPath, strokeWidth: number): void {
    const { points, closed } = subPath;
    if (points.length < 2) return;
    if (closed && points.length >= 4 && points.length <= 5 && this.emitThinQuad(points)) return;
    for (let index = 1; index < points.length; index += 1) {
      this.segment(points[index - 1], points[index], strokeWidth);
    }
    if (closed) this.segment(points[points.length - 1], points[0], strokeWidth);
  }

  private emitThinQuad(points: [number, number][]): boolean {
    const xs = points.map((point) => point[0]);
    const ys = points.map((point) => point[1]);
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const bottom = Math.min(...ys);
    const top = Math.max(...ys);
    const width = right - left;
    const height = top - bottom;
    if (height <= MAX_RULE_THICKNESS && width >= MIN_RULE_LENGTH) {
      const middle = (bottom + top) / 2;
      this.found.push({ orientation: "horizontal", x1: left, y1: middle, x2: right, y2: middle, thickness: Math.max(height, 0.1) });
      return true;
    }
    if (width <= MAX_RULE_THICKNESS && height >= MIN_RULE_LENGTH) {
      const middle = (left + right) / 2;
      this.found.push({ orientation: "vertical", x1: middle, y1: bottom, x2: middle, y2: top, thickness: Math.max(width, 0.1) });
      return true;
    }
    return false;
  }

  private segment(from: [number, number], to: [number, number], thickness: number): void {
    const deltaX = to[0] - from[0];
    const deltaY = to[1] - from[1];
    if (Math.abs(deltaY) <= AXIS_TOLERANCE && Math.abs(deltaX) >= MIN_RULE_LENGTH) {
      const [left, right] = from[0] <= to[0] ? [from, to] : [to, from];
      this.found.push({ orientation: "horizontal", x1: left[0], y1: left[1], x2: right[0], y2: right[1], thickness });
      return;
    }
    if (Math.abs(deltaX) <= AXIS_TOLERANCE && Math.abs(deltaY) >= MIN_RULE_LENGTH) {
      const [low, high] = from[1] <= to[1] ? [from, to] : [to, from];
      this.found.push({ orientation: "vertical", x1: low[0], y1: low[1], x2: high[0], y2: high[1], thickness });
    }
  }

  /** Drops duplicates, which stroked-then-filled paths produce in pairs. */
  rules(): PdfVectorRule[] {
    const seen = new Set<string>();
    return this.found.filter((rule) => {
      const key = `${rule.orientation}|${[rule.x1, rule.y1, rule.x2, rule.y2].map((value) => value.toFixed(1)).join("|")}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}

function isMatrix(value: unknown): value is Matrix {
  return Array.isArray(value) && value.length === 6 && value.every((entry) => typeof entry === "number");
}

/**
 * pdf.js wraps the path buffer in an array and uses a Float32Array, so a plain
 * Array.isArray check rejects every real page.
 */
function readPathBuffer(value: unknown): ArrayLike<number> | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || typeof candidate !== "object") return null;
  const buffer = candidate as ArrayLike<number>;
  return typeof buffer.length === "number" && buffer.length > 0 ? buffer : null;
}

/**
 * Splits the flat buffer into subpaths in page space. A curve ends the run it
 * belongs to, because nothing that follows a curve is a straight rule.
 */
export function decodePath(buffer: ArrayLike<number>, matrix: Matrix): SubPath[] {
  const subPaths: SubPath[] = [];
  let points: [number, number][] = [];
  const flush = (closed: boolean) => {
    if (points.length >= 2) subPaths.push({ points, closed });
    points = [];
  };
  let index = 0;
  while (index < buffer.length) {
    const code = buffer[index];
    index += 1;
    if (code === DRAW_OPS.moveTo) {
      flush(false);
      points = [apply(matrix, buffer[index], buffer[index + 1])];
      index += 2;
    } else if (code === DRAW_OPS.lineTo) {
      points.push(apply(matrix, buffer[index], buffer[index + 1]));
      index += 2;
    } else if (code === DRAW_OPS.curveTo || code === DRAW_OPS.quadraticCurveTo) {
      const span = code === DRAW_OPS.curveTo ? 6 : 4;
      const end = apply(matrix, buffer[index + span - 2], buffer[index + span - 1]);
      index += span;
      flush(false);
      points = [end];
    } else if (code === DRAW_OPS.closePath) {
      flush(true);
    } else {
      // An unknown code means the stream is out of step; stop rather than guess.
      break;
    }
  }
  flush(false);
  return subPaths;
}
