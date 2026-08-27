import { beforeEach, describe, expect, it } from "vitest";
import { ZOOM_MAX, ZOOM_MIN, clampZoom, hitTest, pickAt, useOverlayStore } from "./store";
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

describe("duplicate and depth", () => {
  it("copies an object with a new id, offset so it is not hidden behind the original", () => {
    state().add(box("a"));
    state().duplicate("a");
    const [original, copy] = state().objects as BoxObject[];
    expect(copy.id).not.toBe(original.id);
    expect(copy).toMatchObject({ x: original.x + 12, y: original.y - 12, width: original.width });
    expect(state().selectedId).toBe(copy.id);
  });

  it("offsets every point of a duplicated path", () => {
    state().add({
      id: "p", kind: "draw", page: 1, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
      stroke: "#000000", strokeWidth: 1, opacity: 1, rotation: 0,
    });
    state().duplicate("p");
    expect((state().objects[1] as { points: { x: number; y: number }[] }).points)
      .toEqual([{ x: 12, y: -12 }, { x: 22, y: -2 }]);
  });

  it("moves an object to the end of the list to bring it forward", () => {
    state().add(box("a"));
    state().add(box("b"));
    state().bringToFront("a");
    expect(state().objects.map((object) => object.id)).toEqual(["b", "a"]);
  });

  it("moves an object to the front of the list to send it behind", () => {
    state().add(box("a"));
    state().add(box("b"));
    state().sendToBack("b");
    expect(state().objects.map((object) => object.id)).toEqual(["b", "a"]);
  });

  it("records depth changes in history", () => {
    state().add(box("a"));
    state().add(box("b"));
    state().sendToBack("b");
    state().undo();
    expect(state().objects.map((object) => object.id)).toEqual(["a", "b"]);
  });

  it("ignores a depth change for an object that is gone", () => {
    state().add(box("a"));
    const before = state().past.length;
    state().bringToFront("tidak-ada");
    expect(state().past.length).toBe(before);
  });
});

describe("viewport state", () => {
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

  it("clamps zoom set through the store and holds no document bytes", () => {
    state().setPage(14);
    state().setZoom(99);
    expect(state()).toMatchObject({ page: 14, zoom: ZOOM_MAX });
    expect(state()).not.toHaveProperty("document");
    expect(state()).not.toHaveProperty("arrayBuffer");
  });

  it("restores the viewport when the session is torn down", () => {
    state().setPage(9);
    state().setZoom(3);
    state().reset();
    expect(state()).toMatchObject({ page: 1, zoom: 1 });
  });
});

describe("pinned patches", () => {
  /** What a cover-and-retype pick leaves behind: a patch, plus its replacement. */
  function retypePair() {
    const cover = box("cover", 1, { groupId: "g", pinned: true, x: 200, y: 392, width: 120, height: 24 });
    const replacement: TextObject = { ...text("teks"), groupId: "g" };
    state().addMany([cover, replacement]);
    return { cover, replacement };
  }

  it("leaves the patch behind when the replacement is dragged away", () => {
    retypePair();
    state().move("teks", 40, -30);
    const [cover, replacement] = state().objects as [BoxObject, TextObject];
    // The patch hides the printed text, so moving it would let the original
    // show through next to the replacement.
    expect(cover).toMatchObject({ x: 200, y: 392 });
    expect(replacement).toMatchObject({ x: 240, y: 370 });
  });

  it("still deletes the pair together", () => {
    retypePair();
    state().remove("teks");
    expect(state().objects).toHaveLength(0);
  });

  it("still restacks the pair together, patch first", () => {
    state().add(box("lain"));
    retypePair();
    state().sendToBack("teks");
    expect(state().objects.map((object) => object.id)).toEqual(["cover", "teks", "lain"]);
  });

  it("duplicates the replacement without copying the patch", () => {
    retypePair();
    state().duplicate("teks");
    const copies = state().objects.filter((object) => !["cover", "teks"].includes(object.id));
    expect(copies).toHaveLength(1);
    expect(copies[0].kind).toBe("text");
  });

  it("moves a whole taken-over paragraph as one, patches excepted", () => {
    // A block arrives as one patch and one text object per line, all sharing a
    // group: dragging any line should carry the paragraph.
    state().addMany([
      box("patch-1", 1, { groupId: "blok", pinned: true, x: 200, y: 392 }),
      { ...text("baris-1"), groupId: "blok", y: 400 },
      box("patch-2", 1, { groupId: "blok", pinned: true, x: 200, y: 378 }),
      { ...text("baris-2"), groupId: "blok", y: 386 },
    ]);
    state().move("baris-1", 0, -20);
    const byId = Object.fromEntries(state().objects.map((object) => [object.id, object]));
    expect((byId["baris-1"] as TextObject).y).toBe(380);
    expect((byId["baris-2"] as TextObject).y).toBe(366);
    expect((byId["patch-1"] as BoxObject).y).toBe(392);
    expect((byId["patch-2"] as BoxObject).y).toBe(378);
  });

  it("hands a click on the patch over to the replacement", () => {
    retypePair();
    // A point inside the patch but clear of the words themselves.
    expect(pickAt(state().objects, 1, 310, 400)?.id).toBe("teks");
  });

  it("picks an ordinary object exactly as hitTest does", () => {
    state().add(box("a"));
    expect(pickAt(state().objects, 1, 20, 20)?.id).toBe("a");
    expect(pickAt(state().objects, 1, 900, 900)).toBeNull();
  });
});

describe("replace", () => {
  it("swaps one object for its pieces, in the same place in the stack", () => {
    state().add(box("bawah"));
    state().add(text("asal"));
    state().add(box("atas"));
    const pieces: OverlayObject[] = [
      { ...text("asal"), text: "satu" },
      { ...text("kedua"), text: "dua" },
    ];
    expect(state().replace("asal", pieces)).toBe(true);
    expect(state().objects.map((object) => object.id)).toEqual(["bawah", "asal", "kedua", "atas"]);
  });

  it("keeps the selection on the piece that carried the id", () => {
    state().add(text("asal"));
    state().replace("asal", [{ ...text("pertama") }, { ...text("asal") }]);
    expect(state().selectedId).toBe("asal");
  });

  it("records one history step, so a single undo puts the object back", () => {
    state().add(text("asal"));
    state().replace("asal", [{ ...text("a") }, { ...text("b") }]);
    state().undo();
    expect(state().objects.map((object) => object.id)).toEqual(["asal"]);
  });

  it("clears the text selection and bumps the revision", () => {
    state().add(text("asal"));
    state().setTextRange({ id: "asal", start: 1, end: 2 });
    const before = state().revision;
    state().replace("asal", [{ ...text("a") }, { ...text("b") }]);
    expect(state().textRange).toBeNull();
    expect(state().revision).toBe(before + 1);
  });

  it("refuses an id that is not there", () => {
    expect(state().replace("tidak-ada", [text("a")])).toBe(false);
  });
});
