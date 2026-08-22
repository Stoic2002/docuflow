import { createFileRoute } from "@tanstack/react-router";
import { PreviewWorkspace } from "../../features/editor/preview-workspace";

export const Route = createFileRoute("/edit/$sessionId")({ component: EditSessionRoute });
function EditSessionRoute() { const { sessionId } = Route.useParams(); return <PreviewWorkspace sessionId={sessionId} />; }
