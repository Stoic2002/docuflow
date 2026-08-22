import { zodResolver } from "@hookform/resolvers/zod";
import { api, userFacingError, type Capabilities, type DirectSplitResult, type DirectToolResult } from "@pdf-studio/api-client";
import { Button, Card } from "@pdf-studio/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useForm } from "react-hook-form";
import { capabilitiesQuery, queryKeys } from "../../api/queries";
import { ErrorState, LoadingState } from "../../components/async-state";
import { PageHeading } from "../../components/page-heading";
import {
  CapabilityNotice,
  ProcessingState,
  SelectedFileList,
  SplitResultCard,
  ToolDropzone,
  ToolResultCard,
  type SelectedToolFile,
} from "./tool-components";
import { SplitPagePicker } from "./split-page-picker";
import { ocrSchema, splitPagesSchema } from "./tool-schemas";

export type DirectToolKind = "merge" | "split" | "compress" | "ocr";

const copy: Record<DirectToolKind, { eyebrow: string; title: string; description: string; action: string }> = {
  merge: { eyebrow: "Merge PDF", title: "Gabungkan PDF", description: "Pilih dua hingga 20 PDF, atur urutannya, lalu hasilkan satu file baru.", action: "Gabungkan PDF" },
  split: { eyebrow: "Split PDF", title: "Pisahkan halaman PDF", description: "Pilih satu PDF dan tentukan halaman secara visual. Setiap halaman terpilih menjadi satu file PDF terpisah.", action: "Pecah halaman terpilih" },
  compress: { eyebrow: "Compress PDF", title: "Optimalkan struktur PDF", description: "Kompresi lossless/struktural dengan qpdf. Ini bukan advanced image compression.", action: "Kompres PDF" },
  ocr: { eyebrow: "Searchable OCR", title: "Jadikan scan dapat dicari", description: "OCR menambahkan text layer searchable. Hasilnya bukan rekonstruksi layout yang sepenuhnya editable.", action: "Jalankan searchable OCR" },
};

function availability(kind: DirectToolKind, capabilities: Capabilities) {
  if (kind === "ocr") return { available: capabilities.ocrSearchable, reason: capabilities.tools.ocrmypdf.reason };
  if (kind === "compress") return { available: capabilities.compressLossless, reason: capabilities.tools.qpdf.reason };
  return { available: capabilities[kind], reason: capabilities.tools.qpdf.reason };
}

function selected(files: File[]): SelectedToolFile[] {
  return files.map((file) => ({ id: crypto.randomUUID(), file }));
}

export function DirectToolPage({ kind }: { kind: DirectToolKind }) {
  const capabilities = useQuery(capabilitiesQuery);
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<SelectedToolFile[]>([]);
  const [splitPageCount, setSplitPageCount] = useState(0);
  const splitForm = useForm<{ pages: number[] }>({ resolver: zodResolver(splitPagesSchema()), defaultValues: { pages: [] } });
  const ocrForm = useForm<{ language: "eng" | "ind" }>({ resolver: zodResolver(ocrSchema), defaultValues: { language: "eng" } });
  const selectedPages = splitForm.watch("pages");
  const mutation = useMutation<DirectToolResult | DirectSplitResult, Error, Record<string, string> | number[]>({
    mutationFn: (input: Record<string, string> | number[]) => kind === "split"
      ? api.split(files[0].file, Array.isArray(input) ? input : [])
      : api.directTool(kind, files.map((item) => item.file), Array.isArray(input) ? {} : input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.documents }),
  });
  const handleSplitReady = useCallback((pageCount: number) => {
    setSplitPageCount(pageCount);
    splitForm.setValue("pages", Array.from({ length: pageCount }, (_, index) => index + 1), { shouldValidate: true });
  }, [splitForm]);
  if (capabilities.isPending) return <main className="page-shell py-12"><LoadingState /></main>;
  if (capabilities.isError) return <main className="page-shell py-12"><ErrorState error={capabilities.error} /></main>;
  const support = availability(kind, capabilities.data);
  const addFiles = (incoming: File[]) => {
    if (kind === "merge") {
      const additions = selected(incoming.slice(0, Math.max(0, 20 - files.length)));
      setFiles((current) => [...current, ...additions].slice(0, 20));
      return;
    }
    setFiles(selected(incoming.slice(0, 1)));
    if (kind === "split") {
      setSplitPageCount(0);
      splitForm.reset({ pages: [] });
      mutation.reset();
    }
  };
  const start = () => {
    if (kind === "split") void splitForm.handleSubmit((value) => mutation.mutate(value.pages))();
    else if (kind === "ocr") void ocrForm.handleSubmit((value) => mutation.mutate({ language: value.language }))();
    else mutation.mutate(kind === "compress" ? { mode: "lossless-structural" } : {});
  };
  const minimumMet = kind === "merge" ? files.length >= 2 : kind === "split" ? files.length === 1 && splitPageCount > 0 && selectedPages.length > 0 : files.length === 1;
  const reset = () => { setFiles([]); setSplitPageCount(0); mutation.reset(); splitForm.reset({ pages: [] }); ocrForm.reset(); };
  const removeFile = (id: string) => {
    setFiles((current) => current.filter((item) => item.id !== id));
    if (kind === "split") { setSplitPageCount(0); splitForm.reset({ pages: [] }); mutation.reset(); }
  };
  return (
    <main className={`mx-auto px-4 py-12 sm:px-6 ${kind === "split" ? "max-w-6xl" : "max-w-4xl"}`}>
      <PageHeading eyebrow={copy[kind].eyebrow} title={copy[kind].title} description={copy[kind].description} align="center" />
      <div className="mt-10 space-y-5">
        {!support.available ? <CapabilityNotice reason={support.reason ?? "Executable yang diperlukan belum tersedia di backend."} /> : null}
        {!mutation.data ? (
          <ToolDropzone
            onFiles={addFiles}
            multiple={kind === "merge"}
            maxFiles={kind === "merge" ? Math.max(1, 20 - files.length) : 1}
            disabled={!support.available || mutation.isPending}
            disabledReason={!support.available ? (support.reason ?? "Capability belum tersedia") : undefined}
            label={kind === "merge" ? "Tambah PDF untuk digabung" : kind === "split" ? "Pilih satu PDF untuk dipecah" : "Pilih satu PDF"}
          />
        ) : null}
        <SelectedFileList items={files} onRemove={removeFile} onReorder={kind === "merge" ? setFiles : undefined} />
        {kind === "split" && files[0] ? (
          <div className="space-y-2">
            <SplitPagePicker
              file={files[0].file}
              selectedPages={selectedPages}
              onChange={(pages) => splitForm.setValue("pages", pages, { shouldDirty: true, shouldValidate: true })}
              onReady={handleSplitReady}
            />
            {splitForm.formState.errors.pages?.message ? <p className="text-sm text-red-700" role="alert">{splitForm.formState.errors.pages.message}</p> : null}
          </div>
        ) : null}
        {kind === "ocr" && files.length ? (
          <Card className="p-5">
            <label htmlFor="ocr-language" className="text-sm font-bold">Bahasa dokumen</label>
            <select id="ocr-language" className="form-control mt-2" {...ocrForm.register("language")}>
              <option value="eng">English</option><option value="ind">Bahasa Indonesia</option>
            </select>
            <p className="mt-3 text-sm text-muted">Output menambahkan text layer searchable; teks dan layout tidak menjadi content editing native.</p>
          </Card>
        ) : null}
        {kind === "compress" && files.length ? <CapabilityNotice title="Mode tetap: lossless structural" reason="qpdf mengoptimalkan struktur PDF. Output hanya disimpan bila ukurannya benar-benar lebih kecil." /> : null}
        {mutation.isPending ? <ProcessingState label={kind === "ocr" ? "Menjalankan searchable OCR…" : "Memproses PDF…"} /> : null}
        {mutation.isError ? <Card className="border-accent bg-accent-soft p-5 text-sm text-ink" role="alert"><b>Operasi gagal.</b> {userFacingError(mutation.error)} Original tetap aman.</Card> : null}
        {mutation.data ? ("results" in mutation.data
          ? <SplitResultCard result={mutation.data} onStartOver={reset} />
          : <ToolResultCard result={mutation.data} onStartOver={reset} />) : (
          <div className="text-center">
            <Button type="button" onClick={start} disabled={!support.available || !minimumMet || mutation.isPending}>{copy[kind].action}</Button>
            {!files.length ? <p className="mt-3 text-xs font-semibold text-muted">Upload PDF terlebih dahulu untuk mengaktifkan tombol.</p> : null}
            {kind === "merge" && files.length === 1 ? <p className="mt-3 text-xs font-semibold text-muted">Tambahkan satu PDF lagi untuk mulai menggabungkan.</p> : null}
            {kind === "split" && files.length === 1 && selectedPages.length === 0 ? <p className="mt-3 text-xs font-semibold text-muted">Pilih minimal satu halaman untuk melanjutkan.</p> : null}
          </div>
        )}
      </div>
    </main>
  );
}
