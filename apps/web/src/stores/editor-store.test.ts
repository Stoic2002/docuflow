import { beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "./editor-store";

describe("editor store", () => {
  beforeEach(() => useEditorStore.getState().reset());

  it("stores only bounded local UI state", () => {
    useEditorStore.getState().setSelectedTool("annotate");
    useEditorStore.getState().setSelectedPage(14);
    useEditorStore.getState().setZoom(99);
    expect(useEditorStore.getState()).toMatchObject({
      selectedTool: "annotate",
      selectedPage: 14,
      zoom: 4,
      dirtyUi: false,
    });
    expect(useEditorStore.getState()).not.toHaveProperty("document");
    expect(useEditorStore.getState()).not.toHaveProperty("arrayBuffer");
  });

  it("resets transient UI state", () => {
    useEditorStore.getState().setDirtyUi(true);
    useEditorStore.getState().setZoom(0);
    useEditorStore.getState().reset();
    expect(useEditorStore.getState()).toMatchObject({ selectedTool: "select", zoom: 1, dirtyUi: false });
  });
});
