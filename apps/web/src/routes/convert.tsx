import { createFileRoute } from "@tanstack/react-router";
import { ConvertPage } from "../features/tools/convert-page";
export const Route = createFileRoute("/convert")({ component: ConvertPage });
