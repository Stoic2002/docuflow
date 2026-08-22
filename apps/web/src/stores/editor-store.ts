import { create } from "zustand";

export type EditorTool = "select" | "text" | "image" | "annotate" | "pages";

type EditorState = {
  selectedTool: EditorTool;
  selectedPage: number;
  zoom: number;
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  dirtyUi: boolean;
  setSelectedTool: (tool: EditorTool) => void;
  setSelectedPage: (page: number) => void;
  setZoom: (zoom: number) => void;
  setDirtyUi: (dirty: boolean) => void;
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  reset: () => void;
};

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;

export function clampZoom(zoom: number): number {
  if (Number.isNaN(zoom)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

const initialState = {
  selectedTool: "select" as const,
  selectedPage: 1,
  zoom: 1,
  leftPanelOpen: true,
  rightPanelOpen: true,
  dirtyUi: false,
};

export const useEditorStore = create<EditorState>((set) => ({
  ...initialState,
  setSelectedTool: (selectedTool) => set({ selectedTool }),
  setSelectedPage: (selectedPage) => set({ selectedPage }),
  setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),
  setDirtyUi: (dirtyUi) => set({ dirtyUi }),
  toggleLeftPanel: () => set((state) => ({ leftPanelOpen: !state.leftPanelOpen })),
  toggleRightPanel: () => set((state) => ({ rightPanelOpen: !state.rightPanelOpen })),
  reset: () => set(initialState),
}));
