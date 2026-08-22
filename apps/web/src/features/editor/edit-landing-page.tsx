import { api, userFacingError } from "@pdf-studio/api-client";
import { Card } from "@pdf-studio/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { capabilitiesQuery } from "../../api/queries";
import { PageHeading } from "../../components/page-heading";
import { CapabilityNotice, ProcessingState, ToolDropzone } from "../tools/tool-components";

export function EditLandingPage() {
  const navigate = useNavigate();
  const capabilities = useQuery(capabilitiesQuery);
  const mutation = useMutation({
    mutationFn: (file: File) => api.createEditSession(file),
    onSuccess: ({ session }) => navigate({ to: "/edit/$sessionId", params: { sessionId: session.id } }),
  });
  const uploadAvailable = capabilities.data?.features.upload ?? false;
  return (
    <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <PageHeading eyebrow="Edit PDF" title="Mulai dari file Anda" description="Unggah langsung untuk membuka editor. Tambahkan teks, bentuk, coretan, dan gambar di atas halaman. Tidak perlu memilih dari Recent Files." align="center" />
      <div className="mt-10 space-y-5">
        {capabilities.data && !capabilities.data.nativeContentEditing ? (
          <CapabilityNotice title="Menambah objek, bukan mengubah teks asli" reason="Anda dapat menambahkan teks, bentuk, coretan, dan gambar di atas halaman, lalu menyimpannya sebagai versi baru. Mengubah teks yang sudah ada di dalam PDF masih memerlukan SDK komersial yang belum dikonfigurasi." />
        ) : null}
        <ToolDropzone
          onFiles={(files) => files[0] && mutation.mutate(files[0])}
          disabled={!uploadAvailable || mutation.isPending}
          disabledReason={capabilities.isPending ? "Memeriksa backend…" : !uploadAvailable ? "Database atau storage belum tersedia." : undefined}
          label="Pilih PDF untuk diedit"
        />
        {mutation.isPending ? <ProcessingState label="Membuat edit session…" /> : null}
        {mutation.isError ? <Card className="border-accent bg-accent-soft p-5 text-sm text-ink" role="alert">Tidak dapat membuka PDF: {userFacingError(mutation.error)}</Card> : null}
      </div>
    </main>
  );
}
