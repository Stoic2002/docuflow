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

  it("maps proprietary families to their metric-compatible substitutes", () => {
    const substitutes = [
      { id: "tinos", family: "Tinos", serif: true, fixed: false, category: "serif" as const },
      { id: "arimo", family: "Arimo", serif: false, fixed: false, category: "sans" as const },
      { id: "carlito", family: "Carlito", serif: false, fixed: false, category: "sans" as const },
      { id: "shipporimincho", family: "Shippori Mincho", serif: true, fixed: false, category: "serif" as const },
    ];
    expect(matchFont("TimesNewRomanPSMT", substitutes)).toBe("tinos");
    expect(matchFont("TimesNewRomanPS-BoldMT", substitutes)).toBe("tinos");
    expect(matchFont("TimesLTPro-Roman", substitutes)).toBe("tinos");
    expect(matchFont("Arial-BoldMT", substitutes)).toBe("arimo");
    expect(matchFont("Arial-ItalicMT", substitutes)).toBe("arimo");
    expect(matchFont("Calibri", substitutes)).toBe("carlito");
    expect(matchFont("MS-PMincho", substitutes)).toBe("shipporimincho");
  });

  it("keeps a plain run plain when the family ships several weights", () => {
    // The registry is ordered by file name, so "Roboto-Bold" sits before
    // "Roboto-Regular": matching on the whole name used to turn every plain
    // Roboto run bold the moment it was clicked.
    const family = [
      { id: "roboto-bold", family: "Roboto-Bold", serif: false, fixed: false, category: "sans" as const },
      { id: "roboto-bolditalic", family: "Roboto-BoldItalic", serif: false, fixed: false, category: "sans" as const },
      { id: "roboto-italic", family: "Roboto-Italic", serif: false, fixed: false, category: "sans" as const },
      { id: "roboto-regular", family: "Roboto-Regular", serif: false, fixed: false, category: "sans" as const },
    ];
    expect(matchFont("Roboto", family)).toBe("roboto-regular");
    expect(matchFont("Roboto-Bold", family)).toBe("roboto-bold");
    expect(matchFont("Roboto-Italic", family)).toBe("roboto-italic");
    expect(matchFont("Roboto-BoldItalic", family)).toBe("roboto-bolditalic");
  });

  it("reads the emphasis out of a PostScript name", () => {
    const family = [
      { id: "arimo-bold", family: "Arimo-Bold", serif: false, fixed: false, category: "sans" as const },
      { id: "arimo-italic", family: "Arimo-Italic", serif: false, fixed: false, category: "sans" as const },
      { id: "arimo-regular", family: "Arimo-Regular", serif: false, fixed: false, category: "sans" as const },
    ];
    // The style word sits mid-name here, not at the end.
    expect(matchFont("Arial-BoldMT", family)).toBe("arimo-bold");
    expect(matchFont("Arial-ItalicMT", family)).toBe("arimo-italic");
    expect(matchFont("ArialMT", family)).toBe("arimo-regular");
  });

  it("resolves a substitute family that ships as separate faces", () => {
    // Shipped as Tinos-Regular and friends, never as a bare "Tinos", so the
    // alias has to match the family rather than the exact name.
    const shipped = [
      { id: "tinos-bold", family: "Tinos-Bold", serif: true, fixed: false, category: "serif" as const },
      { id: "tinos-regular", family: "Tinos-Regular", serif: true, fixed: false, category: "serif" as const },
    ];
    expect(matchFont("TimesNewRomanPSMT", shipped)).toBe("tinos-regular");
    expect(matchFont("TimesNewRomanPS-BoldMT", shipped)).toBe("tinos-bold");
  });

  it("ignores the tag a subsetted font carries", () => {
    const family = [
      { id: "lato-bold", family: "Lato-Bold", serif: false, fixed: false, category: "sans" as const },
      { id: "lato-regular", family: "Lato-Regular", serif: false, fixed: false, category: "sans" as const },
    ];
    expect(matchFont("ABCDEF+Lato", family)).toBe("lato-regular");
    expect(matchFont("ABCDEF+Lato-Bold", family)).toBe("lato-bold");
  });

  it("reads the weight out of the name a subsetted font carries", () => {
    // What a real file gives us, checked against PDF.js: getTextContent calls
    // every face "sans-serif", and the font object names it "BZZZZZ+Arial-
    // BoldMT" with no weight flags at all. The name is then the only clue,
    // so it must survive the subset tag and the foundry suffix.
    const shipped = [
      { id: "arimo-bold", family: "Arimo-Bold", serif: false, fixed: false, category: "sans" as const },
      { id: "arimo-italic", family: "Arimo-Italic", serif: false, fixed: false, category: "sans" as const },
      { id: "arimo-regular", family: "Arimo-Regular", serif: false, fixed: false, category: "sans" as const },
      { id: "roboto-bold", family: "Roboto-Bold", serif: false, fixed: false, category: "sans" as const },
      { id: "roboto-regular", family: "Roboto-Regular", serif: false, fixed: false, category: "sans" as const },
    ];
    expect(matchFont("BZZZZZ+Arial-BoldMT", shipped)).toBe("arimo-bold");
    expect(matchFont("CZZZZZ+ArialMT", shipped)).toBe("arimo-regular");
    expect(matchFont("DZZZZZ+Arial-ItalicMT", shipped)).toBe("arimo-italic");
    expect(matchFont("EZZZZZ+Roboto-Bold", shipped)).toBe("roboto-bold");
  });

  it("trusts the emphasis the font program declares over its name", () => {
    // PDF.js reports a generic family for most embedded fonts — every face on
    // the page arrives as "sans-serif" — so the flags are the only clue that a
    // fragment was printed bold, and matching without them turned bold text
    // regular the moment it was clicked.
    const family = [
      { id: "arimo-bold", family: "Arimo-Bold", serif: false, fixed: false, category: "sans" as const },
      { id: "arimo-italic", family: "Arimo-Italic", serif: false, fixed: false, category: "sans" as const },
      { id: "arimo-regular", family: "Arimo-Regular", serif: false, fixed: false, category: "sans" as const },
    ];
    expect(matchFont("sans-serif", family, { bold: true, italic: false })).toBe("arimo-bold");
    expect(matchFont("sans-serif", family, { bold: false, italic: true })).toBe("arimo-italic");
    expect(matchFont("sans-serif", family, { bold: false, italic: false })).toBe("arimo-regular");
    // A name that matches a registered face exactly still wins: the document
    // is naming that very face, and its own flags will agree.
    expect(matchFont("Arimo-Bold", family, { bold: false, italic: false })).toBe("arimo-bold");
    // Where the name only gives a family, the flags decide which face of it.
    expect(matchFont("Arimo", family, { bold: true, italic: false })).toBe("arimo-bold");
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
