import { Button } from "@pdf-studio/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { documentsQuery } from "../../api/queries";
import { ErrorState, LoadingState } from "../../components/async-state";
import { PageHeading } from "../../components/page-heading";
import { DocumentTable } from "./document-table";

export function DocumentsPage() {
  const query = useQuery(documentsQuery);
  return (
    <main className="page-shell space-y-8 py-12">
      <PageHeading
        eyebrow="Riwayat sekunder"
        title="Recent Files"
        description="Riwayat persistence internal. Untuk memulai pekerjaan baru, buka tool lalu unggah langsung di sana."
        aside={<Button asChild variant="secondary"><Link to="/trash"><Trash2 className="size-4" /> Buka Trash</Link></Button>}
      />
      {query.isPending ? <LoadingState label="Memuat dokumen…" /> : null}
      {query.isError ? <ErrorState error={query.error} retry={() => void query.refetch()} /> : null}
      {query.data ? <DocumentTable documents={query.data.documents} /> : null}
    </main>
  );
}
