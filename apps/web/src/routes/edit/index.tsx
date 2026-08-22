import { createFileRoute } from "@tanstack/react-router";
import { EditLandingPage } from "../../features/editor/edit-landing-page";

export const Route = createFileRoute("/edit/")({ component: EditLandingPage });
