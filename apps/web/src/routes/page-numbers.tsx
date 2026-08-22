import { createFileRoute } from "@tanstack/react-router";
import { PhaseOneToolPage } from "../features/tools/phase-one-tool-page";
export const Route = createFileRoute("/page-numbers")({ component: () => <PhaseOneToolPage kind="page-numbers" /> });
