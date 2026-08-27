import { afterEach, describe, expect, it } from "vitest";
import { LINE_HEIGHT, boundsOf, setTextLayout, type TextObject } from "./types";

const text: TextObject = {
  id: "t1", kind: "text", page: 1, text: "Halo dunia", x: 100, y: 100, fontSize: 20,
  font: "", color: "#111111", align: "left", opacity: 1, rotation: 0,
};

afterEach(() => setTextLayout(null));

describe("boundsOf for text", () => {
  it("uses the installed measurer, so the frame matches the glyphs", () => {
    setTextLayout(() => ({ lines: [text.text], width: 137 }));
    expect(boundsOf(text)).toMatchObject({ x: 100, width: 137, height: 20 });
  });

  it("falls back to an average width when nothing can measure", () => {
    // jsdom has no canvas backend; the frame is then a rough estimate, which is
    // why the editor installs a real measurer as soon as it mounts.
    expect(boundsOf(text).width).toBeCloseTo("Halo dunia".length * 20 * 0.52, 6);
  });

  it("shifts the box by the alignment, measured width included", () => {
    setTextLayout(() => ({ lines: [text.text], width: 100 }));
    expect(boundsOf({ ...text, align: "center" }).x).toBe(50);
    expect(boundsOf({ ...text, align: "right" }).x).toBe(0);
  });

  it("sits the box on the baseline, with room for descenders", () => {
    setTextLayout(() => ({ lines: [text.text], width: 100 }));
    expect(boundsOf(text).y).toBeCloseTo(100 - 20 * 0.22, 6);
  });
});

describe("boundsOf for wrapped text", () => {
  it("grows downwards, one line at a time", () => {
    setTextLayout(() => ({ lines: ["baris satu", "baris dua", "baris tiga"], width: 160 }));
    const wrapped = boundsOf({ ...text, boxWidth: 160 });
    // The box keeps the width it was given and hangs below the first baseline.
    expect(wrapped.width).toBe(160);
    expect(wrapped.height).toBeCloseTo(20 + 2 * 20 * LINE_HEIGHT, 6);
    expect(wrapped.y).toBeCloseTo(100 - 20 * 0.22 - 2 * 20 * LINE_HEIGHT, 6);
  });

  it("anchors a centred box on its middle", () => {
    setTextLayout(() => ({ lines: ["satu", "dua"], width: 160 }));
    expect(boundsOf({ ...text, boxWidth: 160, align: "center" }).x).toBe(20);
    expect(boundsOf({ ...text, boxWidth: 160, align: "right" }).x).toBe(-60);
  });
});
