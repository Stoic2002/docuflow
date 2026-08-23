import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TrashPage } from "./trash-page";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#recent">{children}</a>,
}));

const deletedDocument = {
  id: "11111111-1111-1111-1111-111111111111",
  originalName: "trashed.pdf",
  mediaType: "application/pdf",
  byteSize: 42,
  pageCount: 1,
  checksumSha256: "a".repeat(64),
  createdAt: "2026-08-14T00:00:00Z",
  updatedAt: "2026-08-14T01:00:00Z",
  deletedAt: "2026-08-14T01:00:00Z",
};

const secondDeletedDocument = {
  ...deletedDocument,
  id: "22222222-2222-2222-2222-222222222222",
  originalName: "invoice.pdf",
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderTrash(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><TrashPage /></QueryClientProvider>);
}

describe("TrashPage", () => {
  it("restores a document through the reversible action", async () => {
    const fetchMock = vi.fn().mockImplementation((_path: string, init?: RequestInit) => {
      if (init?.method === "POST") return Promise.resolve({ ok: true, status: 204 });
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ documents: [deletedDocument] }) });
    });
    renderTrash(fetchMock);

    fireEvent.click(await screen.findByRole("button", { name: "Pulihkan" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/documents/11111111-1111-1111-1111-111111111111/restore",
      { method: "POST", signal: undefined },
    ));
  });

  it("requires confirmation before permanent deletion", async () => {
    const fetchMock = vi.fn().mockImplementation((_path: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return Promise.resolve({ ok: true, status: 204 });
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ documents: [deletedDocument] }) });
    });
    renderTrash(fetchMock);

    fireEvent.click(await screen.findByRole("button", { name: "Permanen" }));
    expect(screen.getByRole("alertdialog")).toBeVisible();
    expect(screen.getByText(/tidak dapat dibatalkan/i)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Hapus selamanya" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/documents/11111111-1111-1111-1111-111111111111/permanent",
      { method: "DELETE", signal: undefined },
    ));
  });

  it("purges every selected document in one confirmed call", async () => {
    let purged = false;
    const fetchMock = vi.fn().mockImplementation((path: string) => {
      if (path === "/api/documents/bulk-permanent-delete") {
        purged = true;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ deleted: [deletedDocument.id, secondDeletedDocument.id], failed: [] }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ documents: purged ? [] : [deletedDocument, secondDeletedDocument] }),
      });
    });
    renderTrash(fetchMock);

    fireEvent.click(await screen.findByLabelText("Pilih semua dokumen di Trash"));
    expect(screen.getByText("2 dokumen dipilih")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Hapus 2 permanen" }));
    expect(screen.getByRole("alertdialog")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Hapus 2 dokumen permanen?" })).toBeVisible();
    expect(screen.getByText(/tidak dapat dibatalkan/i)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Hapus 2 selamanya" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/documents/bulk-permanent-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentIds: [deletedDocument.id, secondDeletedDocument.id] }),
      signal: undefined,
    }));
    await waitFor(() => expect(screen.getByText("Trash masih kosong")).toBeVisible());
  });

  // Permanent deletion is irreversible, so a document the server refused has to
  // be named rather than folded into a generic failure.
  it("names the documents a partial purge left behind", async () => {
    const fetchMock = vi.fn().mockImplementation((path: string) => {
      if (path === "/api/documents/bulk-permanent-delete") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            deleted: [deletedDocument.id],
            failed: [{ documentId: secondDeletedDocument.id, code: "DOCUMENT_NOT_FOUND", message: "gone" }],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ documents: [secondDeletedDocument] }),
      });
    });
    renderTrash(fetchMock);

    fireEvent.click(await screen.findByLabelText("Pilih semua dokumen di Trash"));
    fireEvent.click(screen.getByRole("button", { name: "Hapus 1 permanen" }));
    fireEvent.click(screen.getByRole("button", { name: "Hapus 1 selamanya" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("1 dokumen tidak dapat dihapus dan masih ada di Trash: invoice.pdf.");
  });
});
