export type ToolCapability = {
  available: boolean;
  version?: string;
  reason?: string;
  languages?: string[];
};

export type Capabilities = {
  storage: { available: boolean };
  database: { available: boolean };
  tools: {
    qpdf: ToolCapability;
    ocrmypdf: ToolCapability;
    pdfinfo: ToolCapability;
    pdftoppm: ToolCapability;
    pdffonts: ToolCapability;
  };
  features: {
    upload: boolean;
    view: boolean;
    pageOperations: boolean;
    compression: boolean;
    searchableOcr: boolean;
    nativeEditing: boolean;
    organize: boolean;
    protect: boolean;
    unlock: boolean;
    watermark: boolean;
    pageNumbers: boolean;
    headerFooter: boolean;
    metadata: boolean;
    rename: boolean;
    thumbnails: boolean;
    embeddedFonts: boolean;
    fontScan: boolean;
    annotate: boolean;
  };
  limits: { maxUploadBytes: number };
  viewer: boolean;
  nativeContentEditing: boolean;
  overlayEditing: boolean;
  merge: boolean;
  split: boolean;
  compressLossless: boolean;
  compressAdvanced: boolean;
  ocrSearchable: boolean;
  ocrEditableReconstruction: boolean;
  convertPdfToImage: boolean;
  convertImageToPdf: boolean;
};

export type DocumentRecord = {
  id: string;
  originalName: string;
  mediaType: string;
  byteSize: number;
  pageCount: number | null;
  checksumSha256: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};

export type DocumentVersion = {
  id: string;
  documentId: string;
  parentVersionId: string | null;
  operation: string;
  byteSize: number;
  checksumSha256: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type PDFMetadata = { title: string; author: string; subject: string; keywords: string };
export type DocumentInformation = { pageCount: number | null; fileSize: number; createdAt: string; modifiedAt: string; signed: boolean };

export type EditSession = {
  id: string;
  filename: string;
  byteSize: number;
  pageCount: number | null;
  mode: "preview";
  previewUrl: string;
  downloadUrl: string;
};

export type DirectToolResult = {
  document: DocumentRecord;
  version: DocumentVersion;
  downloadUrl: string;
  beforeBytes: number;
  afterBytes: number;
  savedToRecent: boolean;
  outputName?: string;
};

/**
 * One overlay editor document. Coordinates are PDF points with the origin at
 * the bottom-left of the page, so the canvas performs a single flip on submit.
 */
export type AnnotationDocument = { pages: AnnotationPage[] };

export type AnnotationPage = {
  page: number;
  texts?: AnnotationText[];
  shapes?: AnnotationShape[];
  images?: AnnotationImage[];
};

export type AnnotationText = {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  /** FontRegistry id from `GET /api/fonts`. Omit for the built-in Helvetica. */
  font?: string;
  /** `#rgb` or `#rrggbb`. Omitted means black. */
  color?: string;
  /** Omitted means fully opaque. */
  opacity?: number;
  rotation?: number;
  align?: "left" | "center" | "right";
  /** Emphasis is synthesised, not swapped for a real bold or italic face. */
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
};

export type AnnotationShapeKind = "rectangle" | "ellipse" | "line" | "polyline";

export type AnnotationShape = {
  kind: AnnotationShapeKind;
  /** Rectangle and ellipse take two opposite corners; lines take the path. */
  points: { x: number; y: number }[];
  stroke?: string;
  /** Omitted means 1pt. Zero requires a fill, or the shape is rejected. */
  strokeWidth?: number;
  /** Omitted leaves the interior untouched. */
  fill?: string;
  opacity?: number;
  rotation?: number;
  /** Solid head on the final point. Lines and polylines only. */
  arrow?: boolean;
};

export type AnnotationImage = {
  /** Matches the multipart field name carrying the JPEG. */
  asset: string;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  opacity?: number;
  rotation?: number;
};

export type FontCategory = "sans" | "serif" | "mono" | "display" | "script";

/**
 * `category` comes from the font's Panose metadata, which many families leave
 * zeroed; treat it as a hint. `fixed` is measured from the advances and is
 * reliable.
 */
export type RegisteredFont = {
  id: string;
  family: string;
  serif: boolean;
  fixed: boolean;
  category: FontCategory;
};

/** A typeface the uploaded PDF already carries, as reported by pdffonts. */
export type DocumentFont = { name: string; type: string; embedded: boolean; subset: boolean };
export type FontIssue = { file: string; reason: string };

export type DirectSplitResult = {
  results: DirectToolResult[];
  savedToRecent: boolean;
};

/**
 * Bulk deletion answers per document. One row that has already gone must not
 * hide the documents that were removed, so both halves are always named.
 */
export type BulkDeleteResult = {
  deleted: string[];
  failed: Array<{ documentId: string; code: string; message: string }>;
};

export type ApiErrorBody = {
  error: { code: string; message: string; details: Record<string, unknown> };
};

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    let body: ApiErrorBody | undefined;
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      // A proxy/network failure may not contain the API error envelope.
    }
    throw new ApiError(
      body?.error.code ?? "HTTP_ERROR",
      body?.error.message ?? `Request failed (${response.status})`,
      response.status,
      body?.error.details,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function multipart(files: File[], fields: Record<string, string> = {}): FormData {
  const form = new FormData();
  for (const file of files) form.append(files.length > 1 ? "files" : "file", file);
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
}

export const api = {
  capabilities: (signal?: AbortSignal) =>
    request<Capabilities>("/api/capabilities", { signal }),
  documents: (signal?: AbortSignal) =>
    request<{ documents: DocumentRecord[] }>("/api/documents", { signal }),
  trash: (signal?: AbortSignal) =>
    request<{ documents: DocumentRecord[] }>("/api/documents/trash", { signal }),
  document: (id: string, signal?: AbortSignal) =>
    request<{ document: DocumentRecord }>(`/api/documents/${encodeURIComponent(id)}`, { signal }),
  versions: (id: string, signal?: AbortSignal) =>
    request<{ versions: DocumentVersion[] }>(
      `/api/documents/${encodeURIComponent(id)}/versions`,
      { signal },
    ),
  deleteDocument: (id: string, signal?: AbortSignal) =>
    request<void>(`/api/documents/${encodeURIComponent(id)}`, {
      method: "DELETE",
      signal,
    }),
  bulkDeleteDocuments: (ids: string[], signal?: AbortSignal) =>
    request<BulkDeleteResult>("/api/documents/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentIds: ids }),
      signal,
    }),
  bulkPermanentlyDeleteDocuments: (ids: string[], signal?: AbortSignal) =>
    request<BulkDeleteResult>("/api/documents/bulk-permanent-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentIds: ids }),
      signal,
    }),
  restoreDocument: (id: string, signal?: AbortSignal) =>
    request<void>(`/api/documents/${encodeURIComponent(id)}/restore`, {
      method: "POST",
      signal,
    }),
  permanentlyDeleteDocument: (id: string, signal?: AbortSignal) =>
    request<void>(`/api/documents/${encodeURIComponent(id)}/permanent`, {
      method: "DELETE",
      signal,
    }),
  renameDocument: (id: string, name: string, signal?: AbortSignal) =>
    request<{ document: DocumentRecord }>(`/api/documents/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
      signal,
    }),
  metadata: (id: string, signal?: AbortSignal) =>
    request<{ metadata: PDFMetadata; information: DocumentInformation }>(
      `/api/documents/${encodeURIComponent(id)}/metadata`, { signal },
    ),
  updateMetadata: (id: string, metadata: PDFMetadata, confirmSignatures = false, signal?: AbortSignal) =>
    request<{ document: DocumentRecord; version: DocumentVersion }>(
      `/api/documents/${encodeURIComponent(id)}/metadata`, {
        method: "PATCH", headers: { "Content-Type": "application/json", "X-Confirm-Signature-Invalidation": String(confirmSignatures) },
        body: JSON.stringify(metadata), signal,
      },
    ),
  upload: (file: File, signal?: AbortSignal) => {
    const form = new FormData();
    form.set("file", file);
    return request<{ document: DocumentRecord }>("/api/documents", {
      method: "POST",
      body: form,
      signal,
    });
  },
  createEditSession: (file: File, signal?: AbortSignal) =>
    request<{ session: EditSession; document: DocumentRecord }>("/api/edit-sessions", {
      method: "POST",
      body: multipart([file]),
      signal,
    }),
  editSession: (sessionId: string, signal?: AbortSignal) =>
    request<{ session: EditSession; document: DocumentRecord }>(
      `/api/edit-sessions/${encodeURIComponent(sessionId)}`,
      { signal },
    ),
  fonts: (signal?: AbortSignal) =>
    request<{ fonts: RegisteredFont[]; issues: FontIssue[] }>("/api/fonts", { signal }),
  documentFonts: (documentId: string, signal?: AbortSignal) =>
    request<{ fonts: DocumentFont[] }>(`/api/documents/${encodeURIComponent(documentId)}/fonts`, { signal }),
  /**
   * Flattens the editor document onto the session PDF and saves a new version.
   * Images referenced by `asset` are sent as file parts under that same name.
   */
  exportEditSession: (
    sessionId: string,
    annotations: AnnotationDocument,
    assets: Record<string, File> = {},
    signal?: AbortSignal,
  ) => {
    const path = `/api/edit-sessions/${encodeURIComponent(sessionId)}/export`;
    const assetNames = Object.keys(assets);
    if (assetNames.length === 0) {
      return request<DirectToolResult>(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(annotations),
        signal,
      });
    }
    const form = new FormData();
    form.append("document", JSON.stringify(annotations));
    for (const name of assetNames) form.append(name, assets[name]);
    return request<DirectToolResult>(path, { method: "POST", body: form, signal });
  },
  directTool: (
    operation: "merge" | "compress" | "ocr",
    files: File[],
    fields: Record<string, string> = {},
    signal?: AbortSignal,
  ) =>
    request<DirectToolResult>(`/api/tools/${operation}`, {
      method: "POST",
      body: multipart(files, fields),
      signal,
    }),
  split: (file: File, pages: number[], signal?: AbortSignal) =>
    request<DirectSplitResult>("/api/tools/split", {
      method: "POST",
      body: multipart([file], { pages: JSON.stringify(pages) }),
      signal,
    }),
  convertJPGToPDF: (files: File[], signal?: AbortSignal) => {
    const form = new FormData();
    for (const file of files) form.append("files", file);
    return request<DirectToolResult>("/api/tools/convert/jpg-to-pdf", {
      method: "POST",
      body: form,
      signal,
    });
  },
  contentUrl: (id: string) => `/api/documents/${encodeURIComponent(id)}/content`,
  versionContentUrl: (documentId: string, versionId: string) =>
      `/api/documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionId)}/content`,
  thumbnailUrl: (documentId: string, page: number) =>
    `/api/documents/${encodeURIComponent(documentId)}/pages/${page}/thumbnail`,
  process: <T extends Record<string, unknown>>(operation: string, payload: T) =>
    request<{ document: DocumentRecord; version: DocumentVersion }>(`/api/tools/${operation}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  watermarkImage: (documentId: string, image: File, fields: Record<string, string>, signal?: AbortSignal) => {
    const form = multipart([image], { ...fields, documentId });
    const uploaded = form.get("file");
    if (uploaded) { form.delete("file"); form.set("image", uploaded); }
    return request<{ document: DocumentRecord; version: DocumentVersion }>("/api/tools/watermark", {
      method: "POST", body: form, signal,
    });
  },
};

export function userFacingError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Terjadi kesalahan yang tidak diketahui.";
}
