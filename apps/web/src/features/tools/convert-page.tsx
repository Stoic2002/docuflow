import { api, userFacingError, type DirectToolResult } from "@pdf-studio/api-client";
import { Button, Card } from "@pdf-studio/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Braces, Download, FileImage, FileSpreadsheet, FileText, Images, Presentation, RotateCcw } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { capabilitiesQuery, queryKeys } from "../../api/queries";
import { ErrorState, LoadingState } from "../../components/async-state";
import { PageHeading } from "../../components/page-heading";
import { formatBytes } from "../../lib/format";
import { CapabilityNotice, ProcessingState, SelectedFileList, ToolDropzone, type SelectedToolFile } from "./tool-components";

type Conversion = {
  from: string;
  to: string;
  description: string;
  icon: LucideIcon;
  active?: boolean;
};

const toPDF: Conversion[] = [
  { from: "JPG", to: "PDF", description: "Susun satu atau beberapa gambar JPG menjadi PDF.", icon: Images, active: true },
  { from: "Word", to: "PDF", description: "Konversi dokumen DOC/DOCX menjadi PDF.", icon: FileText },
  { from: "PowerPoint", to: "PDF", description: "Konversi presentasi PPT/PPTX menjadi PDF.", icon: Presentation },
  { from: "Excel", to: "PDF", description: "Konversi workbook XLS/XLSX menjadi PDF.", icon: FileSpreadsheet },
  { from: "HTML", to: "PDF", description: "Render dokumen HTML menjadi PDF.", icon: Braces },
];

const fromPDF: Conversion[] = [
  { from: "PDF", to: "JPG", description: "Ekspor setiap halaman PDF sebagai gambar JPG.", icon: FileImage },
  { from: "PDF", to: "Word", description: "Konversi PDF menjadi dokumen Word.", icon: FileText },
  { from: "PDF", to: "PowerPoint", description: "Konversi PDF menjadi presentasi PowerPoint.", icon: Presentation },
  { from: "PDF", to: "Excel", description: "Konversi konten tabel PDF menjadi workbook Excel.", icon: FileSpreadsheet },
  { from: "PDF", to: "HTML", description: "Konversi PDF menjadi dokumen HTML.", icon: Braces },
];

function ConversionCard({ conversion }: { conversion: Conversion }) {
  const Icon = conversion.icon;
  const label = `${conversion.from} ke ${conversion.to}`;
  return (
    <Card className="flex h-full flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="flex size-11 items-center justify-center rounded-full bg-accent-soft text-accent">
          <Icon className="size-6" aria-hidden="true" />
        </span>
        <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${conversion.active ? "border-ink bg-ink text-paper" : "border-line bg-canvas text-muted"}`}>
          {conversion.active ? "Aktif" : "Mockup · belum aktif"}
        </span>
      </div>
      <h3 className="mt-4 flex items-center gap-2 text-lg font-bold text-ink">
        {conversion.from} <ArrowRight className="size-4 text-slate-400" aria-hidden="true" /> {conversion.to}
      </h3>
      <p className="mt-2 flex-1 text-sm leading-6 text-muted">{conversion.description}</p>
      {conversion.active ? (
        <Button asChild className="mt-5 w-full"><a href="#jpg-to-pdf">Mulai konversi</a></Button>
      ) : (
        <Button type="button" className="mt-5 w-full" disabled aria-label={`${label} segera hadir`}>Segera hadir</Button>
      )}
    </Card>
  );
}

function JPGToPDFResult({ result, inputCount, onReset }: { result: DirectToolResult; inputCount: number; onReset: () => void }) {
  return (
    <Card className="border-ink bg-paper p-6 shadow-[6px_6px_0_#ff2d2d]" role="status">
      <p className="eyebrow">Konversi selesai</p>
      <h3 className="font-display mt-2 text-3xl font-medium text-ink">PDF siap diunduh</h3>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <div><dt className="text-muted">Halaman</dt><dd className="font-bold text-ink">{inputCount}</dd></div>
        <div><dt className="text-muted">Total JPG</dt><dd className="font-bold text-ink">{formatBytes(result.beforeBytes)}</dd></div>
        <div><dt className="text-muted">Output PDF</dt><dd className="font-bold text-ink">{formatBytes(result.afterBytes)}</dd></div>
      </dl>
      <div className="mt-5 flex flex-wrap gap-3">
        <Button asChild><a href={result.downloadUrl} download={result.outputName ?? "converted-images.pdf"}><Download className="size-4" /> Unduh PDF</a></Button>
        <Button type="button" variant="secondary" onClick={onReset}><RotateCcw className="size-4" /> Mulai lagi</Button>
      </div>
    </Card>
  );
}

function JPGToPDFTool() {
  const capabilities = useQuery(capabilitiesQuery);
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<SelectedToolFile[]>([]);
  const mutation = useMutation<DirectToolResult, Error>({
    mutationFn: () => api.convertJPGToPDF(files.map((item) => item.file)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.documents }),
  });
  if (capabilities.isPending) return <section id="jpg-to-pdf" className="scroll-mt-24"><LoadingState /></section>;
  if (capabilities.isError) return <section id="jpg-to-pdf" className="scroll-mt-24"><ErrorState error={capabilities.error} /></section>;
  const available = capabilities.data.convertImageToPdf;
  const reset = () => { setFiles([]); mutation.reset(); };
  const addFiles = (incoming: File[]) => {
    setFiles((current) => [
      ...current,
      ...incoming.map((file) => ({ id: crypto.randomUUID(), file })),
    ].slice(0, 20));
    mutation.reset();
  };
  return (
    <section id="jpg-to-pdf" className="scroll-mt-24" aria-labelledby="jpg-to-pdf-title">
      <Card className="border-ink bg-canvas p-5 sm:p-7">
        <p className="eyebrow">Fitur aktif pertama</p>
        <h2 id="jpg-to-pdf-title" className="font-display mt-2 text-4xl font-medium text-ink">JPG ke PDF</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Pilih sampai 20 gambar. Urutan daftar menjadi urutan halaman PDF; setiap gambar dipasang proporsional pada A4 portrait atau landscape tanpa mengubah file sumber.</p>
        <div className="mt-6 space-y-4">
          {!available ? <CapabilityNotice reason="Konversi ini memerlukan database dan storage lokal yang aktif." /> : null}
          {!mutation.data ? (
            <ToolDropzone
              onFiles={addFiles}
              multiple
              maxFiles={Math.max(1, 20 - files.length)}
              disabled={!available || mutation.isPending || files.length >= 20}
              disabledReason={!available ? "Database atau storage lokal belum tersedia." : files.length >= 20 ? "Maksimal 20 JPG sudah dipilih." : undefined}
              label="Tambah JPG untuk dijadikan PDF"
              hint="JPG/JPEG saja · maksimal 20 gambar · maksimal sesuai batas upload per file."
              accept={{ "image/jpeg": [".jpg", ".jpeg"] }}
              invalidFileMessage="Pilih file JPG atau JPEG yang valid"
            />
          ) : null}
          <SelectedFileList
            items={files}
            onRemove={(id) => { setFiles((current) => current.filter((item) => item.id !== id)); mutation.reset(); }}
            onReorder={(items) => { setFiles(items); mutation.reset(); }}
            ariaLabel="JPG terpilih"
          />
          {mutation.isPending ? <ProcessingState label="Menyusun JPG menjadi PDF…" /> : null}
          {mutation.isError ? <Card className="border-accent bg-accent-soft p-5 text-sm text-ink" role="alert"><b>Konversi gagal.</b> {userFacingError(mutation.error)} File JPG sumber tetap aman.</Card> : null}
          {mutation.data ? <JPGToPDFResult result={mutation.data} inputCount={files.length} onReset={reset} /> : (
            <div className="text-center">
              <Button type="button" onClick={() => mutation.mutate()} disabled={!available || files.length === 0 || mutation.isPending}>Buat PDF</Button>
              {!files.length ? <p className="mt-3 text-xs font-semibold text-muted">Upload minimal satu JPG untuk mengaktifkan tombol.</p> : null}
            </div>
          )}
        </div>
      </Card>
    </section>
  );
}

function ConversionGroup({ title, description, items }: { title: string; description: string; items: Conversion[] }) {
  return (
    <section aria-labelledby={title.replaceAll(" ", "-").toLowerCase()}>
      <div>
        <h2 id={title.replaceAll(" ", "-").toLowerCase()} className="font-display text-4xl font-medium text-ink">{title}</h2>
        <p className="mt-2 text-sm text-muted">{description}</p>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((conversion) => <ConversionCard key={`${conversion.from}-${conversion.to}`} conversion={conversion} />)}
      </div>
    </section>
  );
}

export function ConvertPage() {
  return (
    <main className="page-shell py-12">
      <PageHeading eyebrow="Convert" title="Konversi dokumen" description="JPG ke PDF sudah aktif. Format lain tetap ditampilkan sebagai roadmap dan tidak akan memproses file sebelum engine backend-nya tersedia." align="center" />
      <div className="mt-10 space-y-12">
        <JPGToPDFTool />
        <ConversionGroup title="Ubah menjadi PDF" description="Format sumber yang direncanakan untuk menghasilkan PDF." items={toPDF} />
        <ConversionGroup title="Ubah dari PDF" description="Format keluaran yang direncanakan dari satu dokumen PDF." items={fromPDF} />
      </div>
    </main>
  );
}
