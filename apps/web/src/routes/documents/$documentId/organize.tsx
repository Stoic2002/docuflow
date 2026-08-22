import { createFileRoute } from "@tanstack/react-router";
import { OrganizePage } from "../../../features/organize/organize-page";

export const Route = createFileRoute("/documents/$documentId/organize")({
  component: OrganizeDocumentRoute,
});

function OrganizeDocumentRoute() {
  const { documentId } = Route.useParams();
  return <OrganizePage documentId={documentId} />;
}
