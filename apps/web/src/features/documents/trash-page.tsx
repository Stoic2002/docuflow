import { api, userFacingError, type BulkDeleteResult, type DocumentRecord } from "@pdf-studio/api-client";
import { Button, Card, Checkbox, ConfirmDialog } from "@pdf-studio/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { queryKeys, trashQuery } from "../../api/queries";
import { ErrorState, LoadingState } from "../../components/async-state";
import { PageHeading } from "../../components/page-heading";
import { formatBytes, formatDate } from "../../lib/format";

export function TrashPage() {
  const query = useQuery(trashQuery);
  const queryClient = useQueryClient();
  const [documentToPurge, setDocumentToPurge] = useState<DocumentRecord>();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // Held separately from the live selection so the dialog keeps naming the same
  // count while it animates away and the selection is being cleared.
  const [bulkTarget, setBulkTarget] = useState<string[]>([]);
  const [bulkFailures, setBulkFailures] = useState<BulkDeleteResult["failed"]>([]);
  const restoreMutation = useMutation({
    mutationFn: (id: string) => api.restoreDocument(id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.documents }),
        queryClient.invalidateQueries({ queryKey: queryKeys.trash }),
      ]);
    },
  });
  const purgeMutation = useMutation({
    mutationFn: (id: string) => api.permanentlyDeleteDocument(id),
    onSuccess: async () => {
      setDocumentToPurge(undefined);
      await queryClient.invalidateQueries({ queryKey: queryKeys.trash });
    },
  });
  const bulkPurgeMutation = useMutation({
    mutationFn: (ids: string[]) => api.bulkPermanentlyDeleteDocuments(ids),
    onSuccess: async (result) => {
      setBulkTarget([]);
      setSelectedIds([]);
      setBulkFailures(result.failed);
      await queryClient.invalidateQueries({ queryKey: queryKeys.trash });
    },
  });

  const documents = query.data?.documents ?? [];
  // A restore or a purge can retire an id while it is still selected, so the
  // list is filtered against what Trash actually holds right now.
  const selected = selectedIds.filter((id) => documents.some((document) => document.id === id));
  const allSelected = documents.length > 0 && selected.length === documents.length;
  const busy = restoreMutation.isPending || purgeMutation.isPending || bulkPurgeMutation.isPending;
  const nameOf = (id: string) => documents.find((document) => document.id === id)?.originalName ?? id;

  return (
    <main className="page-shell space-y-8 py-12">
      <PageHeading
        eyebrow="Recoverable storage"
        title="Trash"
        description="Dokumen di sini tidak muncul di Recent, tetapi original dan seluruh versi masih tersimpan sampai Anda menghapusnya secara permanen."
        aside={<Button asChild variant="secondary"><Link to="/recent"><ArrowLeft className="size-4" /> Kembali ke Recent</Link></Button>}
      />

      {query.isPending ? <LoadingState label="Memuat Trash…" /> : null}
      {query.isError ? <ErrorState error={query.error} retry={() => void query.refetch()} /> : null}
      {restoreMutation.isError ? <Card className="border-accent bg-accent-soft p-5 text-sm text-ink" role="alert">Tidak dapat memulihkan dokumen: {userFacingError(restoreMutation.error)}</Card> : null}
      {purgeMutation.isError ? <Card className="border-accent bg-accent-soft p-5 text-sm text-ink" role="alert">Tidak dapat menghapus permanen: {userFacingError(purgeMutation.error)}</Card> : null}
      {bulkPurgeMutation.isError ? <Card className="border-accent bg-accent-soft p-5 text-sm text-ink" role="alert">Tidak dapat menghapus dokumen terpilih: {userFacingError(bulkPurgeMutation.error)} Tidak ada file yang dihapus.</Card> : null}
      {bulkFailures.length ? <Card className="border-accent bg-accent-soft p-5 text-sm text-ink" role="alert">{bulkFailures.length} dokumen tidak dapat dihapus dan masih ada di Trash: {bulkFailures.map((failure) => nameOf(failure.documentId)).join(", ")}.</Card> : null}

      {documents.length === 0 && query.data ? (
        <Card className="border-dashed px-6 py-16 text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent"><Trash2 className="size-5" /></div>
          <h2 className="font-display text-3xl font-medium text-ink">Trash masih kosong</h2>
          <p className="mt-2 text-sm text-muted">Dokumen yang dihapus dari Recent akan muncul di sini.</p>
        </Card>
      ) : null}

      {documents.length ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-canvas px-5 py-3">
            <div className="flex items-center gap-3">
              <Checkbox
                label="Pilih semua dokumen di Trash"
                checked={allSelected}
                indeterminate={selected.length > 0 && !allSelected}
                onChange={(event) => setSelectedIds(event.target.checked ? documents.map((document) => document.id) : [])}
              />
              <p className="text-sm font-bold text-ink">{selected.length ? `${selected.length} dokumen dipilih` : "Pilih semua"}</p>
            </div>
            {selected.length ? (
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="ghost" className="px-4" onClick={() => setSelectedIds([])}>Batalkan pilihan</Button>
                <Button
                  type="button"
                  variant="danger"
                  className="px-4"
                  disabled={busy}
                  onClick={() => { bulkPurgeMutation.reset(); setBulkFailures([]); setBulkTarget(selected); }}
                >
                  <Trash2 className="size-4" aria-hidden="true" /> Hapus {selected.length} permanen
                </Button>
              </div>
            ) : null}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {documents.map((document) => (
              <Card key={document.id} className={`flex flex-col justify-between gap-6 border-ink p-6 sm:flex-row sm:items-center ${selected.includes(document.id) ? "bg-accent-soft/40" : ""}`}>
                <div className="flex min-w-0 items-start gap-3">
                  <Checkbox
                    className="mt-1.5"
                    label={`Pilih ${document.originalName}`}
                    checked={selected.includes(document.id)}
                    onChange={(event) => setSelectedIds((current) => (
                      event.target.checked ? [...current, document.id] : current.filter((id) => id !== document.id)
                    ))}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-lg font-black text-ink">{document.originalName}</p>
                    <p className="mt-2 text-sm text-muted">{formatBytes(document.byteSize)} · Dihapus {formatDate(document.deletedAt ?? document.updatedAt)}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className="px-4"
                    disabled={busy}
                    onClick={() => { restoreMutation.reset(); restoreMutation.mutate(document.id); }}
                  >
                    <RotateCcw className="size-4" />
                    {restoreMutation.isPending && restoreMutation.variables === document.id ? "Memulihkan…" : "Pulihkan"}
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    className="px-4"
                    disabled={busy}
                    onClick={() => { purgeMutation.reset(); setDocumentToPurge(document); }}
                  >
                    <Trash2 className="size-4" /> Permanen
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </>
      ) : null}

      <ConfirmDialog
        open={Boolean(documentToPurge)}
        onOpenChange={(open) => { if (!open) setDocumentToPurge(undefined); }}
        title="Hapus permanen?"
        description={documentToPurge ? <><strong className="font-semibold text-ink">{documentToPurge.originalName}</strong>, original PDF, dan seluruh versinya akan dihapus dari disk. Tindakan ini tidak dapat dibatalkan.</> : ""}
        cancelLabel="Batal"
        confirmLabel="Hapus selamanya"
        danger
        pending={purgeMutation.isPending}
        onConfirm={() => { if (documentToPurge) purgeMutation.mutate(documentToPurge.id); }}
      />

      <ConfirmDialog
        open={bulkTarget.length > 0}
        onOpenChange={(open) => { if (!open) setBulkTarget([]); }}
        title={`Hapus ${bulkTarget.length} dokumen permanen?`}
        description={<>Original PDF dan seluruh versi dari {bulkTarget.length} dokumen terpilih akan dihapus dari disk. Tindakan ini tidak dapat dibatalkan.</>}
        cancelLabel="Batal"
        confirmLabel={`Hapus ${bulkTarget.length} selamanya`}
        danger
        pending={bulkPurgeMutation.isPending}
        onConfirm={() => bulkPurgeMutation.mutate(bulkTarget)}
      />
    </main>
  );
}
