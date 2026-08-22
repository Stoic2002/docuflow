import type { PdfTextRun } from "@pdf-studio/pdf-engine";
import { describe, expect, it } from "vitest";
import { analyzeBackground, coverBoxFor, inkColorFor, matchFont, pickableRuns } from "./retype";

function run(overrides: Partial<PdfTextRun> = {}): PdfTextRun {
  return {
    text: "Halo dunia", x: 100, y: 500, width: 80, fontSize: 12,
    rotation: 0, ascent: 0.8, descent: 0.2, fontFamily: "ArialMT", ...overrides,
  };
}

describe("coverBoxFor", () => {
  it("covers the run from its descender to its ascender", () => {
    const box = coverBoxFor(run(), 0);
    expect(box.width).toBe(80);
    expect(box.height).toBeCloseTo(12);
    expect(box.x).toBe(100);
    // The baseline sits 0.2em above the bottom of the box.
    expect(box.y).toBeCloseTo(500 - 0.2 * 12);
  });

  it("bleeds past the glyph edges so anti-aliasing is covered", () => {
    const box = coverBoxFor(run(), 2);
    expect(box.width).toBe(84);
    expect(box.x).toBe(98);
  });

  it("keeps the baseline origin inside the box for rotated text", () => {
    const box = coverBoxFor(run({ rotation: 30 }), 0);
    expect(box.rotation).toBe(30);
    // The centre moves along the rotated baseline rather than staying flat.
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    expect(centerX).toBeGreaterThan(100);
    expect(centerY).toBeGreaterThan(500);
    expect(centerX).toBeCloseTo(100 + 40 * Math.cos(Math.PI / 6) - 3.6 * Math.sin(Math.PI / 6), 3);
  });

  it("degenerates to the unrotated box at zero degrees", () => {
    const flat = coverBoxFor(run({ rotation: 0 }), 0);
    const almostFlat = coverBoxFor(run({ rotation: 0.0001 }), 0);
    expect(almostFlat.x).toBeCloseTo(flat.x, 3);
    expect(almostFlat.y).toBeCloseTo(flat.y, 3);
  });
});

describe("analyzeBackground", () => {
  const width = 40;
  const height = 40;

  function image(fill: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const [r, g, b] = fill(x, y);
        const offset = (y * width + x) * 4;
        data[offset] = r; data[offset + 1] = g; data[offset + 2] = b; data[offset + 3] = 255;
      }
    }
    return data;
  }

  const box = { x: 12, y: 12, width: 16, height: 10 };

  it("reads a flat background and calls it uniform", () => {
    const data = image(() => [250, 249, 248]);
    const sample = analyzeBackground(data, width, height, box);
    expect(sample.uniform).toBe(true);
    expect(sample.color).toBe("#faf9f8");
  });

  it("flags a gradient as not uniform", () => {
    const data = image((x) => [x * 6, x * 6, x * 6]);
    expect(analyzeBackground(data, width, height, box).uniform).toBe(false);
  });

  it("flags a two-tone background as not uniform", () => {
    const data = image((_x, y) => (y < 20 ? [255, 255, 255] : [10, 10, 10]));
    expect(analyzeBackground(data, width, height, box).uniform).toBe(false);
  });

  it("ignores the pixels inside the box, which hold the glyphs themselves", () => {
    const data = image((x, y) => (x >= 12 && x < 28 && y >= 12 && y < 22 ? [0, 0, 0] : [255, 255, 255]));
    const sample = analyzeBackground(data, width, height, box);
    expect(sample.uniform).toBe(true);
    expect(sample.color).toBe("#ffffff");
  });

  it("reports a non-uniform default when the box lies outside the image", () => {
    const data = image(() => [255, 255, 255]);
    const sample = analyzeBackground(data, width, height, { x: 900, y: 900, width: 10, height: 10 });
    expect(sample).toEqual({ color: "#ffffff", uniform: false });
  });
});

describe("matchFont", () => {
  const fonts = [
    { id: "arialmt", family: "ArialMT", serif: false, fixed: false, category: "sans" as const },
    { id: "georgia", family: "Georgia", serif: true, fixed: false, category: "serif" as const },
    { id: "couriernewpsmt", family: "CourierNewPSMT", serif: true, fixed: true, category: "mono" as const },
  ];

  it("prefers the same face the page already uses", () => {
    expect(matchFont("ArialMT", fonts)).toBe("arialmt");
    expect(matchFont("Arial-MT", fonts)).toBe("arialmt");
  });

  it("matches a subset-tagged or partial name", () => {
    expect(matchFont("Georgia-Bold", fonts)).toBe("georgia");
  });

  it("falls back to a face with the same character", () => {
    expect(matchFont("Times New Roman", fonts)).toBe("georgia");
    // Pitch wins over serif: this monospace face also has serifs.
    expect(matchFont("Menlo-Mono", fonts)).toBe("couriernewpsmt");
    expect(matchFont("Helvetica Neue", fonts)).toBe("arialmt");
  });

  it("uses the built-in font when nothing is registered", () => {
    expect(matchFont("ArialMT", [])).toBe("");
  });
});

describe("pickableRuns", () => {
  it("drops runs too small to click", () => {
    const runs = [run(), run({ width: 1 }), run({ fontSize: 2 })];
    expect(pickableRuns(runs)).toHaveLength(1);
  });
});

describe("inkColorFor", () => {
  const width = 40;
  const height = 40;
  const box = { x: 10, y: 10, width: 20, height: 12 };

  function image(fill: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const [r, g, b] = fill(x, y);
        const offset = (y * width + x) * 4;
        data[offset] = r; data[offset + 1] = g; data[offset + 2] = b; data[offset + 3] = 255;
      }
    }
    return data;
  }

  it("finds dark glyphs on a light page", () => {
    const data = image((x, y) => (x >= 14 && x < 22 && y >= 12 && y < 20 ? [200, 30, 30] : [255, 255, 255]));
    expect(inkColorFor(data, width, height, box, "#ffffff")).toBe("#c81e1e");
  });

  it("finds light glyphs on a dark page", () => {
    const data = image((x, y) => (x >= 14 && x < 22 && y >= 12 && y < 20 ? [250, 250, 250] : [20, 20, 20]));
    expect(inkColorFor(data, width, height, box, "#141414")).toBe("#fafafa");
  });

  it("falls back to near-black when the area has no ink at all", () => {
    const data = image(() => [255, 255, 255]);
    expect(inkColorFor(data, width, height, box, "#ffffff")).toBe("#111111");
  });
});

describe("analyzeBackground with neighbouring ink", () => {
  const width = 60;
  const height = 60;

  function image(fill: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const [r, g, b] = fill(x, y);
        const offset = (y * width + x) * 4;
        data[offset] = r; data[offset + 1] = g; data[offset + 2] = b; data[offset + 3] = 255;
      }
    }
    return data;
  }

  const box = { x: 20, y: 25, width: 24, height: 10 };

  it("keeps the paper colour when the line above clips into the ring", () => {
    // A dark line of text sits a few pixels above the run being replaced.
    const data = image((_x, y) => (y >= 17 && y <= 21 ? [20, 20, 20] : [252, 250, 245]));
    const sample = analyzeBackground(data, width, height, box);
    expect(sample.color).toBe("#fcfaf5");
  });

  it("keeps the paper colour when a rule runs just below", () => {
    const data = image((_x, y) => (y >= 39 && y <= 41 ? [0, 0, 0] : [255, 255, 255]));
    expect(analyzeBackground(data, width, height, box).color).toBe("#ffffff");
  });

  it("still reports a tinted panel rather than the white around it", () => {
    const data = image((_x, y) => (y >= 10 && y <= 50 ? [41, 89, 158] : [255, 255, 255]));
    expect(analyzeBackground(data, width, height, box).color).toBe("#29599e");
  });
});
