import { DRAW_OPS, RuleCollector, decodePath, type PathOps } from "@pdf-studio/pdf-engine";
import { describe, expect, it } from "vitest";
import { countTableGrids, ruleCoverBox } from "./retype";

// Stand-in operator ids. The real values come from pdf.js; only their identity
// matters to the collector.
const OPS: PathOps = {
  save: 1, restore: 2, transform: 3, setLineWidth: 4, constructPath: 5,
  endPath: 6, paintFormXObjectBegin: 7, paintFormXObjectEnd: 8,
};
const STROKE = 20;
const FILL = 21;
const D = DRAW_OPS;

/**
 * Builds the argument shape pdf.js 6 actually emits: the paint operator, the
 * flattened path in a Float32Array wrapped in an array, and a bbox.
 */
function path(paintOp: number, buffer: number[]): [number, unknown[]] {
  return [OPS.constructPath, [paintOp, [new Float32Array(buffer)], null]];
}
const lineBuf = (x1: number, y1: number, x2: number, y2: number) => [D.moveTo, x1, y1, D.lineTo, x2, y2];
const rectBuf = (x: number, y: number, w: number, h: number) => [
  D.moveTo, x, y, D.lineTo, x + w, y, D.lineTo, x + w, y + h, D.lineTo, x, y + h, D.closePath,
];

function collect(steps: [number, unknown[]][]) {
  const collector = new RuleCollector(OPS);
  for (const [fn, args] of steps) collector.step(fn, args);
  return collector.rules();
}

describe("decodePath", () => {
  it("reads a Float32Array, which is what pdf.js hands over", () => {
    const [subPath] = decodePath(new Float32Array(lineBuf(10, 20, 110, 20)), [1, 0, 0, 1, 0, 0]);
    expect(subPath.points).toEqual([[10, 20], [110, 20]]);
    expect(subPath.closed).toBe(false);
  });

  it("marks a closed subpath and keeps its corners", () => {
    const [subPath] = decodePath(new Float32Array(rectBuf(0, 0, 100, 2)), [1, 0, 0, 1, 0, 0]);
    expect(subPath.closed).toBe(true);
    expect(subPath.points).toHaveLength(4);
  });

  it("ends the run at a curve, since nothing after one is straight", () => {
    const buffer = new Float32Array([D.moveTo, 0, 0, D.lineTo, 100, 0, D.curveTo, 1, 1, 2, 2, 200, 50, D.lineTo, 300, 50]);
    const subPaths = decodePath(buffer, [1, 0, 0, 1, 0, 0]);
    expect(subPaths).toHaveLength(2);
    expect(subPaths[0].points).toEqual([[0, 0], [100, 0]]);
    expect(subPaths[1].points).toEqual([[200, 50], [300, 50]]);
  });

  it("stops instead of guessing when the stream holds an unknown code", () => {
    expect(decodePath(new Float32Array([99, 1, 2, 3]), [1, 0, 0, 1, 0, 0])).toEqual([]);
  });
});

describe("RuleCollector", () => {
  it("finds a horizontal stroke and orders it left to right", () => {
    const [rule] = collect([[OPS.setLineWidth, [1.5]], path(STROKE, lineBuf(400, 100, 60, 100))]);
    expect(rule).toMatchObject({ orientation: "horizontal", x1: 60, x2: 400, y1: 100, thickness: 1.5 });
  });

  it("finds a vertical stroke and orders it bottom to top", () => {
    const [rule] = collect([path(STROKE, lineBuf(200, 700, 200, 300))]);
    expect(rule).toMatchObject({ orientation: "vertical", x1: 200, y1: 300, y2: 700 });
  });

  it("ignores diagonals, which it could not replace with a straight rule", () => {
    expect(collect([path(STROKE, lineBuf(0, 0, 200, 200))])).toHaveLength(0);
  });

  it("ignores marks too short to be separators", () => {
    expect(collect([path(STROKE, lineBuf(10, 50, 14, 50))])).toHaveLength(0);
  });

  it("reads a thin filled rectangle as one rule down its middle, not four edges", () => {
    const rules = collect([path(FILL, rectBuf(50, 200, 300, 1))]);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ orientation: "horizontal", x1: 50, x2: 350, y1: 200.5, thickness: 1 });
  });

  it("reads a thin vertical bar the same way", () => {
    const rules = collect([path(FILL, rectBuf(120, 100, 0.8, 400))]);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ orientation: "vertical", y1: 100, y2: 500 });
    expect(rules[0].x1).toBeCloseTo(120.4);
  });

  it("takes the edges of a box that is too thick to be a rule", () => {
    const rules = collect([path(STROKE, rectBuf(50, 200, 300, 90))]);
    // Its four sides are all axis aligned, so each becomes its own rule.
    expect(rules).toHaveLength(4);
  });

  it("skips a path that was only used for clipping", () => {
    expect(collect([path(OPS.endPath, lineBuf(0, 10, 200, 10))])).toHaveLength(0);
  });

  it("survives an empty path buffer", () => {
    expect(collect([[OPS.constructPath, [STROKE, [null], null]]])).toHaveLength(0);
  });

  it("applies the current transform to path coordinates", () => {
    const [rule] = collect([
      [OPS.transform, [1, 0, 0, 1, 100, 50]],
      path(STROKE, lineBuf(0, 0, 200, 0)),
    ]);
    expect(rule).toMatchObject({ orientation: "horizontal", x1: 100, x2: 300, y1: 50 });
  });

  it("restores the transform that save pushed", () => {
    const rules = collect([
      [OPS.save, []],
      [OPS.transform, [1, 0, 0, 1, 500, 500]],
      path(STROKE, lineBuf(0, 0, 100, 0)),
      [OPS.restore, []],
      path(STROKE, lineBuf(0, 20, 100, 20)),
    ]);
    expect(rules[0]).toMatchObject({ x1: 500, y1: 500 });
    expect(rules[1]).toMatchObject({ x1: 0, y1: 20 });
  });

  it("applies a form XObject matrix and pops it again", () => {
    const rules = collect([
      [OPS.paintFormXObjectBegin, [[1, 0, 0, 1, 30, 700], [0, 0, 600, 800]]],
      path(STROKE, lineBuf(0, 0, 120, 0)),
      [OPS.paintFormXObjectEnd, []],
      path(STROKE, lineBuf(0, 0, 120, 0)),
    ]);
    expect(rules[0]).toMatchObject({ x1: 30, y1: 700, x2: 150 });
    expect(rules[1]).toMatchObject({ x1: 0, y1: 0, x2: 120 });
  });

  it("scales stroke width by the active transform", () => {
    const [rule] = collect([
      [OPS.setLineWidth, [2]],
      [OPS.transform, [3, 0, 0, 3, 0, 0]],
      path(STROKE, lineBuf(0, 10, 100, 10)),
    ]);
    expect(rule.thickness).toBeCloseTo(6);
  });

  it("drops the duplicate a stroked-then-filled path produces", () => {
    expect(collect([path(STROKE, lineBuf(0, 10, 200, 10)), path(FILL, lineBuf(0, 10, 200, 10))])).toHaveLength(1);
  });

  it("collects a whole table grid from one path", () => {
    const grid = [
      ...rectBuf(50, 100, 300, 0.8),
      ...rectBuf(50, 200, 300, 0.8),
      ...rectBuf(50, 300, 300, 0.8),
      ...rectBuf(50, 100, 0.8, 200),
      ...rectBuf(350, 100, 0.8, 200),
    ];
    const rules = collect([path(FILL, grid)]);
    expect(rules.filter((rule) => rule.orientation === "horizontal")).toHaveLength(3);
    expect(rules.filter((rule) => rule.orientation === "vertical")).toHaveLength(2);
    expect(countTableGrids(rules)).toBe(1);
  });
});

describe("ruleCoverBox", () => {
  it("wraps a horizontal rule in a patch as tall as its thickness", () => {
    const box = ruleCoverBox({ orientation: "horizontal", x1: 50, y1: 200, x2: 350, y2: 200, thickness: 2 }, 1);
    expect(box).toMatchObject({ x: 49, width: 302, height: 4, rotation: 0 });
    expect(box.y).toBeCloseTo(198);
  });

  it("gives a hairline rule a patch it can actually cover with", () => {
    const box = ruleCoverBox({ orientation: "vertical", x1: 100, y1: 50, x2: 100, y2: 250, thickness: 0.1 }, 1);
    expect(box.width).toBeCloseTo(2.5);
    expect(box.height).toBeCloseTo(202);
  });
});

describe("countTableGrids", () => {
  const across = (y: number) => ({ orientation: "horizontal" as const, x1: 50, y1: y, x2: 350, y2: y, thickness: 1 });
  const down = (x: number) => ({ orientation: "vertical" as const, x1: x, y1: 100, x2: x, y2: 300, thickness: 1 });

  it("recognises crossing rules as one table", () => {
    expect(countTableGrids([across(120), across(200), across(280), down(50), down(200), down(350)])).toBe(1);
  });

  it("does not call a lone underline a table", () => {
    expect(countTableGrids([across(120)])).toBe(0);
  });

  it("does not call parallel rules without verticals a table", () => {
    expect(countTableGrids([across(120), across(200), across(280)])).toBe(0);
  });

  it("counts nothing for an empty page", () => {
    expect(countTableGrids([])).toBe(0);
  });
});
