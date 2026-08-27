import { afterEach, describe, expect, it } from "vitest";
import { splitForStyle } from "./split";
import { setTextLayout, type TextObject } from "./types";

const line: TextObject = {
  id: "t1", kind: "text", page: 1, text: "Nama Budi Santoso", x: 100, y: 700,
  fontSize: 10, font: "", color: "#111111", align: "left", opacity: 1, rotation: 0,
};

/** Every character one point wide, and a bold one two, so offsets are readable. */
function measureBy(width: number, boldWidth = width) {
  setTextLayout((object) => ({
    lines: [object.text],
    width: object.text.length * (object.bold ? boldWidth : width),
  }));
}

afterEach(() => setTextLayout(null));

describe("splitForStyle", () => {
  it("cuts a line into before, styled, and after", () => {
    measureBy(1);
    const pieces = splitForStyle(line, 5, 9, { bold: true })!;
    expect(pieces.map((piece) => piece.text)).toEqual(["Nama ", "Budi", " Santoso"]);
    expect(pieces.map((piece) => piece.bold)).toEqual([undefined, true, undefined]);
  });

  it("places each piece where the ones before it actually measure", () => {
    // "Nama " is five characters, and the bold "Budi" measures double.
    measureBy(1, 2);
    const pieces = splitForStyle(line, 5, 9, { bold: true })!;
    expect(pieces.map((piece) => piece.x)).toEqual([100, 105, 113]);
  });

  it("keeps the id on the styled piece, so the toolbar follows the change", () => {
    measureBy(1);
    const pieces = splitForStyle(line, 5, 9, { bold: true })!;
    expect(pieces.find((piece) => piece.bold)?.id).toBe("t1");
    expect(pieces.filter((piece) => piece.id === "t1")).toHaveLength(1);
  });

  it("binds the pieces into one group so they travel together", () => {
    measureBy(1);
    const pieces = splitForStyle(line, 5, 9, { bold: true })!;
    const groups = new Set(pieces.map((piece) => piece.groupId));
    expect(groups.size).toBe(1);
    expect([...groups][0]).toBeTruthy();
  });

  it("keeps a retype pair's own group, so its patch still travels with it", () => {
    measureBy(1);
    const pieces = splitForStyle({ ...line, groupId: "pasangan" }, 5, 9, { bold: true })!;
    expect(pieces.every((piece) => piece.groupId === "pasangan")).toBe(true);
  });

  it("drops a selection at the very start or end to two pieces", () => {
    measureBy(1);
    expect(splitForStyle(line, 0, 4, { bold: true })!.map((piece) => piece.text))
      .toEqual(["Nama", " Budi Santoso"]);
    expect(splitForStyle(line, 10, 17, { bold: true })!.map((piece) => piece.text))
      .toEqual(["Nama Budi ", "Santoso"]);
  });

  it("has nothing to cut for an empty or whole-line selection", () => {
    measureBy(1);
    expect(splitForStyle(line, 4, 4, { bold: true })).toBeNull();
    expect(splitForStyle(line, 0, line.text.length, { bold: true })).toBeNull();
  });

  it("refuses to cut a box whose words wrap", () => {
    // Pieces cannot flow into one another, so the style has to apply whole.
    measureBy(1);
    expect(splitForStyle({ ...line, boxWidth: 120 }, 5, 9, { bold: true })).toBeNull();
  });

  it("starts every piece from the visual left edge, whatever the alignment", () => {
    measureBy(1);
    const centred = splitForStyle({ ...line, align: "center" }, 5, 9, { bold: true })!;
    // "Nama Budi Santoso" is 17 characters, so a centred box starts 8.5 left of x.
    expect(centred[0].x).toBeCloseTo(100 - 17 / 2, 6);
    expect(centred.every((piece) => piece.align === "left")).toBe(true);
  });
});
