import { createFileRoute } from "@tanstack/react-router";
import { PhaseOneToolPage } from "../features/tools/phase-one-tool-page";
export const Route = createFileRoute("/unlock")({ component: () => <PhaseOneToolPage kind="unlock" /> });
