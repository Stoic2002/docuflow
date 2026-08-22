import { zodResolver } from "@hookform/resolvers/zod";
import { api, userFacingError } from "@pdf-studio/api-client";
import { Button, Card } from "@pdf-studio/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { capabilitiesQuery, documentsQuery, queryKeys } from "../../api/queries";
import { ErrorState, LoadingState } from "../../components/async-state";
import { PageHeading } from "../../components/page-heading";

export type ToolKind = "merge" | "split" | "compress" | "ocr";

const schema = z.object({
  documentId: z.string().min(1, "Pilih dokumen."),
  secondDocumentId: z.string().optional(),
  range: z.string().optional(),
  language: z.enum(["eng", "ind"]),
});
type ToolForm = z.infer<typeof schema>;

const content: Record<ToolKind, { title: string; description: string; operation: string }> = {
  merge: {
    title: "Gabungkan PDF",
    description: "Gabungkan dua PDF menjadi dokumen baru. Original kedua file tetap immutable.",
    operation: "merge",
  },
  split: {
    title: "Pisah / ekstrak halaman",
    description: "Ekstrak rentang halaman menjadi versi baru, misalnya 1-3,5.",
    operation: "split",
  },
  compress: {
    title: "Kompresi struktural",
    description: "Optimasi lossless/struktural dengan qpdf. Ini bukan advanced image compression.",
    operation: "compress",
  },
  ocr: {
    title: "Searchable OCR",
    description: "Tambahkan text layer yang dapat dicari. OCR bukan rekonstruksi layout editable sempurna.",
    operation: "ocr",
  },
};

export function ToolPage({ kind }: { kind: ToolKind }) {
  const documents = useQuery(documentsQuery);
  const capabilities = useQuery(capabilitiesQuery);
  const queryClient = useQueryClient();
  const form = useForm<ToolForm>({ resolver: zodResolver(schema), defaultValues: { language: "eng" } });
  const selectedDocumentID = form.watch("documentId");
  const selectedSecondDocumentID = form.watch("secondDocumentId");
  const mutation = useMutation({
    mutationFn: (values: ToolForm) => {
      const payload: Record<string, unknown> = { documentId: values.documentId };
      if (kind === "merge") payload.documentIds = [values.documentId, values.secondDocumentId];
      if (kind === "split") payload.ranges = values.range;
      if (kind === "ocr") payload.language = values.language;
      return api.process(content[kind].operation, payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.documents });
    },
  });
  if (documents.isPending || capabilities.isPending) return <LoadingState />;
  if (documents.isError) return <ErrorState error={documents.error} />;
  if (capabilities.isError) return <ErrorState error={capabilities.error} />;
  const isOcr = kind === "ocr";
  const available = isOcr
    ? capabilities.data.features.searchableOcr
    : capabilities.data.features.pageOperations;
  const tool = isOcr ? capabilities.data.tools.ocrmypdf : capabilities.data.tools.qpdf;

  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      <PageHeading eyebrow="PDF tools" title={content[kind].title} description={content[kind].description} />
      {!available ? (
        <Card className="mt-6 border-accent/40 bg-accent-soft p-5 text-sm text-ink" role="status">
          Capability unavailable: {tool.reason ?? "Executable belum tersedia di PATH backend."}
        </Card>
      ) : null}
      <Card className="mt-8 border-ink p-6">
        <form className="space-y-5" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
          <label className="block text-sm font-semibold" htmlFor={`${kind}-document`}>
            Dokumen sumber
          </label>
          <select
            id={`${kind}-document`}
            className="form-control mt-1"
            {...form.register("documentId")}
          >
            <option value="">Pilih dokumen</option>
            {documents.data.documents.map((document) => (
              <option key={document.id} value={document.id}>
                {document.originalName}
              </option>
            ))}
          </select>
          {kind === "merge" ? (
            <div>
              <label className="block text-sm font-semibold" htmlFor="merge-second-document">
                Dokumen kedua
              </label>
              <select
                id="merge-second-document"
                className="form-control mt-1"
                {...form.register("secondDocumentId")}
              >
                <option value="">Pilih dokumen kedua</option>
                {documents.data.documents.map((document) => (
                  <option key={document.id} value={document.id}>
                    {document.originalName}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {kind === "split" ? (
            <div>
              <label className="block text-sm font-semibold" htmlFor="split-range">
                Rentang halaman
              </label>
              <input
                id="split-range"
                className="form-control mt-1"
                placeholder="1-3,5"
                {...form.register("range")}
              />
            </div>
          ) : null}
          {kind === "ocr" ? (
            <div>
              <label className="block text-sm font-semibold" htmlFor="ocr-language">
                Bahasa OCR
              </label>
              <select
                id="ocr-language"
                className="form-control mt-1"
                {...form.register("language")}
              >
                <option value="eng">English</option>
                <option value="ind">Bahasa Indonesia (jika language pack tersedia)</option>
              </select>
            </div>
          ) : null}
          {form.formState.errors.documentId ? (
            <p className="text-sm text-red-700" role="alert">
              {form.formState.errors.documentId.message}
            </p>
          ) : null}
          <Button type="submit" disabled={!available || !selectedDocumentID || (kind === "merge" && !selectedSecondDocumentID) || mutation.isPending}>
            {mutation.isPending ? "Memproses…" : "Buat versi baru"}
          </Button>
          {!selectedDocumentID ? <p className="text-xs font-semibold text-muted">Pilih dokumen terlebih dahulu untuk mengaktifkan tombol.</p> : null}
          {mutation.isError ? (
            <p className="text-sm text-red-700" role="alert">
              Operasi gagal: {userFacingError(mutation.error)} Original tetap aman.
            </p>
          ) : null}
          {mutation.isSuccess ? (
            <p className="text-sm text-emerald-700" role="status">
              Operasi selesai dan output disimpan sebagai versi baru.
            </p>
          ) : null}
        </form>
      </Card>
    </main>
  );
}
