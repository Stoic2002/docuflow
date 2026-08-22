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
      <PageHeading eyebrow="Edit PDF" title="Mulai dari file Anda" description="Unggah langsung untuk membuka workspace. Tidak perlu memilih dari Recent Files." align="center" />
      <div className="mt-10 space-y-5">
        {capabilities.data && !capabilities.data.nativeContentEditing ? (
          <CapabilityNotice title="Preview mode" reason="Native content editing belum tersedia karena provider komersial belum dikonfigurasi. Anda tetap dapat membuka, memeriksa halaman, dan mengunduh original." />
        ) : null}
        <ToolDropzone
          onFiles={(files) => files[0] && mutation.mutate(files[0])}
          disabled={!uploadAvailable || mutation.isPending}
          disabledReason={capabilities.isPending ? "Memeriksa backend…" : !uploadAvailable ? "Database atau storage belum tersedia." : undefined}
          label="Pilih PDF untuk Preview"
        />
        {mutation.isPending ? <ProcessingState label="Membuat edit session…" /> : null}
        {mutation.isError ? <Card className="border-accent bg-accent-soft p-5 text-sm text-ink" role="alert">Tidak dapat membuka PDF: {userFacingError(mutation.error)}</Card> : null}
      </div>
    </main>
  );
}
