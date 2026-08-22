import { createFileRoute } from "@tanstack/react-router";
import { redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/documents/$documentId/edit")({
  beforeLoad: ({ params }) => { throw redirect({ to: "/edit/$sessionId", params: { sessionId: params.documentId } }); },
});
