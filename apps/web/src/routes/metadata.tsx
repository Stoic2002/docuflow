import { createFileRoute } from "@tanstack/react-router";
import { PhaseOneToolPage } from "../features/tools/phase-one-tool-page";
export const Route = createFileRoute("/metadata")({ component: () => <PhaseOneToolPage kind="metadata" /> });
