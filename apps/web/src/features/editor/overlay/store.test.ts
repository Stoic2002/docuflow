import { beforeEach, describe, expect, it } from "vitest";
import { hitTest, useOverlayStore } from "./store";
import { MAX_OBJECTS_PER_PAGE, type BoxObject, type OverlayObject, type TextObject } from "./types";

function box(id: string, page = 1, overrides: Partial<BoxObject> = {}): BoxObject {
  return {
    id, kind: "rectangle", page, x: 10, y: 10, width: 100, height: 50,
    stroke: "#000000", strokeWidth: 2, fill: null, opacity: 1, rotation: 0, ...overrides,
  };
}
function text(id: string, page = 1): TextObject {
  return {
    id, kind: "text", page, text: "halo", x: 200, y: 400, fontSize: 20,
    font: "", color: "#111111", align: "left", opacity: 1, rotation: 0,
  };
}
const state = () => useOverlayStore.getState();

beforeEach(() => state().reset());

describe("overlay store", () => {
  it("adds an object and selects it", () => {
    expect(state().add(box("a"))).toBe(true);
    expect(state().objects).toHaveLength(1);
    expect(state().selectedId).toBe("a");
  });

  it("refuses to exceed the server's per-page object limit", () => {
    for (let index = 0; index < MAX_OBJECTS_PER_PAGE; index += 1) state().add(box(`a${index}`));
    expect(state().objects).toHaveLength(MAX_OBJECTS_PER_PAGE);
    expect(state().add(box("overflow"))).toBe(false);
    expect(state().lastLimit).toBe("page");
    // The limit is per page, so another page still accepts objects.
    expect(state().add(box("other", 2))).toBe(true);
  });

  it("moves every kind by the same delta", () => {
    state().add(box("a"));
    state().move("a", 15, -5);
    expect(state().objects[0]).toMatchObject({ x: 25, y: 5 });
    state().reset();
    state().add({
      id: "p", kind: "draw", page: 1, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
      stroke: "#000000", strokeWidth: 1, opacity: 1, rotation: 0,
    });
    state().move("p", 5, 5);
    expect((state().objects[0] as { points: { x: number }[] }).points).toEqual([{ x: 5, y: 5 }, { x: 15, y: 15 }]);
  });

  it("undoes and redoes an edit", () => {
    state().add(box("a"));
    state().update("a", { width: 300 });
    expect((state().objects[0] as BoxObject).width).toBe(300);
    state().undo();
    expect((state().objects[0] as BoxObject).width).toBe(100);
    state().redo();
    expect((state().objects[0] as BoxObject).width).toBe(300);
  });

  it("does not record history for the stream of updates during a drag", () => {
    state().add(box("a"));
    const before = state().past.length;
    state().update("a", { x: 20 }, { history: false });
    state().update("a", { x: 30 }, { history: false });
    expect(state().past.length).toBe(before);
    state().undo();
    // One undo returns to the state before the object existed, not mid-drag.
    expect(state().objects).toHaveLength(0);
  });

  it("clears redo once a new edit lands", () => {
    state().add(box("a"));
    state().update("a", { width: 300 });
    state().undo();
    expect(state().future).toHaveLength(1);
    state().update("a", { width: 150 });
    expect(state().future).toHaveLength(0);
  });

  it("deselects an object that undo removed", () => {
    state().add(box("a"));
    expect(state().selectedId).toBe("a");
    state().undo();
    expect(state().selectedId).toBeNull();
  });

  it("releases an image file only when the last object using it goes", () => {
    const file = new File(["x"], "ttd.jpg", { type: "image/jpeg" });
    const image = (id: string): OverlayObject => ({
      id, kind: "image", page: 1, asset: "ttd", centerX: 100, centerY: 100,
      width: 50, height: 50, previewUrl: "blob:x", opacity: 1, rotation: 0,
    });
    state().add(image("i1"), file);
    state().add(image("i2"), file);
    state().remove("i1");
    expect(state().assets).toHaveProperty("ttd");
    state().remove("i2");
    expect(state().assets).toEqual({});
  });

  it("clears one page without touching the others", () => {
    state().add(box("a", 1));
    state().add(box("b", 2));
    state().clearPage(1);
    expect(state().objects.map((object) => object.id)).toEqual(["b"]);
  });

  it("leaves selection alone when switching back to the select tool", () => {
    state().add(box("a"));
    state().setTool("rectangle");
    expect(state().selectedId).toBeNull();
    state().select("a");
    state().setTool("select");
    expect(state().selectedId).toBe("a");
  });
});

describe("hitTest", () => {
  it("returns the topmost object under the point", () => {
    const lower = box("lower");
    const upper = box("upper", 1, { x: 20, y: 20 });
    expect(hitTest([lower, upper], 1, 50, 40)?.id).toBe("upper");
  });

  it("ignores objects on other pages", () => {
    expect(hitTest([box("a", 2)], 1, 50, 30)).toBeNull();
  });

  it("returns null when the point is empty", () => {
    expect(hitTest([box("a")], 1, 900, 900)).toBeNull();
  });

  it("finds text from its baseline anchor", () => {
    expect(hitTest([text("t")], 1, 210, 405)?.id).toBe("t");
  });
});

describe("addMany", () => {
  it("adds a cover and its replacement as one undo step", () => {
    const cover = box("cover", 1, { fill: "#ffffff", strokeWidth: 0 });
    expect(state().addMany([cover, text("replacement")])).toBe(true);
    expect(state().objects).toHaveLength(2);
    expect(state().selectedId).toBe("replacement");
    state().undo();
    // Undo must not leave the cover behind with the text gone.
    expect(state().objects).toHaveLength(0);
  });

  it("rejects a group that would cross the per-page limit", () => {
    for (let index = 0; index < MAX_OBJECTS_PER_PAGE - 1; index += 1) state().add(box(`a${index}`));
    expect(state().addMany([box("x"), box("y")])).toBe(false);
    expect(state().lastLimit).toBe("page");
    expect(state().objects).toHaveLength(MAX_OBJECTS_PER_PAGE - 1);
  });

  it("ignores an empty group", () => {
    expect(state().addMany([])).toBe(false);
    expect(state().past).toHaveLength(0);
  });
});
