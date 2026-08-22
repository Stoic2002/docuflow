import { userFacingError } from "@pdf-studio/api-client";
import { Button, Card } from "@pdf-studio/ui";

export function LoadingState({ label = "Memuat…" }: { label?: string }) {
  return (
    <div className="flex min-h-36 items-center justify-center text-sm text-muted" role="status">
      <span className="mr-3 size-4 animate-spin rounded-full border-2 border-line border-t-accent" />
      {label}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <Card className="border-accent bg-accent-soft p-5" role="alert">
      <h2 className="font-semibold text-ink">Permintaan gagal</h2>
      <p className="mt-1 text-sm text-muted">{userFacingError(error)} Original PDF tetap aman.</p>
      {retry ? (
        <Button className="mt-4" variant="secondary" onClick={retry}>
          Coba lagi
        </Button>
      ) : null}
    </Card>
  );
}
