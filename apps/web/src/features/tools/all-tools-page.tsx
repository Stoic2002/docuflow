import { Card } from "@pdf-studio/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Combine, FileClock, FileKey, FileLock2, FileOutput, FileSearch, Hash, ListRestart, Minimize2, PenLine, ScanText, Split, Stamp, TextCursorInput } from "lucide-react";
import { capabilitiesQuery } from "../../api/queries";
import { PageHeading } from "../../components/page-heading";

const groups = [
  { name: "Organize", tools: [
    { to: "/recent", label: "Organize PDF", detail: "Choose a document, then reorder, rotate, delete, duplicate, extract, or insert pages.", icon: ListRestart, feature: "organize" },
    { to: "/merge", label: "Merge PDF", detail: "Combine several PDFs in a chosen file order.", icon: Combine, feature: "organize" },
    { to: "/split", label: "Split PDF", detail: "Create individual PDFs from selected pages.", icon: Split, feature: "organize" },
  ]},
  { name: "Edit & enhance", tools: [
    { to: "/edit", label: "Edit PDF", detail: "Add text, shapes, freehand marks, and images on top of a page.", icon: PenLine, feature: "annotate" },
    { to: "/watermark", label: "Watermark", detail: "Add text presets or a JPEG logo with page-aware placement.", icon: Stamp, feature: "watermark" },
    { to: "/page-numbers", label: "Page Numbers", detail: "Number a range, skip a cover, and customize the format.", icon: Hash, feature: "pageNumbers" },
    { to: "/header-footer", label: "Header & Footer", detail: "Use left, center, and right text with reusable variables.", icon: TextCursorInput, feature: "headerFooter" },
    { to: "/metadata", label: "PDF Metadata", detail: "Read, update, or clear title, author, subject, and keywords.", icon: FileSearch, feature: "metadata" },
  ]},
  { name: "Security", tools: [
    { to: "/protect", label: "Protect PDF", detail: "Set an open password and reader permissions with AES-256.", icon: FileLock2, feature: "protect" },
    { to: "/unlock", label: "Unlock PDF", detail: "Remove encryption with the correct existing password.", icon: FileKey, feature: "unlock" },
  ]},
  { name: "More", tools: [
    { to: "/compress", label: "Compress", detail: "Lossless structural optimization with qpdf.", icon: Minimize2, feature: "compression" },
    { to: "/ocr", label: "Searchable OCR", detail: "Add a searchable text layer to scanned PDFs.", icon: ScanText, feature: "searchableOcr" },
    { to: "/convert", label: "Convert", detail: "Create a PDF from JPG files.", icon: FileOutput, feature: "upload" },
    { to: "/recent", label: "Recent Files", detail: "Browse uploads and operation outputs with version history.", icon: FileClock, feature: "view" },
  ]},
] as const;

export function AllToolsPage() {
  const capabilities = useQuery(capabilitiesQuery);
  return <main className="page-shell py-12"><PageHeading eyebrow="All tools" title="A complete PDF foundation, in one place." description="Choose a focused workflow. Every modification creates a validated version and preserves the original." />
    <div className="mt-10 space-y-10">{groups.map((group) => <section key={group.name} aria-labelledby={`tools-${group.name}`}><div className="flex items-center gap-4"><h2 id={`tools-${group.name}`} className="text-xs font-black uppercase tracking-[.18em] text-accent">{group.name}</h2><span className="h-px flex-1 bg-line" /></div><div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{group.tools.map(({ to,label,detail,icon:Icon,feature }) => { const available = capabilities.data?.features[feature as keyof typeof capabilities.data.features] ?? false; return <Link key={`${group.name}-${label}`} to={to} className="group rounded-[1.75rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><Card className="h-full p-6 transition group-hover:-translate-y-1 group-hover:border-ink group-hover:shadow-[5px_5px_0_#ff2d2d]"><div className="flex items-start justify-between"><span className="flex size-11 items-center justify-center rounded-full bg-accent-soft text-accent"><Icon className="size-5" /></span><span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${available ? "bg-emerald-100 text-emerald-800" : "bg-[#e5e0d8] text-muted"}`}>{capabilities.isPending ? "Checking" : available ? "Available" : "Unavailable"}</span></div><h3 className="mt-7 text-xl font-black text-ink">{label}</h3><p className="mt-2 text-sm leading-6 text-muted">{detail}</p><ArrowUpRight className="mt-5 size-5 transition group-hover:translate-x-1 group-hover:-translate-y-1 group-hover:text-accent" /></Card></Link>; })}</div></section>)}</div>
  </main>;
}
