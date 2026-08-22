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

export interface ViewablePdfEngine extends PdfEngine {
  getViewerSource(): string | undefined;
  detectTextLayer(samplePages?: number): Promise<"present" | "absent" | "unknown">;
  renderPage(pageNumber: number, canvas: HTMLCanvasElement, maxWidth?: number): Promise<void>;
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
    const viewport = page.getViewport({ scale: maxWidth / natural.width });
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

export type PdfEngineProvider = "fallback" | "apryse" | "nutrient";

export function createPdfEngine(provider: PdfEngineProvider = "fallback"): PdfEngine {
  if (provider !== "fallback") {
    throw new Error(`${provider} is not configured; use the fallback viewer`);
  }
  return new FallbackViewerEngine();
}
