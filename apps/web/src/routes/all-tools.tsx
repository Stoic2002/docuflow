import { createFileRoute } from "@tanstack/react-router";
import { AllToolsPage } from "../features/tools/all-tools-page";
export const Route = createFileRoute("/all-tools")({ component: AllToolsPage });
