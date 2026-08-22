import { createFileRoute } from "@tanstack/react-router";
import { DocumentDetailPage } from "../../../features/documents/document-detail-page";

export const Route = createFileRoute("/documents/$documentId/")({
  component: DocumentRoute,
});

function DocumentRoute() {
  const { documentId } = Route.useParams();
  return <DocumentDetailPage documentId={documentId} />;
}
