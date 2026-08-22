import { createFileRoute } from "@tanstack/react-router";
import { TrashPage } from "../features/documents/trash-page";

export const Route = createFileRoute("/trash")({ component: TrashPage });
