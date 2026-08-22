import { api } from "@pdf-studio/api-client";
import { Card } from "@pdf-studio/ui";
import { useQuery } from "@tanstack/react-query";
import { documentQuery } from "../../api/queries";
import { ErrorState, LoadingState } from "../../components/async-state";
import { FeatureButton } from "../../components/feature-button";
import { PdfViewer } from "../../components/pdf-viewer";
import { useEditorStore, type EditorTool } from "../../stores/editor-store";

const tools: Array<{ id: EditorTool; label: string; capability: "view" | "commercial" }> = [
  { id: "select", label: "Pilih", capability: "view" },
  { id: "text", label: "Teks", capability: "commercial" },
  { id: "image", label: "Gambar", capability: "commercial" },
  { id: "annotate", label: "Anotasi", capability: "commercial" },
  { id: "pages", label: "Halaman", capability: "view" },
];

export function EditorPage({ documentId }: { documentId: string }) {
  const query = useQuery(documentQuery(documentId));
  const selectedTool = useEditorStore((state) => state.selectedTool);
  const setSelectedTool = useEditorStore((state) => state.setSelectedTool);
  const zoom = useEditorStore((state) => state.zoom);
  const setZoom = useEditorStore((state) => state.setZoom);
  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState error={query.error} />;
  const record = query.data.document;
  return (
    <main className="min-h-[calc(100vh-81px)] bg-canvas">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-paper px-4 py-3">
        <div>
          <h1 className="font-display text-xl font-medium text-ink">{record.originalName}</h1>
          <p className="text-xs text-accent">Fallback viewer aktif · native/overlay editing belum tersedia</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-full px-2 py-1 focus-visible:ring-2 focus-visible:ring-accent"
            onClick={() => setZoom(zoom - 0.25)}
            aria-label="Perkecil zoom"
          >
            −
          </button>
          <span className="min-w-14 text-center text-sm">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            className="rounded-full px-2 py-1 focus-visible:ring-2 focus-visible:ring-accent"
            onClick={() => setZoom(zoom + 0.25)}
            aria-label="Perbesar zoom"
          >
            +
          </button>
          <FeatureButton
            available={false}
            unavailableReason="Export editing memerlukan SDK Apryse atau Nutrient beserta lisensi yang belum dipilih."
          >
            Simpan versi
          </FeatureButton>
        </div>
      </div>
      <div className="grid min-h-[calc(100vh-130px)] grid-cols-1 lg:grid-cols-[190px_minmax(0,1fr)_240px]">
        <aside className="border-r border-line bg-paper p-3" aria-label="Alat editor">
          <div className="grid gap-2">
            {tools.map((tool) => (
              <FeatureButton
                key={tool.id}
                variant={selectedTool === tool.id ? "primary" : "ghost"}
                available={tool.capability === "view"}
                unavailableReason="Tool ini memerlukan PDF editing SDK komersial; fallback hanya dapat melihat PDF."
                onClick={() => setSelectedTool(tool.id)}
              >
                {tool.label}
              </FeatureButton>
            ))}
          </div>
        </aside>
        <div className="overflow-auto p-5" style={{ zoom }}>
          <PdfViewer source={api.contentUrl(documentId)} title={`Editor ${record.originalName}`} />
        </div>
        <aside className="border-l border-line bg-paper p-4" aria-label="Properti editor">
          <h2 className="font-semibold">Properti</h2>
          <Card className="mt-3 bg-canvas p-3 text-sm text-muted">
            Tidak ada properti editable pada fallback viewer. Isi PDF tetap dimiliki engine, bukan Zustand.
          </Card>
        </aside>
      </div>
    </main>
  );
}
