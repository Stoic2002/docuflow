import { beforeEach, describe, expect, it } from "vitest";
import { ZOOM_MAX, ZOOM_MIN, clampZoom, useEditorStore } from "./editor-store";

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

describe("clampZoom", () => {
  it("keeps zoom inside the range the canvas can render", () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(0.01)).toBe(ZOOM_MIN);
    expect(clampZoom(99)).toBe(ZOOM_MAX);
  });

  it("survives a NaN from a malformed wheel delta", () => {
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it("accepts the fine-grained steps a trackpad pinch produces", () => {
    expect(clampZoom(1 * Math.exp(-3 / 180))).toBeCloseTo(0.9835, 3);
  });
});
