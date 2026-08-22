import { api } from "@pdf-studio/api-client";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

describe("direct multipart API client", () => {
  it("uploads ordered files directly without a documentId prerequisite", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const first = new File(["%PDF-one"], "one.pdf", { type: "application/pdf" });
    const second = new File(["%PDF-two"], "two.pdf", { type: "application/pdf" });
    await api.directTool("merge", [first, second]);
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/tools/merge");
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.getAll("files")).toEqual([first, second]);
    expect(form.has("documentId")).toBe(false);
    expect(init.headers).toBeUndefined();
  });

  it("uploads one Split PDF with ordered page selections", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ results: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    const first = new File(["%PDF-one"], "one.pdf", { type: "application/pdf" });

    await api.split(first, [1, 2, 5]);

    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/tools/split");
    const form = init.body as FormData;
    expect(form.get("file")).toBe(first);
    expect(form.get("pages")).toBe("[1,2,5]");
    expect(form.getAll("files")).toHaveLength(0);
  });

  it("soft deletes a Recent document through the centralized client", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchMock);

    await api.deleteDocument("document-id");

    expect(fetchMock).toHaveBeenCalledWith("/api/documents/document-id", { method: "DELETE", signal: undefined });
  });

  it("uses dedicated restore and permanent-delete endpoints for Trash", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchMock);

    await api.restoreDocument("document-id");
    await api.permanentlyDeleteDocument("document-id");

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/documents/document-id/restore", { method: "POST", signal: undefined });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/documents/document-id/permanent", { method: "DELETE", signal: undefined });
  });
});
