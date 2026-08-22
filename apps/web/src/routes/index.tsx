import { Button, Card } from "@pdf-studio/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowUpRight, Combine, FilePenLine, Minimize2, Sparkles, Split } from "lucide-react";
import { capabilitiesQuery } from "../api/queries";
import { ErrorState, LoadingState } from "../components/async-state";

export const Route = createFileRoute("/")({ component: HomePage });

const quickTools = [
  { to: "/edit", label: "Edit PDF", detail: "Buka file dalam workspace Preview yang aman.", icon: FilePenLine, number: "01" },
  { to: "/merge", label: "Merge", detail: "Gabungkan beberapa PDF sesuai urutan Anda.", icon: Combine, number: "02" },
  { to: "/split", label: "Split", detail: "Pilih halaman dan unduh satu PDF per halaman.", icon: Split, number: "03" },
  { to: "/compress", label: "Compress", detail: "Optimalkan struktur PDF tanpa menimpa original.", icon: Minimize2, number: "04" },
] as const;

function HomePage() {
  const capabilities = useQuery(capabilitiesQuery);
  return (
    <main className="page-shell pb-20 pt-12 sm:pt-16">
      <section className="grid items-center gap-12 lg:grid-cols-[1.18fr_0.82fr] lg:gap-20">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-accent px-3 py-1.5 text-xs font-bold uppercase tracking-[0.14em] text-accent">
            <Sparkles className="size-3.5" aria-hidden="true" /> PDF work, made lighter
          </div>
          <h1 className="display-title mt-7 max-w-4xl text-6xl text-ink sm:text-7xl lg:text-[5.7rem]">
            Urus PDF tanpa alur yang ribet.
          </h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-muted sm:text-xl">
            Mulai langsung dari pekerjaan Anda. Upload sekali, proses dengan aman, dan selalu simpan original tetap utuh.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild><Link to="/edit">Mulai dengan PDF <ArrowUpRight className="size-4" /></Link></Button>
            <Button asChild variant="secondary"><Link to="/all-tools">Lihat semua tool</Link></Button>
          </div>
        </div>

        <Card className="relative overflow-hidden border-ink p-6 sm:p-8">
          <div className="absolute -right-10 -top-10 size-36 rounded-full bg-accent-soft" aria-hidden="true" />
          <div className="relative">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="eyebrow">Local readiness</p>
                <h2 className="font-display mt-2 text-3xl font-medium text-ink">Siap untuk bekerja?</h2>
              </div>
              <span className="flex size-12 items-center justify-center rounded-full bg-ink text-paper"><span className="size-2.5 rounded-full bg-accent" /></span>
            </div>
            <div className="dashed-rule my-6" />
            {capabilities.isPending ? <LoadingState /> : null}
            {capabilities.isError ? <ErrorState error={capabilities.error} /> : null}
            {capabilities.data ? (
              <dl className="space-y-4">
                {[
                  ["Storage lokal", capabilities.data.storage.available],
                  ["PostgreSQL", capabilities.data.database.available],
                  ["Merge & Split", capabilities.data.tools.qpdf.available],
                  ["Searchable OCR", capabilities.data.tools.ocrmypdf.available],
                  ["Native editing", capabilities.data.nativeContentEditing],
                ].map(([label, ready]) => (
                  <div key={String(label)} className="flex items-center justify-between gap-4">
                    <dt className="text-sm font-semibold text-ink">{label}</dt>
                    <dd className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted">
                      <span className={`size-2 rounded-full ${ready ? "bg-emerald-500" : "bg-accent"}`} />
                      {ready ? "Ready" : "Unavailable"}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        </Card>
      </section>

      <div className="dashed-rule my-16" />

      <section aria-labelledby="quick-tools">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="eyebrow">Start anywhere</p>
            <h2 id="quick-tools" className="font-display mt-2 text-4xl font-medium tracking-tight text-ink sm:text-5xl">Apa yang ingin Anda lakukan?</h2>
          </div>
          <Link to="/all-tools" className="inline-flex items-center gap-1 text-sm font-bold text-ink underline decoration-accent decoration-2 underline-offset-4 hover:text-accent">
            Semua tool <ArrowUpRight className="size-4" />
          </Link>
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {quickTools.map(({ to, label, detail, icon: Icon, number }) => (
            <Link key={to} to={to} className="group rounded-[1.75rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2">
              <Card className="h-full border-line p-5 transition duration-200 group-hover:-translate-y-1 group-hover:border-ink group-hover:shadow-[5px_5px_0_#ff2d2d]">
                <div className="flex items-start justify-between">
                  <span className="flex size-11 items-center justify-center rounded-full bg-accent-soft text-accent"><Icon className="size-5" /></span>
                  <span className="font-display text-2xl text-line">{number}</span>
                </div>
                <h3 className="mt-8 text-lg font-black text-ink">{label}</h3>
                <p className="mt-2 text-sm leading-6 text-muted">{detail}</p>
                <ArrowUpRight className="mt-6 size-5 text-ink transition group-hover:translate-x-1 group-hover:-translate-y-1 group-hover:text-accent" />
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
