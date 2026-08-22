import { api, userFacingError } from "@pdf-studio/api-client";
import { Button, Card, ConfirmDialog } from "@pdf-studio/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Download, FilePenLine, PanelsTopLeft, Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { documentQuery, queryKeys, versionsQuery } from "../../api/queries";
import { ErrorState, LoadingState } from "../../components/async-state";
import { PdfViewer } from "../../components/pdf-viewer";
import { formatBytes, formatDate } from "../../lib/format";

export function DocumentDetailPage({ documentId }: { documentId: string }) {
  const document = useQuery(documentQuery(documentId));
  const versions = useQuery(versionsQuery(documentId));
  const queryClient = useQueryClient();
  const [renameOpen, setRenameOpen] = useState(false);
  const [name, setName] = useState("");
  useEffect(() => { if (document.data) setName(document.data.document.originalName); }, [document.data]);
  const rename = useMutation({ mutationFn: () => api.renameDocument(documentId, name), onSuccess: async () => { setRenameOpen(false); await Promise.all([queryClient.invalidateQueries({ queryKey: queryKeys.document(documentId) }), queryClient.invalidateQueries({ queryKey: queryKeys.documents })]); } });
  if (document.isPending) return <LoadingState label="Memuat dokumen…" />;
  if (document.isError)
    return <ErrorState error={document.error} retry={() => void document.refetch()} />;
  const record = document.data.document;
  return (
    <main className="page-shell py-10">
      <header className="mb-7 flex flex-wrap items-end justify-between gap-5">
        <div>
          <Link to="/documents" className="text-sm font-bold text-accent hover:underline">
            ← Semua dokumen
          </Link>
          <h1 className="font-display mt-3 break-all text-4xl font-medium text-ink">{record.originalName}</h1>
          <p className="mt-2 text-sm text-muted">
            {formatBytes(record.byteSize)} · {record.pageCount ?? "?"} halaman · {formatDate(record.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="ghost" onClick={() => { rename.reset(); setRenameOpen(true); }}><Pencil className="size-4" /> Rename</Button>
          <Button asChild variant="secondary">
            <Link to="/documents/$documentId/organize" params={{ documentId }}>
              <PanelsTopLeft className="size-4" /> Atur halaman
            </Link>
          </Button>
          <Button asChild variant="secondary">
            <Link to="/documents/$documentId/edit" params={{ documentId }}>
              <FilePenLine className="size-4" /> Editor
            </Link>
          </Button>
          <Button asChild>
            <a href={api.contentUrl(documentId)} download={record.originalName}>
              <Download className="size-4" /> Unduh original
            </a>
          </Button>
        </div>
      </header>
      <PdfViewer source={api.contentUrl(documentId)} title={`PDF ${record.originalName}`} />
      <section className="mt-6" aria-labelledby="versions-heading">
        <h2 id="versions-heading" className="font-display text-3xl font-medium text-ink">
          Riwayat versi
        </h2>
        {versions.isPending ? <LoadingState label="Memuat versi…" /> : null}
        {versions.isError ? <ErrorState error={versions.error} /> : null}
        {versions.data ? (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {versions.data.versions.map((version) => (
              <Card key={version.id} className="flex items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-semibold capitalize">{version.operation}</p>
                  <p className="mt-1 text-xs text-muted">
                    {formatBytes(version.byteSize)} · {formatDate(version.createdAt)}
                  </p>
                </div>
                <Button asChild variant="ghost" className="px-3">
                  <a
                    href={api.versionContentUrl(documentId, version.id)}
                    download={`${record.originalName}-${version.operation}.pdf`}
                  >
                    Unduh
                  </a>
                </Button>
              </Card>
            ))}
          </div>
        ) : null}
      </section>
      <ConfirmDialog open={renameOpen} onOpenChange={setRenameOpen} title="Rename document" description={<div><p>Only the display name changes; the UUID-backed storage path stays untouched.</p><label className="mt-4 block font-bold text-ink" htmlFor="rename-document">PDF name</label><input id="rename-document" className="form-control mt-1" value={name} onChange={(event) => setName(event.target.value)} aria-invalid={rename.isError} />{rename.isError ? <p className="mt-2 text-red-700" role="alert">{userFacingError(rename.error)}</p> : null}</div>} confirmLabel="Rename" pending={rename.isPending} onConfirm={() => rename.mutate()} />
    </main>
  );
}
