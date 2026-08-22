import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConvertPage } from "./convert-page";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function renderPage(convertImageToPdf = true) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      storage: { available: convertImageToPdf }, database: { available: convertImageToPdf },
      tools: { qpdf: { available: true }, ocrmypdf: { available: false } },
      features: { upload: true, view: true, pageOperations: true, compression: true, searchableOcr: false, nativeEditing: false },
      viewer: true, nativeContentEditing: false, overlayEditing: false, merge: true, split: true,
      compressLossless: true, compressAdvanced: false, ocrSearchable: false,
      ocrEditableReconstruction: false, convertPdfToImage: false, convertImageToPdf,
      limits: { maxUploadBytes: 1024 },
    }),
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ConvertPage /></QueryClientProvider>);
}

describe("ConvertPage", () => {
  it("activates JPG to PDF and keeps the remaining conversions honest", async () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Ubah menjadi PDF" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Ubah dari PDF" })).toBeVisible();
    expect(screen.getByRole("heading", { name: /JPG.*PDF/ })).toBeVisible();
    expect(screen.getByRole("heading", { name: /PDF.*PowerPoint/ })).toBeVisible();
    expect(await screen.findByLabelText("Tambah JPG untuk dijadikan PDF")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Buat PDF" })).toBeDisabled();
    expect(screen.getAllByText("Mockup · belum aktif")).toHaveLength(9);
    const buttons = screen.getAllByRole("button", { name: /segera hadir/i });
    expect(buttons).toHaveLength(9);
    for (const button of buttons) expect(button).toBeDisabled();
  });

  it("disables JPG upload when storage or database is unavailable", async () => {
    renderPage(false);
    expect(await screen.findByText("Capability unavailable")).toBeVisible();
    expect(screen.getByLabelText("Tambah JPG untuk dijadikan PDF")).toBeDisabled();
  });
});
