import { api } from "@pdf-studio/api-client";
import { queryOptions } from "@tanstack/react-query";

export const queryKeys = {
  capabilities: ["capabilities"] as const,
  documents: ["documents"] as const,
  trash: ["documents", "trash"] as const,
  document: (id: string) => ["documents", id] as const,
  versions: (id: string) => ["documents", id, "versions"] as const,
  editSession: (id: string) => ["edit-sessions", id] as const,
  fonts: ["fonts"] as const,
  documentFonts: (id: string) => ["documents", id, "fonts"] as const,
};

export const capabilitiesQuery = queryOptions({
  queryKey: queryKeys.capabilities,
  queryFn: ({ signal }) => api.capabilities(signal),
});

export const fontsQuery = queryOptions({
  queryKey: queryKeys.fonts,
  queryFn: ({ signal }) => api.fonts(signal),
  // The registry is read once at server start, so this never goes stale mid-session.
  staleTime: Infinity,
});

export const documentFontsQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.documentFonts(id),
    queryFn: ({ signal }) => api.documentFonts(id, signal),
    // pdffonts may be absent; an empty list is a fine answer, not an error worth retrying.
    retry: false,
    staleTime: Infinity,
  });

export const documentsQuery = queryOptions({
  queryKey: queryKeys.documents,
  queryFn: ({ signal }) => api.documents(signal),
});

export const trashQuery = queryOptions({
  queryKey: queryKeys.trash,
  queryFn: ({ signal }) => api.trash(signal),
});

export const documentQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.document(id),
    queryFn: ({ signal }) => api.document(id, signal),
  });

export const versionsQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.versions(id),
    queryFn: ({ signal }) => api.versions(id, signal),
  });

export const editSessionQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.editSession(id),
    queryFn: ({ signal }) => api.editSession(id, signal),
  });
