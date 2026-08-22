import { createFileRoute } from "@tanstack/react-router";
import { redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/documents/")({ beforeLoad: () => { throw redirect({ to: "/recent" }); } });
