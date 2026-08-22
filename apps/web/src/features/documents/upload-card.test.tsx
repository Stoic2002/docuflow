import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UploadCard } from "./upload-card";

afterEach(() => vi.restoreAllMocks());

describe("upload mutation errors", () => {
  it("keeps the error actionable and states that original is safe", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({ error: { code: "INVALID_PDF", message: "PDF signature invalid", details: {} } }),
      }),
    );
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <UploadCard />
      </QueryClientProvider>,
    );
    const file = new File(["%PDF-1.4"], "fixture.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Pilih PDF"), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Unggah" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Unggah" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("PDF signature invalid");
    expect(screen.getByRole("alert")).toHaveTextContent("Original lokal tetap aman");
  });
});
