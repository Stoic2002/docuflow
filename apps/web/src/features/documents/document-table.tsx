import { api, userFacingError, type BulkDeleteResult, type DocumentRecord } from "@pdf-studio/api-client";
import { Button, Card, Checkbox, ConfirmDialog } from "@pdf-studio/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type RowSelectionState,
} from "@tanstack/react-table";
import { Download, Eye, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { queryKeys } from "../../api/queries";
import { formatBytes, formatDate } from "../../lib/format";

const column = createColumnHelper<DocumentRecord>();

export function DocumentTable({ documents }: { documents: DocumentRecord[] }) {
  const queryClient = useQueryClient();
  const [documentToDelete, setDocumentToDelete] = useState<DocumentRecord>();
  const [documentToRename, setDocumentToRename] = useState<DocumentRecord>();
  const [renameName, setRenameName] = useState("");
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  // Held separately from the live selection so the dialog keeps naming the same
  // count while it animates away and the selection is being cleared.
  const [bulkTarget, setBulkTarget] = useState<string[]>([]);
  const [bulkFailures, setBulkFailures] = useState<BulkDeleteResult["failed"]>([]);
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteDocument(id),
    onSuccess: async (_, id) => {
      setDocumentToDelete(undefined);
      queryClient.setQueryData<{ documents: DocumentRecord[] }>(queryKeys.documents, (current) => ({
        documents: current?.documents.filter((document) => document.id !== id) ?? [],
      }));
      await queryClient.invalidateQueries({ queryKey: queryKeys.documents });
    },
  });
  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => api.bulkDeleteDocuments(ids),
    onSuccess: async (result) => {
      setBulkTarget([]);
      setRowSelection({});
      setBulkFailures(result.failed);
      await queryClient.invalidateQueries({ queryKey: queryKeys.documents });
    },
  });
  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.renameDocument(id, name),
    onSuccess: async () => { setDocumentToRename(undefined); await queryClient.invalidateQueries({ queryKey: queryKeys.documents }); },
  });
  const columns = [
    column.display({
      id: "select",
      header: ({ table }) => (
        <Checkbox
          label="Pilih semua dokumen"
          checked={table.getIsAllRowsSelected()}
          indeterminate={table.getIsSomeRowsSelected()}
          onChange={table.getToggleAllRowsSelectedHandler()}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          label={`Pilih ${row.original.originalName}`}
          checked={row.getIsSelected()}
          onChange={row.getToggleSelectedHandler()}
        />
      ),
    }),
    column.accessor("originalName", {
      header: "Nama",
      cell: (context) => <span className="font-bold text-ink">{context.getValue()}</span>,
    }),
    column.accessor("pageCount", {
      header: "Halaman",
      cell: (context) => context.getValue() ?? "—",
    }),
    column.accessor("byteSize", {
      header: "Ukuran",
      cell: (context) => formatBytes(context.getValue()),
    }),
    column.accessor("createdAt", {
      header: "Diunggah",
      cell: (context) => formatDate(context.getValue()),
    }),
    column.display({
      id: "actions",
      header: "Aksi",
      cell: ({ row }) => (
        <div className="flex flex-wrap justify-end gap-2">
          <Button asChild variant="ghost" className="px-3">
            <Link to="/edit/$sessionId" params={{ sessionId: row.original.id }}>
              <Eye className="size-4" aria-hidden="true" /> Preview
            </Link>
          </Button>
          <Button asChild variant="secondary" className="px-3">
            <a href={api.contentUrl(row.original.id)} download={row.original.originalName}>
              <Download className="size-4" aria-hidden="true" /> Unduh
            </a>
          </Button>
          <Button type="button" variant="ghost" className="px-3" onClick={() => { renameMutation.reset(); setDocumentToRename(row.original); setRenameName(row.original.originalName); }}><Pencil className="size-4" aria-hidden="true" /> Rename</Button>
          <Button type="button" variant="ghost" className="px-3 text-red-700" onClick={() => { deleteMutation.reset(); setDocumentToDelete(row.original); }}>
            <Trash2 className="size-4" aria-hidden="true" /> Hapus
          </Button>
        </div>
      ),
    }),
  ];
  const table = useReactTable({
    data: documents,
    columns,
    getCoreRowModel: getCoreRowModel(),
    // Keyed by document id so a refetch that reorders rows keeps the selection
    // pointing at the same documents.
    getRowId: (row) => row.id,
    state: { rowSelection },
    onRowSelectionChange: setRowSelection,
  });
  const selected = table.getSelectedRowModel().rows.map((row) => row.original.id);
  const nameOf = (id: string) => documents.find((document) => document.id === id)?.originalName ?? id;

  if (documents.length === 0) {
    return (
      <Card className="border-dashed px-6 py-16 text-center">
        <div className="mx-auto mb-4 size-3 rounded-full bg-accent" />
        <h2 className="font-display text-3xl font-medium text-ink">Belum ada dokumen</h2>
        <p className="mt-2 text-sm text-muted">Mulai dari Edit, Merge, Split, Compress, atau OCR.</p>
      </Card>
    );
  }

  return (
    <>
    <Card className="overflow-hidden border-ink">
      {deleteMutation.isError ? (
        <div className="border-b border-accent bg-accent-soft px-5 py-3 text-sm text-ink" role="alert">
          Tidak dapat menghapus dari Recent: {userFacingError(deleteMutation.error)} File original tetap aman.
        </div>
      ) : null}
      {bulkDeleteMutation.isError ? (
        <div className="border-b border-accent bg-accent-soft px-5 py-3 text-sm text-ink" role="alert">
          Tidak dapat menghapus dokumen terpilih: {userFacingError(bulkDeleteMutation.error)} Semua file original tetap aman.
        </div>
      ) : null}
      {bulkFailures.length ? (
        <div className="border-b border-accent bg-accent-soft px-5 py-3 text-sm text-ink" role="alert">
          {bulkFailures.length} dokumen tidak dapat dihapus dan masih ada di Recent: {bulkFailures.map((failure) => nameOf(failure.documentId)).join(", ")}.
        </div>
      ) : null}
      {selected.length ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-canvas px-5 py-3">
          <p className="text-sm font-bold text-ink">{selected.length} dokumen dipilih</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" className="px-4" onClick={() => setRowSelection({})}>Batalkan pilihan</Button>
            <Button
              type="button"
              variant="danger"
              className="px-4"
              disabled={bulkDeleteMutation.isPending}
              onClick={() => { bulkDeleteMutation.reset(); setBulkFailures([]); setBulkTarget(selected); }}
            >
              <Trash2 className="size-4" aria-hidden="true" /> Hapus {selected.length} dari Recent
            </Button>
          </div>
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="border-b border-line bg-canvas text-xs uppercase tracking-[0.12em] text-muted">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th key={header.id} className="px-5 py-3 font-semibold last:text-right" scope="col">
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-line">
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className={`transition hover:bg-accent-soft/30 ${row.getIsSelected() ? "bg-accent-soft/40" : ""}`}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-5 py-4 text-muted">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
    <ConfirmDialog
      open={Boolean(documentToDelete)}
      onOpenChange={(open) => { if (!open) setDocumentToDelete(undefined); }}
      title="Hapus dari Recent?"
      description={documentToDelete ? <><strong className="font-semibold text-ink">{documentToDelete.originalName}</strong> akan hilang dari daftar Recent. File original tetap disimpan dan tidak ditimpa.</> : ""}
      cancelLabel="Batal"
      confirmLabel="Hapus dari Recent"
      danger
      pending={deleteMutation.isPending}
      onConfirm={() => { if (documentToDelete) deleteMutation.mutate(documentToDelete.id); }}
    />
    <ConfirmDialog
      open={bulkTarget.length > 0}
      onOpenChange={(open) => { if (!open) setBulkTarget([]); }}
      title={`Hapus ${bulkTarget.length} dokumen dari Recent?`}
      description={<>{bulkTarget.length} dokumen akan hilang dari daftar Recent dan pindah ke Trash. Semua file original tetap disimpan dan tidak ditimpa.</>}
      cancelLabel="Batal"
      confirmLabel={`Hapus ${bulkTarget.length} dari Recent`}
      danger
      pending={bulkDeleteMutation.isPending}
      onConfirm={() => bulkDeleteMutation.mutate(bulkTarget)}
    />
    <ConfirmDialog open={Boolean(documentToRename)} onOpenChange={(open) => { if (!open) setDocumentToRename(undefined); }} title="Rename document" description={<div><p>Only the display name changes. Duplicate display names are allowed.</p><label className="mt-4 block font-bold text-ink" htmlFor="recent-rename">PDF name</label><input id="recent-rename" className="form-control mt-1" value={renameName} onChange={(event) => setRenameName(event.target.value)} />{renameMutation.isError ? <p className="mt-2 text-red-700" role="alert">{userFacingError(renameMutation.error)}</p> : null}</div>} confirmLabel="Rename" pending={renameMutation.isPending} onConfirm={() => { if (documentToRename) renameMutation.mutate({ id: documentToRename.id, name: renameName }); }} />
    </>
  );
}
