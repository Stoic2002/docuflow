import { api, userFacingError, type DocumentRecord } from "@pdf-studio/api-client";
import { Button, Card, ConfirmDialog } from "@pdf-studio/ui";
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

      {query.data?.documents.length === 0 ? (
        <Card className="border-dashed px-6 py-16 text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent"><Trash2 className="size-5" /></div>
          <h2 className="font-display text-3xl font-medium text-ink">Trash masih kosong</h2>
          <p className="mt-2 text-sm text-muted">Dokumen yang dihapus dari Recent akan muncul di sini.</p>
        </Card>
      ) : null}

      {query.data?.documents.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {query.data.documents.map((document) => (
            <Card key={document.id} className="flex flex-col justify-between gap-6 border-ink p-6 sm:flex-row sm:items-center">
              <div className="min-w-0">
                <p className="truncate text-lg font-black text-ink">{document.originalName}</p>
                <p className="mt-2 text-sm text-muted">{formatBytes(document.byteSize)} · Dihapus {formatDate(document.deletedAt ?? document.updatedAt)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="px-4"
                  disabled={restoreMutation.isPending || purgeMutation.isPending}
                  onClick={() => { restoreMutation.reset(); restoreMutation.mutate(document.id); }}
                >
                  <RotateCcw className="size-4" />
                  {restoreMutation.isPending && restoreMutation.variables === document.id ? "Memulihkan…" : "Pulihkan"}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  className="px-4"
                  disabled={restoreMutation.isPending || purgeMutation.isPending}
                  onClick={() => { purgeMutation.reset(); setDocumentToPurge(document); }}
                >
                  <Trash2 className="size-4" /> Permanen
                </Button>
              </div>
            </Card>
          ))}
        </div>
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
    </main>
  );
}
