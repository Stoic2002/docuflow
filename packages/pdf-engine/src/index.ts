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
