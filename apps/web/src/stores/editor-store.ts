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
  setZoom: (zoom) => set({ zoom: Math.min(4, Math.max(0.25, zoom)) }),
  setDirtyUi: (dirtyUi) => set({ dirtyUi }),
  toggleLeftPanel: () => set((state) => ({ leftPanelOpen: !state.leftPanelOpen })),
  toggleRightPanel: () => set((state) => ({ rightPanelOpen: !state.rightPanelOpen })),
  reset: () => set(initialState),
}));
