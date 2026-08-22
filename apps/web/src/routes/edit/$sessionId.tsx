import { createFileRoute } from "@tanstack/react-router";
import { OverlayEditor } from "../../features/editor/overlay-editor";

export const Route = createFileRoute("/edit/$sessionId")({ component: EditSessionRoute });
function EditSessionRoute() { const { sessionId } = Route.useParams(); return <OverlayEditor sessionId={sessionId} />; }
