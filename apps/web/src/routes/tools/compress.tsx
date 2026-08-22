import { createFileRoute } from "@tanstack/react-router";
import { redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/tools/compress")({ beforeLoad: () => { throw redirect({ to: "/compress" }); } });
