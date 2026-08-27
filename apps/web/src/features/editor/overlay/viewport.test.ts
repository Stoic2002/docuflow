import { describe, expect, it } from "vitest";
import { canvasPads, initialScroll, scrollForZoom } from "./viewport";

describe("canvasPads", () => {
  it("gives the page half a viewport of travel on every side", () => {
    expect(canvasPads(1200, 800)).toEqual({ x: 600, y: 400 });
  });

  it("keeps a usable margin on a tiny viewport", () => {
    expect(canvasPads(100, 40)).toEqual({ x: 96, y: 48 });
  });
});

describe("scrollForZoom", () => {
  const pads = { x: 600, y: 400 };

  /** Which point of the page sits under the anchor at a given scroll and zoom. */
  const pageUnderAnchor = (
    scroll: { left: number; top: number },
    anchor: { x: number; y: number },
    zoom: number,
  ) => ({
    x: (scroll.left + anchor.x - pads.x) / zoom,
    y: (scroll.top + anchor.y - pads.y) / zoom,
  });

  it("keeps the point under the cursor still while zooming in", () => {
    const anchor = { x: 320, y: 180 };
    const scroll = { left: 240, top: 130 };
    const before = pageUnderAnchor(scroll, anchor, 1);
    const after = pageUnderAnchor(scrollForZoom(scroll, pads, anchor, 2), anchor, 2);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("keeps it still while zooming out too", () => {
    const anchor = { x: 900, y: 640 };
    const scroll = { left: 1500, top: 900 };
    const before = pageUnderAnchor(scroll, anchor, 3);
    const after = pageUnderAnchor(scrollForZoom(scroll, pads, anchor, 1 / 3), anchor, 1);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("leaves the scroll alone when the zoom does not change", () => {
    expect(scrollForZoom({ left: 240, top: 130 }, pads, { x: 320, y: 180 }, 1)).toEqual({ left: 240, top: 130 });
  });

  it("anchors on the page corner itself when the cursor is right on it", () => {
    // The corner sits at exactly the padding offset, so it cannot move.
    const anchor = { x: pads.x, y: pads.y };
    expect(scrollForZoom({ left: 0, top: 0 }, pads, anchor, 4)).toEqual({ left: 0, top: 0 });
  });
});

describe("initialScroll", () => {
  const viewport = { width: 1200, height: 800 };

  it("centres a page that fits the viewport", () => {
    const page = { width: 600, height: 400 };
    const pads = canvasPads(viewport.width, viewport.height);
    const scroll = initialScroll(page, viewport, 1);
    // The middle of the page lands on the middle of the viewport.
    expect(scroll.left + viewport.width / 2 - pads.x).toBeCloseTo(page.width / 2, 6);
    expect(scroll.top + viewport.height / 2 - pads.y).toBeCloseTo(page.height / 2, 6);
  });

  it("opens a tall page at its top edge instead of halfway down", () => {
    const page = { width: 595, height: 842 };
    const pads = canvasPads(viewport.width, viewport.height);
    const scroll = initialScroll(page, viewport, 1);
    expect(scroll.top).toBe(pads.y - 24);
    // Horizontally it is still centred.
    expect(scroll.left + viewport.width / 2 - pads.x).toBeCloseTo(page.width / 2, 6);
  });

  it("follows the zoom, so a magnified page stays centred", () => {
    const page = { width: 595, height: 842 };
    const pads = canvasPads(viewport.width, viewport.height);
    const scroll = initialScroll(page, viewport, 2);
    expect(scroll.left + viewport.width / 2 - pads.x).toBeCloseTo(page.width, 6);
  });
});
