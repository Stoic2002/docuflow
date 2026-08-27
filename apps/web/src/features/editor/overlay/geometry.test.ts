import { describe, expect, it } from "vitest";
import { baselineOffset, caretIndexAt, flipY, fontStack, overflowsCover, wrapLines } from "./geometry";

describe("flipY", () => {
  it("converts between the PDF and screen origins", () => {
    expect(flipY(0, 842)).toBe(842);
    expect(flipY(842, 842)).toBe(0);
    expect(flipY(421, 842)).toBe(421);
  });

  it("is its own inverse", () => {
    const height = 792;
    expect(flipY(flipY(123.45, height), height)).toBeCloseTo(123.45);
  });
});

describe("fontStack", () => {
  const fonts = [
    { id: "arialmt", family: "ArialMT", serif: false, fixed: false, category: "sans" as const },
    { id: "georgia", family: "Georgia", serif: true, fixed: false, category: "serif" as const },
    { id: "couriernewpsmt", family: "CourierNewPSMT", serif: true, fixed: true, category: "mono" as const },
  ];

  it("pairs each face with a matching generic fallback", () => {
    expect(fontStack("arialmt", fonts)).toBe('"ArialMT", sans-serif');
    expect(fontStack("georgia", fonts)).toBe('"Georgia", serif');
    expect(fontStack("couriernewpsmt", fonts)).toBe('"CourierNewPSMT", monospace');
  });

  it("falls back to Helvetica for the built-in font", () => {
    expect(fontStack("", fonts)).toBe("Helvetica, Arial, sans-serif");
    expect(fontStack("belum-terpasang", fonts)).toBe("Helvetica, Arial, sans-serif");
  });
});

describe("overflowsCover", () => {
  it("stays quiet for text that was never a retype replacement", () => {
    expect(overflowsCover("apa pun", 12, "sans-serif", undefined)).toBe(false);
  });

  it("stays quiet when the browser cannot measure text", () => {
    // jsdom has no canvas backend, so measurement returns null and the panel
    // must not raise a false alarm.
    expect(overflowsCover("teks yang jauh lebih panjang dari aslinya", 12, "sans-serif", 10)).toBe(false);
  });
});

describe("caretIndexAt", () => {
  it("puts the caret at the start for a click before the first glyph", () => {
    expect(caretIndexAt("Halo dunia", 12, "sans-serif", -5)).toBe(0);
    expect(caretIndexAt("Halo dunia", 12, "sans-serif", 0)).toBe(0);
  });

  it("falls back to the end of the string when text cannot be measured", () => {
    // jsdom has no canvas backend; the caret must still land somewhere valid.
    expect(caretIndexAt("Halo dunia", 12, "sans-serif", 40)).toBe(10);
  });

  it("never points outside the string", () => {
    const index = caretIndexAt("Halo", 12, "sans-serif", 9999);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThanOrEqual(4);
  });
});

describe("wrapLines", () => {
  // Stands in for canvas metrics: every character is one unit wide.
  const measure = (value: string) => value.length;

  it("breaks a sentence at the last word that fits", () => {
    expect(wrapLines("satu dua tiga empat", 10, measure)).toEqual(["satu dua", "tiga empat"]);
  });

  it("leaves text that fits on one line alone", () => {
    expect(wrapLines("pendek", 50, measure)).toEqual(["pendek"]);
  });

  it("gives a word wider than the box its own line rather than breaking it", () => {
    // Breaking mid-word would hyphenate silently, which the exporter cannot
    // undo and the reader did not ask for.
    expect(wrapLines("pendek supercalifragilistic ya", 10, measure)).toEqual([
      "pendek",
      "supercalifragilistic",
      "ya",
    ]);
  });

  it("keeps the text whole when nothing can be measured", () => {
    expect(wrapLines("apa pun ini", 10, () => null)).toEqual(["apa pun ini"]);
  });
});

describe("baselineOffset", () => {
  it("puts the baseline below the half-leading of the line box", () => {
    // jsdom cannot measure, so this is the fallback: half the leading above
    // the glyphs, then a typical Latin ascent.
    expect(baselineOffset(20, "sans-serif", 1.2)).toBeCloseTo(2 + 16, 6);
  });

  it("has no leading to share when the line box is exactly the type size", () => {
    expect(baselineOffset(20, "sans-serif", 1)).toBeCloseTo(16, 6);
  });

  it("grows with the type size, so the offset holds at any zoom", () => {
    expect(baselineOffset(40, "sans-serif", 1.2)).toBeCloseTo(baselineOffset(20, "sans-serif", 1.2) * 2, 6);
  });
});
