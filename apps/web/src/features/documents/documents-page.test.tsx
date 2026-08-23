import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentsPage } from "./documents-page";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#preview">{children}</a>,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("documents query errors", () => {
  it("shows an actionable safe error when the query fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("backend offline")));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DocumentsPage />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("backend offline");
    expect(screen.getByRole("alert")).toHaveTextContent("Original PDF tetap aman");
  });

  it("confirms a soft delete and removes the document from Recent", async () => {
    let deleted = false;
    const fetchMock = vi.fn().mockImplementation((_path: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        deleted = true;
        return Promise.resolve({ ok: true, status: 204 });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          documents: deleted ? [] : [{
            id: "11111111-1111-1111-1111-111111111111",
            originalName: "report.pdf",
            mediaType: "application/pdf",
            byteSize: 42,
            pageCount: 1,
            checksumSha256: "a".repeat(64),
            createdAt: "2026-08-14T00:00:00Z",
            updatedAt: "2026-08-14T00:00:00Z",
          }],
        }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><DocumentsPage /></QueryClientProvider>);

    expect(await screen.findByText("report.pdf")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Hapus" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toBeVisible();
    expect(dialog).toHaveStyle({ position: "fixed", left: "50%", top: "50%", zIndex: "2147483647" });
    expect(screen.getByRole("heading", { name: "Hapus dari Recent?" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Hapus dari Recent" }));

    await waitFor(() => expect(screen.queryByText("report.pdf")).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/documents/11111111-1111-1111-1111-111111111111", { method: "DELETE", signal: undefined });
  });

  it("deletes every selected document in one confirmed call", async () => {
    const first = {
      id: "11111111-1111-1111-1111-111111111111",
      originalName: "report.pdf",
      mediaType: "application/pdf",
      byteSize: 42,
      pageCount: 1,
      checksumSha256: "a".repeat(64),
      createdAt: "2026-08-14T00:00:00Z",
      updatedAt: "2026-08-14T00:00:00Z",
    };
    const second = { ...first, id: "22222222-2222-2222-2222-222222222222", originalName: "invoice.pdf" };
    let deleted = false;
    const fetchMock = vi.fn().mockImplementation((path: string) => {
      if (path === "/api/documents/bulk-delete") {
        deleted = true;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ deleted: [first.id, second.id], failed: [] }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ documents: deleted ? [] : [first, second] }) });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><DocumentsPage /></QueryClientProvider>);

    fireEvent.click(await screen.findByLabelText("Pilih semua dokumen"));
    expect(screen.getByText("2 dokumen dipilih")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Hapus 2 dari Recent" }));
    expect(screen.getByRole("alertdialog")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Hapus 2 dokumen dari Recent?" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Hapus 2 dari Recent" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/documents/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentIds: [first.id, second.id] }),
      signal: undefined,
    }));
    await waitFor(() => expect(screen.getByText("Belum ada dokumen")).toBeVisible());
  });

  it("selects one row at a time without touching the rest", async () => {
    const first = {
      id: "11111111-1111-1111-1111-111111111111",
      originalName: "report.pdf",
      mediaType: "application/pdf",
      byteSize: 42,
      pageCount: 1,
      checksumSha256: "a".repeat(64),
      createdAt: "2026-08-14T00:00:00Z",
      updatedAt: "2026-08-14T00:00:00Z",
    };
    const second = { ...first, id: "22222222-2222-2222-2222-222222222222", originalName: "invoice.pdf" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ documents: [first, second] }),
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><DocumentsPage /></QueryClientProvider>);

    fireEvent.click(await screen.findByLabelText("Pilih invoice.pdf"));
    expect(screen.getByText("1 dokumen dipilih")).toBeVisible();
    expect(screen.getByLabelText("Pilih report.pdf")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Hapus 1 dari Recent" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Batalkan pilihan" }));
    expect(screen.queryByText("1 dokumen dipilih")).not.toBeInTheDocument();
  });
});
