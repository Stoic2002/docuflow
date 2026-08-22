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
});
