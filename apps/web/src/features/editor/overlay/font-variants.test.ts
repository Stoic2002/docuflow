import { describe, expect, it } from "vitest";
import { displayFamily, displayStyle, effectiveStyle, groupByFamily, resolveVariant, splitFamily, styleOf, toggleEmphasis } from "./font-variants";

const liberation = [
  { id: "liberationsans", family: "LiberationSans", serif: false, fixed: false, category: "sans" as const },
  { id: "liberationsans-bold", family: "LiberationSans-Bold", serif: false, fixed: false, category: "sans" as const },
  { id: "liberationsans-italic", family: "LiberationSans-Italic", serif: false, fixed: false, category: "sans" as const },
  { id: "liberationsans-bolditalic", family: "LiberationSans-BoldItalic", serif: false, fixed: false, category: "sans" as const },
];
const lonely = [{ id: "solofont", family: "SoloFont", serif: false, fixed: false, category: "sans" as const }];

describe("splitFamily", () => {
  it("separates the family stem from the style it declares", () => {
    expect(splitFamily("LiberationSans-Bold")).toEqual({ stem: "liberationsans", style: { bold: true, italic: false } });
    expect(splitFamily("LiberationSans-BoldItalic")).toEqual({ stem: "liberationsans", style: { bold: true, italic: true } });
    expect(splitFamily("Inter-Regular")).toEqual({ stem: "inter", style: { bold: false, italic: false } });
  });

  it("reads an oblique as an italic", () => {
    expect(splitFamily("Foo-BoldOblique").style).toEqual({ bold: true, italic: true });
  });

  it("never strips a name down to nothing", () => {
    expect(splitFamily("Bold").stem).toBe("bold");
    expect(splitFamily("Italic").stem).toBe("italic");
  });
});

describe("resolveVariant", () => {
  it("finds the sibling face carrying the requested emphasis", () => {
    expect(resolveVariant("liberationsans", liberation, { bold: true, italic: false })).toBe("liberationsans-bold");
    expect(resolveVariant("liberationsans-bold", liberation, { bold: true, italic: true })).toBe("liberationsans-bolditalic");
    expect(resolveVariant("liberationsans-bolditalic", liberation, { bold: false, italic: false })).toBe("liberationsans");
  });

  it("returns null when the family ships no such face", () => {
    expect(resolveVariant("solofont", lonely, { bold: true, italic: false })).toBeNull();
  });

  it("returns null for the built-in font, which has no family to search", () => {
    expect(resolveVariant("", liberation, { bold: true, italic: false })).toBeNull();
  });
});

describe("toggleEmphasis", () => {
  it("swaps to the real bold face rather than synthesising one", () => {
    const patch = toggleEmphasis({ font: "liberationsans" }, liberation, "bold");
    expect(patch).toEqual({ font: "liberationsans-bold", bold: false, italic: false });
  });

  it("combines emphases into the face that carries both", () => {
    const patch = toggleEmphasis({ font: "liberationsans-bold" }, liberation, "italic");
    expect(patch.font).toBe("liberationsans-bolditalic");
  });

  it("turns emphasis off by returning to the plain face", () => {
    const patch = toggleEmphasis({ font: "liberationsans-bold" }, liberation, "bold");
    expect(patch).toEqual({ font: "liberationsans", bold: false, italic: false });
  });

  it("falls back to synthesis when the family has only one face", () => {
    const patch = toggleEmphasis({ font: "solofont" }, lonely, "bold");
    expect(patch).toEqual({ font: "solofont", bold: true, italic: false });
  });

  it("synthesises for the built-in Helvetica", () => {
    expect(toggleEmphasis({ font: "" }, liberation, "italic")).toEqual({ font: "", bold: false, italic: true });
  });

  it("keeps a synthetic emphasis that has no real face while adding another", () => {
    const patch = toggleEmphasis({ font: "solofont", bold: true }, lonely, "italic");
    expect(patch).toEqual({ font: "solofont", bold: true, italic: true });
  });
});

describe("effectiveStyle", () => {
  it("reads emphasis carried by the face itself", () => {
    expect(effectiveStyle({ font: "liberationsans-bolditalic" }, liberation)).toEqual({ bold: true, italic: true });
  });

  it("reads emphasis that was synthesised", () => {
    expect(effectiveStyle({ font: "solofont", bold: true }, lonely)).toEqual({ bold: true, italic: false });
  });

  it("reports neither for plain text", () => {
    expect(effectiveStyle({ font: "liberationsans" }, liberation)).toEqual({ bold: false, italic: false });
  });
});

describe("styleOf", () => {
  it("returns no emphasis for an unknown id", () => {
    expect(styleOf("tidak-ada", liberation)).toEqual({ bold: false, italic: false });
  });
});

describe("displayFamily and displayStyle", () => {
  it("reads a camel-cased name as separate words", () => {
    expect(displayFamily("LiberationSans-Bold")).toBe("Liberation Sans");
    expect(displayFamily("EBGaramond-Italic")).toBe("EBGaramond");
    expect(displayFamily("Inter-Regular")).toBe("Inter");
  });

  it("names each face within its family", () => {
    expect(displayStyle("LiberationSans")).toBe("Regular");
    expect(displayStyle("LiberationSans-Bold")).toBe("Bold");
    expect(displayStyle("LiberationSans-Italic")).toBe("Italic");
    expect(displayStyle("LiberationSans-BoldItalic")).toBe("Bold Italic");
  });
});

describe("groupByFamily", () => {
  const mixed = [
    { id: "b", family: "Roboto-Bold", serif: false, fixed: false, category: "sans" as const },
    { id: "a", family: "Roboto-Regular", serif: false, fixed: false, category: "sans" as const },
    { id: "c", family: "Inter-Italic", serif: false, fixed: false, category: "sans" as const },
    { id: "d", family: "Roboto-Italic", serif: false, fixed: false, category: "sans" as const },
  ];

  it("collects faces under one family, alphabetically by family", () => {
    const groups = groupByFamily(mixed);
    expect(groups.map((group) => group.name)).toEqual(["Inter", "Roboto"]);
    expect(groups[1].faces).toHaveLength(3);
  });

  it("orders faces from regular through to bold italic", () => {
    const [, roboto] = groupByFamily(mixed);
    expect(roboto.faces.map((face) => face.id)).toEqual(["a", "d", "b"]);
  });

  it("returns nothing for an empty registry", () => {
    expect(groupByFamily([])).toEqual([]);
  });
});
