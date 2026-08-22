import type { QueryClient } from "@tanstack/react-query";
import { Link, Outlet, createRootRouteWithContext, useMatchRoute } from "@tanstack/react-router";
import { Files } from "lucide-react";

type RouterContext = { queryClient: QueryClient };

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: () => (
    <main className="mx-auto max-w-3xl px-5 py-16 text-center">
      <h1 className="text-3xl font-bold">Halaman tidak ditemukan</h1>
      <Link to="/all-tools" className="mt-5 inline-block font-semibold text-accent hover:underline">
        Lihat semua tool
      </Link>
    </main>
  ),
});

function RootLayout() {
  // The editor is a workspace, not a page: it gives the whole viewport to the
  // canvas and carries its own way back, so the site chrome steps aside.
  const matchRoute = useMatchRoute();
  const fullscreen = Boolean(matchRoute({ to: "/edit/$sessionId" }));
  return (
    <>
      <header className={`sticky top-0 z-40 border-b border-line bg-canvas/90 backdrop-blur-xl ${fullscreen ? "hidden" : ""}`}>
        <nav className="page-shell flex min-h-20 items-center justify-between gap-5" aria-label="Navigasi utama">
          <Link to="/" className="group flex shrink-0 items-center gap-3 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            <span className="flex size-10 items-center justify-center rounded-full bg-accent text-white transition group-hover:rotate-6">
              <Files className="size-5" aria-hidden="true" />
            </span>
            <span className="text-xl font-black tracking-[-0.04em] text-ink">Docuflow</span>
          </Link>
          <div className="flex items-center gap-1 overflow-x-auto py-2 text-sm font-bold">
            <Link to="/edit" className="whitespace-nowrap rounded-full px-3.5 py-2 text-ink hover:bg-accent-soft hover:text-accent [&.active]:bg-ink [&.active]:text-paper">
              Edit PDF
            </Link>
            <Link to="/merge" className="whitespace-nowrap rounded-full px-3.5 py-2 text-ink hover:bg-accent-soft hover:text-accent [&.active]:bg-ink [&.active]:text-paper">
              Merge
            </Link>
            <Link to="/split" className="whitespace-nowrap rounded-full px-3.5 py-2 text-ink hover:bg-accent-soft hover:text-accent [&.active]:bg-ink [&.active]:text-paper">
              Split
            </Link>
            <Link to="/compress" className="whitespace-nowrap rounded-full px-3.5 py-2 text-ink hover:bg-accent-soft hover:text-accent [&.active]:bg-ink [&.active]:text-paper">
              Compress
            </Link>
            <Link to="/convert" className="hidden whitespace-nowrap rounded-full px-3.5 py-2 text-ink hover:bg-accent-soft hover:text-accent xl:block [&.active]:bg-ink [&.active]:text-paper">
              Convert
            </Link>
            <Link to="/all-tools" className="whitespace-nowrap rounded-full px-3.5 py-2 text-ink hover:bg-accent-soft hover:text-accent [&.active]:bg-ink [&.active]:text-paper">
              All Tools
            </Link>
            <Link to="/recent" className="ml-2 whitespace-nowrap rounded-full border border-line bg-paper px-3.5 py-2 text-muted hover:border-ink hover:text-ink [&.active]:border-accent [&.active]:bg-accent [&.active]:text-white">
              Recent
            </Link>
          </div>
        </nav>
      </header>
      <Outlet />
    </>
  );
}
