import { describe, expect, it } from "vitest";
import { alignPatch, gripRole, gripShape, gripsFor, handleCenter, ringStrips, scaleGroupPatches, unionBounds, wrapPatches } from "./scale";
import { boundsOf, type BoxObject, type ImageObject, type OverlayObject, type TextObject } from "./types";

const box: BoxObject = {
  id: "b1", kind: "rectangle", page: 1, x: 100, y: 100, width: 200, height: 100,
  stroke: "#1565c0", strokeWidth: 2, fill: null, opacity: 1, rotation: 0,
};
const text: TextObject = {
  id: "t1", kind: "text", page: 1, text: "Halo dunia", x: 100, y: 100, fontSize: 20,
  font: "", color: "#111111", align: "left", opacity: 1, rotation: 0,
};

function patchFor(id: string, patches: Array<[string, Partial<OverlayObject>]>) {
  const found = patches.find(([memberId]) => memberId === id);
  if (!found) throw new Error(`no patch for ${id}`);
  return found[1] as Record<string, number>;
}

describe("scaleGroupPatches", () => {
  // The bug this guards: patches used to be computed from the live objects with
  // only one move's travel, so every frame rewrote roughly the same size and a
  // lone object simply stopped growing.
  it("keeps growing a lone box as the drag travels further", () => {
    const widths = [10, 40, 90].map((dx) => patchFor("b1", scaleGroupPatches([box], "e", dx, 0)).width);
    expect(widths).toEqual([210, 240, 290]);
    expect(patchFor("b1", scaleGroupPatches([box], "e", 90, 0)).height).toBe(100);
  });

  it("returns the original size when the drag comes back to where it started", () => {
    expect(patchFor("b1", scaleGroupPatches([box], "e", 0, 0))).toMatchObject({
      x: 100, y: 100, width: 200, height: 100,
    });
  });

  it("scales about the corner opposite the handle", () => {
    // Dragging the west edge outward moves the left edge and pins the right one.
    const patch = patchFor("b1", scaleGroupPatches([box], "w", -50, 0));
    expect(patch.width).toBe(250);
    expect(patch.x).toBe(50);
    expect(patch.x + patch.width).toBe(300);
  });

  it("grows a box downward when its south edge is dragged down", () => {
    // PDF space counts Y upward, so dragging the bottom edge down is a fall in y.
    const patch = patchFor("b1", scaleGroupPatches([box], "s", 0, -50));
    expect(patch).toMatchObject({ y: 50, height: 150 });
    // An edge grip drives one axis only: the width is left alone.
    expect(patch).toMatchObject({ x: 100, width: 200 });
  });

  it("grows a box upward when its north edge is dragged up", () => {
    const patch = patchFor("b1", scaleGroupPatches([box], "n", 0, 50));
    expect(patch).toMatchObject({ y: 100, height: 150, width: 200 });
  });

  it("drives both axes from a corner", () => {
    const patch = patchFor("b1", scaleGroupPatches([box], "ne", 100, 50));
    expect(patch).toMatchObject({ x: 100, y: 100, width: 300, height: 150 });
  });

  it("grows from the north-east corner as the drag goes up and right", () => {
    // The regression this guards: "ne" once shared the west sign, so dragging
    // the corner outward shrank the box instead of growing it.
    expect(patchFor("b1", scaleGroupPatches([box], "ne", 100, 0)).width).toBe(300);
    expect(patchFor("b1", scaleGroupPatches([box], "se", 0, -50)).height).toBe(150);
  });

  it("never shrinks a box below the minimum drawable size", () => {
    expect(patchFor("b1", scaleGroupPatches([box], "e", -1000, 0)).width).toBe(10);
  });

  it("scales text through its font size rather than stretching it", () => {
    const patch = patchFor("t1", scaleGroupPatches([text], "se", text.text.length * text.fontSize * 0.52, 0));
    expect(patch.fontSize).toBeCloseTo(40, 5);
    expect(patch).not.toHaveProperty("width");
  });

  it("keeps a retype pair proportional and together", () => {
    const cover: BoxObject = { ...box, id: "c1", groupId: "g", x: 100, y: 95.6, width: 104, height: 24 };
    const replacement: TextObject = { ...text, id: "r1", groupId: "g" };
    const patches = scaleGroupPatches([cover, replacement], "e", 104, 0);
    // Both members double, and the text doubles its font size instead of melting.
    expect(patchFor("c1", patches).width).toBeCloseTo(208, 5);
    expect(patchFor("r1", patches).fontSize).toBeCloseTo(40, 5);
    // A vertical drag on a group with text still scales it uniformly.
    expect(patchFor("c1", scaleGroupPatches([cover, replacement], "e", 104, 999)).width).toBeCloseTo(208, 5);
  });

  it("moves an image by its centre", () => {
    const image: ImageObject = {
      id: "i1", kind: "image", page: 1, asset: "asset-1", centerX: 200, centerY: 150,
      width: 200, height: 100, previewUrl: "blob:x", opacity: 1, rotation: 0,
    };
    const patch = patchFor("i1", scaleGroupPatches([image], "e", 200, 0));
    expect(patch).toMatchObject({ width: 400, height: 100, centerX: 300, centerY: 150 });
  });

  it("has nothing to do for an empty selection", () => {
    expect(scaleGroupPatches([], "e", 10, 0)).toEqual([]);
  });
});

describe("unionBounds", () => {
  it("has no box for an empty selection", () => {
    expect(unionBounds([])).toBeNull();
  });

  it("returns the object's own bounds for a lone selection", () => {
    expect(unionBounds([box])).toEqual({ x: 100, y: 100, width: 200, height: 100 });
  });

  it("encloses every member of a retype pair", () => {
    // The patch is wider than the text it covers, so the frame has to follow
    // the patch — drawing it around the text alone put the grips off the mark.
    const cover: BoxObject = { ...box, id: "c1", groupId: "g", x: 90, y: 96, width: 220, height: 24 };
    const replacement: TextObject = { ...text, id: "r1", groupId: "g", x: 100, y: 100 };
    expect(unionBounds([cover, replacement])).toMatchObject({ x: 90, width: 220 });
  });
});

describe("handleCenter", () => {
  const frame = { x: 100, y: 200, width: 300, height: 80 };

  it("puts each grip exactly on the edge it drags", () => {
    // The report this guards: the right-hand grips sat short of the box edge
    // because the caret editor was wider than the frame the grips came from.
    expect(handleCenter("e", frame).x).toBe(400);
    expect(handleCenter("w", frame).x).toBe(100);
    expect(handleCenter("n", frame).y).toBe(280);
    expect(handleCenter("s", frame).y).toBe(200);
  });

  it("puts corner grips on the corners and edge grips at the middle", () => {
    expect(handleCenter("ne", frame)).toEqual({ x: 400, y: 280 });
    expect(handleCenter("sw", frame)).toEqual({ x: 100, y: 200 });
    expect(handleCenter("e", frame).y).toBe(240);
    expect(handleCenter("n", frame).x).toBe(250);
  });
});

describe("ringStrips", () => {
  // A page 800pt tall drawn at 2x: the frame's top edge lands at (800-280)*2.
  const strips = ringStrips({ x: 100, y: 200, width: 300, height: 80 }, 800, 2);
  const byEdge = (edge: string) => strips.find((strip) => strip.edge === edge)!.style;

  it("wraps all four sides of the frame", () => {
    expect(strips.map((strip) => strip.edge)).toEqual(["top", "bottom", "left", "right"]);
  });

  it("hugs the border, mostly outside it, so the glyphs stay clickable", () => {
    const right = byEdge("right");
    // The frame's right edge is at 100*2 + 300*2 = 800.
    expect(right.left).toBe(798);
    expect(right.left + right.width).toBe(808);
    const top = byEdge("top");
    expect(top.top).toBe(1032);
    expect(top.top + top.height).toBe(1042);
  });

  it("covers the corners, so no gap swallows a drag", () => {
    const left = byEdge("left");
    const top = byEdge("top");
    expect(left.top).toBeLessThanOrEqual(top.top);
    expect(left.left).toBe(top.left);
  });
});

describe("wrapPatches", () => {
  const wrapped: TextObject = { ...text, boxWidth: 200 };

  it("widens the box from the east grip and leaves the type size alone", () => {
    const patch = patchFor("t1", wrapPatches([wrapped], "e", 60));
    expect(patch.boxWidth).toBe(260);
    expect(patch.x).toBe(100);
    expect(patch).not.toHaveProperty("fontSize");
  });

  it("moves a left-aligned anchor when the west grip is dragged", () => {
    // The dragged edge follows the pointer; the far edge stays where it was.
    const patch = patchFor("t1", wrapPatches([wrapped], "w", -40));
    expect(patch.boxWidth).toBe(240);
    expect(patch.x).toBe(60);
  });

  it("keeps a right-aligned box pinned to its right edge", () => {
    const patch = patchFor("t1", wrapPatches([{ ...wrapped, align: "right" }], "w", -40));
    expect(patch.boxWidth).toBe(240);
    expect(patch.x).toBe(100);
  });

  it("splits the travel for a centred box", () => {
    const patch = patchFor("t1", wrapPatches([{ ...wrapped, align: "center" }], "e", 40));
    expect(patch.boxWidth).toBe(240);
    expect(patch.x).toBe(120);
  });

  it("never shrinks a box below a couple of ems", () => {
    expect(patchFor("t1", wrapPatches([wrapped], "e", -1000)).boxWidth).toBe(text.fontSize * 2);
  });

  it("ignores anything that is not text", () => {
    expect(wrapPatches([box], "e", 40)).toEqual([]);
  });
});

describe("gripsFor", () => {
  const roomy = { widthPx: 300, heightPx: 120 };

  it("shows everything once the box has room for it", () => {
    expect(gripsFor({ kind: "rectangle", hasText: false, ...roomy }).sort())
      .toEqual(["e", "n", "ne", "nw", "s", "se", "sw", "w"]);
  });

  it("splits the two jobs between the sides when the box is small", () => {
    // Zoomed out, an edge cannot hold a corner and a side handle without them
    // touching. Rather than dropping one job, the left side keeps resizing and
    // the right side keeps the side handle, so both stay reachable.
    expect(gripsFor({ kind: "rectangle", hasText: false, widthPx: 200, heightPx: 30 }))
      .toEqual(["nw", "sw", "e"]);
  });

  it("keeps a single resize grip when even two corners would touch", () => {
    expect(gripsFor({ kind: "rectangle", hasText: false, widthPx: 200, heightPx: 14 }))
      .toEqual(["nw", "e"]);
  });

  it("adds the height handles only when the box is wide enough for them", () => {
    const narrow = gripsFor({ kind: "rectangle", hasText: false, widthPx: 20, heightPx: 300 });
    expect(narrow).toContain("e");
    expect(narrow).toContain("w");
    expect(narrow).not.toContain("s");
  });

  it("gives text width handles but no height one, since it grows by the line", () => {
    const grips = gripsFor({ kind: "text", hasText: true, ...roomy });
    expect(grips.sort()).toEqual(["e", "ne", "nw", "se", "sw", "w"]);
  });

  it("gives a freehand scribble a frame and no grips at all", () => {
    expect(gripsFor({ kind: "draw", hasText: false, ...roomy })).toEqual([]);
  });
});

describe("gripRole", () => {
  it("calls a corner a resize and the middle of an edge a side handle", () => {
    for (const handle of ["nw", "ne", "sw", "se"] as const) {
      expect(gripRole(handle)).toBe("size");
    }
    for (const handle of ["n", "e", "s", "w"] as const) {
      expect(gripRole(handle)).toBe("side");
    }
  });
});

describe("gripShape", () => {
  it("draws corners as dots and side handles as bars along their own edge", () => {
    expect(gripShape("nw")).toEqual({ width: 11, height: 11 });
    const east = gripShape("e");
    expect(east.height).toBeGreaterThan(east.width);
    const south = gripShape("s");
    expect(south.width).toBeGreaterThan(south.height);
  });
});

describe("alignPatch", () => {
  const boxed: TextObject = { ...text, boxWidth: 200 };

  it("leaves the box where it is when the alignment changes", () => {
    // Alignment rearranges the words inside the box; it must not slide the box.
    const left = boundsOf(boxed).x;
    for (const align of ["center", "right", "left"] as const) {
      const patched = { ...boxed, ...alignPatch(boxed, align) };
      expect(boundsOf(patched).x).toBeCloseTo(left, 6);
      expect(boundsOf(patched).width).toBeCloseTo(200, 6);
    }
  });

  it("moves the anchor to the edge the alignment now means", () => {
    expect(alignPatch(boxed, "center").x).toBe(200);
    expect(alignPatch(boxed, "right").x).toBe(300);
    expect(alignPatch(boxed, "left").x).toBe(100);
  });
});
