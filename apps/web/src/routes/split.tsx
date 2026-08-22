import { createFileRoute } from "@tanstack/react-router";
import { DirectToolPage } from "../features/tools/direct-tool-page";
export const Route = createFileRoute("/split")({ component: () => <DirectToolPage kind="split" /> });
