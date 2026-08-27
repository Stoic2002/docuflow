import { describe, expect, it } from "vitest";
import { colorSpans } from "./ink-spans";

/** One point per character, which makes the offsets readable in the tests. */
function offsetsFor(text: string): number[] {
  return [...text].map((_, index) => index).concat(text.length);
}

/** Reads a colour map keyed by character index, the way a page would look. */
function sampler(text: string, colors: Record<number, string | null>) {
  return (from: number) => {
    const index = Math.round(from);
    return index in colors ? colors[index] : "#111111";
  };
}

describe("colorSpans", () => {
  const text = "Nama: Budi";

  it("keeps a run of one colour whole", () => {
    const spans = colorSpans(text, offsetsFor(text), () => "#111111", "#111111");
    expect(spans).toEqual([{ text, offset: 0, color: "#111111" }]);
  });

  it("cuts where the ink changes colour", () => {
    // "Budi" is printed red, the label before it black.
    const red = Object.fromEntries([6, 7, 8, 9].map((index) => [index, "#cc0000"]));
    const spans = colorSpans(text, offsetsFor(text), sampler(text, red), "#111111");
    expect(spans.map((span) => span.text)).toEqual(["Nama: ", "Budi"]);
    expect(spans.map((span) => span.color)).toEqual(["#111111", "#cc0000"]);
    expect(spans[1].offset).toBe(6);
  });

  it("ignores a single odd character, which is anti-aliasing not a colour", () => {
    const spans = colorSpans(text, offsetsFor(text), sampler(text, { 3: "#cc0000" }), "#111111");
    expect(spans).toHaveLength(1);
  });

  it("lets a space carry on the colour around it rather than breaking the run", () => {
    // A space has no ink to read, so it must not start a span of its own.
    const spans = colorSpans("ab cd", offsetsFor("ab cd"), (from) => (from === 2 ? null : "#111111"), "#111111");
    expect(spans).toHaveLength(1);
  });

  it("treats a near-identical colour as the same ink", () => {
    const spans = colorSpans(text, offsetsFor(text), sampler(text, {
      6: "#141414", 7: "#141414", 8: "#141414", 9: "#141414",
    }), "#111111");
    expect(spans).toHaveLength(1);
  });

  it("falls back to the run's own colour where nothing can be read", () => {
    const spans = colorSpans(text, offsetsFor(text), () => null, "#2e7d32");
    expect(spans).toEqual([{ text, offset: 0, color: "#2e7d32" }]);
  });

  it("copes with text it has no offsets for", () => {
    expect(colorSpans(text, [0, 1], () => "#111111", "#111111")).toEqual([
      { text, offset: 0, color: "#111111" },
    ]);
    expect(colorSpans("", [], () => null, "#111111")).toEqual([{ text: "", offset: 0, color: "#111111" }]);
  });
});
