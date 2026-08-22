import { FallbackViewerEngine } from "@pdf-studio/pdf-engine";
import { useEffect, useState } from "react";
import { ErrorState, LoadingState } from "./async-state";

export function PdfViewer({ source, title }: { source: string; title: string }) {
  const [viewerSource, setViewerSource] = useState<string>();
  const [error, setError] = useState<unknown>();

  useEffect(() => {
    const engine = new FallbackViewerEngine();
    let active = true;
    engine
      .load(source)
      .then(() => {
        if (active) setViewerSource(engine.getViewerSource());
      })
      .catch((reason: unknown) => {
        if (active) setError(reason);
      });
    return () => {
      active = false;
      void engine.destroy();
    };
  }, [source]);

  if (error) return <ErrorState error={error} />;
  if (!viewerSource) return <LoadingState label="Membuka PDF…" />;
  return (
    <iframe
      className="h-[72vh] min-h-[520px] w-full rounded-[1.75rem] border border-ink bg-[#d8d3ca]"
      src={`${viewerSource}#toolbar=1&navpanes=1&view=FitH`}
      title={title}
    />
  );
}
