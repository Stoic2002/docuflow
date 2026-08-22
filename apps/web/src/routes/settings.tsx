import { Card } from "@pdf-studio/ui";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { capabilitiesQuery } from "../api/queries";
import { ErrorState, LoadingState } from "../components/async-state";
import { PageHeading } from "../components/page-heading";

export const Route = createFileRoute("/settings")({ component: SettingsPage });

function SettingsPage() {
  const query = useQuery(capabilitiesQuery);
  return (
    <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <PageHeading eyebrow="System status" title="Pengaturan & capabilities" description="Nilai rahasia dikonfigurasi melalui environment lokal, bukan disimpan oleh UI." />
      {query.isPending ? <LoadingState /> : null}
      {query.isError ? <ErrorState error={query.error} /> : null}
      {query.data ? (
        <Card className="mt-8 border-ink p-6 sm:p-8">
          <dl className="divide-y divide-dashed divide-line text-sm">
            <div className="flex justify-between gap-4 py-4 first:pt-0"><dt className="font-bold text-ink">Database</dt><dd className="text-muted">{query.data.database.available ? "Available" : "Unavailable"}</dd></div>
            <div className="flex justify-between gap-4 py-4"><dt className="font-bold text-ink">Storage</dt><dd className="text-muted">{query.data.storage.available ? "Available" : "Unavailable"}</dd></div>
            <div className="flex justify-between gap-4 py-4"><dt className="font-bold text-ink">qpdf</dt><dd className="max-w-lg text-right text-muted">{query.data.tools.qpdf.version ?? query.data.tools.qpdf.reason}</dd></div>
            <div className="flex justify-between gap-4 py-4"><dt className="font-bold text-ink">OCRmyPDF</dt><dd className="max-w-lg text-right text-muted">{query.data.tools.ocrmypdf.version ?? query.data.tools.ocrmypdf.reason}</dd></div>
            <div className="flex justify-between gap-4 py-4 last:pb-0"><dt className="font-bold text-ink">Native editing SDK</dt><dd className="text-muted">Belum dipilih</dd></div>
          </dl>
        </Card>
      ) : null}
    </main>
  );
}
