import { RuleCollector, type PathOps } from "@pdf-studio/pdf-engine";
import { describe, expect, it } from "vitest";
import { countTableGrids, ruleCoverBox } from "./retype";

// Stand-in operator ids. The real values come from pdf.js; only their identity
// matters to the collector.
const OPS: PathOps = {
  save: 1, restore: 2, transform: 3, setLineWidth: 4, constructPath: 5,
  moveTo: 10, lineTo: 11, curveTo: 12, curveTo2: 13, curveTo3: 14,
  closePath: 15, rectangle: 16,
};

function collect(steps: [number, unknown[]][]) {
  const collector = new RuleCollector(OPS);
  for (const [fn, args] of steps) collector.step(fn, args);
  return collector.rules();
}

const line = (coords: number[]): [number, unknown[]] => [
  OPS.constructPath, [[OPS.moveTo, OPS.lineTo], coords],
];
const rect = (coords: number[]): [number, unknown[]] => [
  OPS.constructPath, [[OPS.rectangle], coords],
];

describe("RuleCollector", () => {
  it("finds a horizontal stroke and orders it left to right", () => {
    const [rule] = collect([[OPS.setLineWidth, [1.5]], line([400, 100, 60, 100])]);
    expect(rule).toMatchObject({ orientation: "horizontal", x1: 60, x2: 400, y1: 100, thickness: 1.5 });
  });

  it("finds a vertical stroke and orders it bottom to top", () => {
    const [rule] = collect([line([200, 700, 200, 300])]);
    expect(rule).toMatchObject({ orientation: "vertical", x1: 200, y1: 300, y2: 700 });
  });

  it("ignores diagonals, which it could not replace with a straight rule", () => {
    expect(collect([line([0, 0, 200, 200])])).toHaveLength(0);
  });

  it("ignores marks too short to be separators", () => {
    expect(collect([line([10, 50, 14, 50])])).toHaveLength(0);
  });

  it("reads a thin filled rectangle as a rule, which is how many tables draw borders", () => {
    const [rule] = collect([rect([50, 200, 300, 1])]);
    expect(rule).toMatchObject({ orientation: "horizontal", x1: 50, x2: 350, y1: 200.5, thickness: 1 });
  });

  it("leaves a thick rectangle alone, since it is a box rather than a rule", () => {
    expect(collect([rect([50, 200, 300, 90])])).toHaveLength(0);
  });

  it("applies the current transform to path coordinates", () => {
    const [rule] = collect([
      [OPS.transform, [1, 0, 0, 1, 100, 50]],
      line([0, 0, 200, 0]),
    ]);
    expect(rule).toMatchObject({ orientation: "horizontal", x1: 100, x2: 300, y1: 50 });
  });

  it("restores the transform that save pushed", () => {
    const rules = collect([
      [OPS.save, []],
      [OPS.transform, [1, 0, 0, 1, 500, 500]],
      line([0, 0, 100, 0]),
      [OPS.restore, []],
      line([0, 20, 100, 20]),
    ]);
    expect(rules[0]).toMatchObject({ x1: 500, y1: 500 });
    expect(rules[1]).toMatchObject({ x1: 0, y1: 20 });
  });

  it("scales stroke width by the active transform", () => {
    const [rule] = collect([
      [OPS.setLineWidth, [2]],
      [OPS.transform, [3, 0, 0, 3, 0, 0]],
      line([0, 10, 100, 10]),
    ]);
    expect(rule.thickness).toBeCloseTo(6);
  });

  it("drops the duplicate a stroked-then-filled path produces", () => {
    expect(collect([line([0, 10, 200, 10]), line([0, 10, 200, 10])])).toHaveLength(1);
  });

  it("closes a path back to its start", () => {
    const rules = collect([[
      OPS.constructPath,
      [[OPS.moveTo, OPS.lineTo, OPS.lineTo, OPS.closePath], [0, 0, 200, 0, 200, 100, 0, 0]],
    ]]);
    // The bottom edge and the closing left edge are both axis aligned.
    expect(rules.map((rule) => rule.orientation)).toEqual(["horizontal", "vertical"]);
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
