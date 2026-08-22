import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DirectToolPage } from "./direct-tool-page";

afterEach(() => vi.restoreAllMocks());

describe("tool-first capability state", () => {
  it("enables the Merge dropzone when qpdf is available", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        storage: { available: true }, database: { available: true },
        tools: { qpdf: { available: true, version: "qpdf version 12.4.0" }, ocrmypdf: { available: false, reason: "ocrmypdf missing" } },
        features: { upload: true, view: true, pageOperations: true, compression: true, searchableOcr: false, nativeEditing: false },
        viewer: true, nativeContentEditing: false, overlayEditing: false, merge: true, split: true,
        compressLossless: true, compressAdvanced: false, ocrSearchable: false,
        ocrEditableReconstruction: false, convertPdfToImage: false, convertImageToPdf: false,
        limits: { maxUploadBytes: 1024 },
      }),
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><DirectToolPage kind="merge" /></QueryClientProvider>);

    expect(await screen.findByLabelText("Tambah PDF untuk digabung")).toBeEnabled();
    expect(screen.queryByText("Capability unavailable")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gabungkan PDF" })).toBeDisabled();
  });

  it("requires one PDF and keeps Split processing disabled before upload", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        storage: { available: true }, database: { available: true },
        tools: { qpdf: { available: true, version: "qpdf version 12.4.0" }, ocrmypdf: { available: false, reason: "ocrmypdf missing" } },
        features: { upload: true, view: true, pageOperations: true, compression: true, searchableOcr: false, nativeEditing: false },
        viewer: true, nativeContentEditing: false, overlayEditing: false, merge: true, split: true,
        compressLossless: true, compressAdvanced: false, ocrSearchable: false,
        ocrEditableReconstruction: false, convertPdfToImage: false, convertImageToPdf: false,
        limits: { maxUploadBytes: 1024 },
      }),
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><DirectToolPage kind="split" /></QueryClientProvider>);

    const input = await screen.findByLabelText("Pilih satu PDF untuk dipecah");
    expect(input).toBeEnabled();
    expect(input).not.toHaveAttribute("multiple");
    expect(screen.getByRole("button", { name: "Pecah halaman terpilih" })).toBeDisabled();
  });

  it("keeps the OCR direct entrance visible while disabling unavailable processing honestly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        storage: { available: true }, database: { available: true },
        tools: { qpdf: { available: false, reason: "qpdf missing" }, ocrmypdf: { available: false, reason: "ocrmypdf missing" } },
        features: { upload: true, view: true, pageOperations: false, compression: false, searchableOcr: false, nativeEditing: false },
        viewer: true, nativeContentEditing: false, overlayEditing: false, merge: false, split: false,
        compressLossless: false, compressAdvanced: false, ocrSearchable: false,
        ocrEditableReconstruction: false, convertPdfToImage: false, convertImageToPdf: false,
        limits: { maxUploadBytes: 1024 },
      }),
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><DirectToolPage kind="ocr" /></QueryClientProvider>);
    expect(await screen.findByText("Capability unavailable")).toBeVisible();
    expect(screen.getByText("ocrmypdf missing")).toBeVisible();
    expect(screen.getByText(/bukan rekonstruksi layout yang sepenuhnya editable/)).toBeVisible();
    expect(screen.getByLabelText("Pilih satu PDF")).toBeDisabled();
    expect(screen.queryByText(/Pilih dokumen sumber/)).not.toBeInTheDocument();
  });
});
