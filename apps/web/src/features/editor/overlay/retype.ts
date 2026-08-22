import type { RegisteredFont } from "@pdf-studio/api-client";
import type { PdfTextRun, PdfVectorRule } from "@pdf-studio/pdf-engine";

/**
 * Cover and retype: the only way to change words already in a PDF without a
 * commercial SDK. A patch is painted over the original run and the replacement
 * text is drawn on top. It is exact on a flat background and visibly wrong on a
 * photo or gradient, so the background is measured first and the user is warned
 * rather than surprised.
 */

export type CoverBox = { x: number; y: number; width: number; height: number; rotation: number };

/** Slight bleed so anti-aliased edges of the original glyphs are covered. */
const COVER_PADDING = 1;

/**
 * Builds the patch rectangle for a run. The box is computed in the run's own
 * frame and then rotated about its centre, which is exactly how the overlay
 * engine rotates a shape.
 */
export function coverBoxFor(run: PdfTextRun, padding = COVER_PADDING): CoverBox {
  const width = run.width + padding * 2;
  const height = (run.ascent + run.descent) * run.fontSize + padding * 2;
  const radians = (run.rotation * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  // Centre of the box relative to the baseline origin, before rotation.
  const localX = run.width / 2;
  const localY = ((run.ascent - run.descent) * run.fontSize) / 2;
  const centerX = run.x + localX * cosine - localY * sine;
  const centerY = run.y + localX * sine + localY * cosine;
  return {
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
    rotation: run.rotation,
  };
}

export type BackgroundSample = {
  color: string;
  /** False when the area behind the run is patterned, so a flat patch will show. */
  uniform: boolean;
};

/** Two colours count as the same background when every channel is this close. */
const UNIFORM_TOLERANCE = 12;

function toHex(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
}

/**
 * Samples a ring just outside the run and reports the colour behind it. Pixel
 * coordinates are top-left origin, matching the rendered canvas.
 */
export function analyzeBackground(
  data: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  box: { x: number; y: number; width: number; height: number },
  ring = 3,
): BackgroundSample {
  const samples: [number, number, number][] = [];
  const read = (x: number, y: number) => {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= imageWidth || py >= imageHeight) return;
    const offset = (py * imageWidth + px) * 4;
    samples.push([data[offset], data[offset + 1], data[offset + 2]]);
  };
  const steps = 12;
  for (let index = 0; index <= steps; index += 1) {
    const alongX = box.x + (box.width * index) / steps;
    const alongY = box.y + (box.height * index) / steps;
    read(alongX, box.y - ring);
    read(alongX, box.y + box.height + ring);
    read(box.x - ring, alongY);
    read(box.x + box.width + ring, alongY);
  }
  if (samples.length === 0) return { color: "#ffffff", uniform: false };

  const mean = [0, 1, 2].map(
    (channel) => samples.reduce((total, sample) => total + sample[channel], 0) / samples.length,
  );
  const uniform = samples.every((sample) =>
    sample.every((value, channel) => Math.abs(value - mean[channel]) <= UNIFORM_TOLERANCE),
  );
  return { color: `#${toHex(mean[0])}${toHex(mean[1])}${toHex(mean[2])}`, uniform };
}

function normalizeFamily(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Picks the registered font closest to the one the page already uses, so the
 * replacement blends in. Falls back to a face with the same serif and pitch
 * character, then to the built-in Helvetica.
 */
export function matchFont(fontFamily: string, fonts: RegisteredFont[]): string {
  if (fonts.length === 0) return "";
  const wanted = normalizeFamily(fontFamily);
  const exact = fonts.find((font) => normalizeFamily(font.family) === wanted);
  if (exact) return exact.id;
  const partial = fonts.find((font) => {
    const family = normalizeFamily(font.family);
    return wanted.length > 2 && (family.includes(wanted) || wanted.includes(family));
  });
  if (partial) return partial.id;
  const lower = fontFamily.toLowerCase();
  // Pitch outranks serif: a monospace request is satisfied by any monospace
  // face, whether or not that face happens to have serifs.
  if (lower.includes("mono") || lower.includes("courier")) {
    const fixed = fonts.find((font) => font.fixed);
    if (fixed) return fixed.id;
  }
  const wantsSerif = lower.includes("sans")
    ? false
    : lower.includes("serif") || lower.includes("times") || lower.includes("georgia") || lower.includes("roman");
  const byCharacter = fonts.find((font) => !font.fixed && font.serif === wantsSerif);
  return byCharacter?.id ?? "";
}

/** Runs too small to click reliably are hidden from the picker. */
export function pickableRuns(runs: PdfTextRun[]): PdfTextRun[] {
  return runs.filter((run) => run.width >= 2 && run.fontSize >= 3);
}

/**
 * Guesses the colour of the original glyphs so the replacement text matches.
 * The ink is whichever sampled pixel sits furthest from the background, which
 * works for dark text on light pages and for light text on dark ones.
 */
export function inkColorFor(
  data: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  box: { x: number; y: number; width: number; height: number },
  background: string,
): string {
  const target = [1, 3, 5].map((offset) => parseInt(background.slice(offset, offset + 2), 16));
  let best: [number, number, number] | null = null;
  let bestDistance = -1;
  const steps = 24;
  for (let row = 0; row <= steps; row += 1) {
    for (let column = 0; column <= steps; column += 1) {
      const px = Math.round(box.x + (box.width * column) / steps);
      const py = Math.round(box.y + (box.height * row) / steps);
      if (px < 0 || py < 0 || px >= imageWidth || py >= imageHeight) continue;
      const offset = (py * imageWidth + px) * 4;
      const pixel: [number, number, number] = [data[offset], data[offset + 1], data[offset + 2]];
      const distance = pixel.reduce((total, value, channel) => total + Math.abs(value - target[channel]), 0);
      if (distance > bestDistance) {
        bestDistance = distance;
        best = pixel;
      }
    }
  }
  // A run that never differs from its background has no ink to copy.
  if (!best || bestDistance < 40) return "#111111";
  return `#${toHex(best[0])}${toHex(best[1])}${toHex(best[2])}`;
}

/**
 * Patch box for a rule. A rule is thin, so the box is its own thickness plus a
 * little bleed; the replacement line is then drawn along the same axis.
 */
export function ruleCoverBox(rule: PdfVectorRule, padding = COVER_PADDING): CoverBox {
  const half = Math.max(rule.thickness, 0.5) / 2 + padding;
  if (rule.orientation === "horizontal") {
    return {
      x: rule.x1 - padding,
      y: rule.y1 - half,
      width: rule.x2 - rule.x1 + padding * 2,
      height: half * 2,
      rotation: 0,
    };
  }
  return {
    x: rule.x1 - half,
    y: rule.y1 - padding,
    width: half * 2,
    height: rule.y2 - rule.y1 + padding * 2,
    rotation: 0,
  };
}

/**
 * Groups rules into the grids they form, so the UI can say "3 tabel" rather
 * than "48 garis". Two rules belong together when they cross or nearly touch.
 */
export function countTableGrids(rules: PdfVectorRule[], tolerance = 4): number {
  const horizontal = rules.filter((rule) => rule.orientation === "horizontal");
  const vertical = rules.filter((rule) => rule.orientation === "vertical");
  let grids = 0;
  const used = new Set<PdfVectorRule>();
  for (const across of horizontal) {
    if (used.has(across)) continue;
    const crossing = vertical.filter(
      (down) =>
        down.x1 >= across.x1 - tolerance &&
        down.x1 <= across.x2 + tolerance &&
        across.y1 >= down.y1 - tolerance &&
        across.y1 <= down.y2 + tolerance,
    );
    // A table needs at least two verticals bounding a row.
    if (crossing.length < 2) continue;
    grids += 1;
    for (const other of horizontal) {
      const sharesSpan = other.x1 <= across.x2 + tolerance && other.x2 >= across.x1 - tolerance;
      if (sharesSpan) used.add(other);
    }
  }
  return grids;
}

/** Something already printed on the page that the editor can take over. */
export type DetectedTarget =
  | { kind: "run"; run: PdfTextRun; box: CoverBox }
  | { kind: "rule"; rule: PdfVectorRule; box: CoverBox };

export function detectedTargets(runs: PdfTextRun[], rules: PdfVectorRule[]): DetectedTarget[] {
  return [
    ...runs.map((run) => ({ kind: "run" as const, run, box: coverBoxFor(run) })),
    ...rules.map((rule) => ({ kind: "rule" as const, rule, box: ruleCoverBox(rule) })),
  ];
}

/**
 * Finds the printed element under a point. Text wins over rules when they
 * overlap, because a rule under a line of text is almost never the target.
 */
export function hitDetected(targets: DetectedTarget[], x: number, y: number, slack = 0): DetectedTarget | null {
  const inside = (target: DetectedTarget) => {
    const pad = target.kind === "rule" ? Math.max(slack, 3) : slack;
    return (
      x >= target.box.x - pad &&
      x <= target.box.x + target.box.width + pad &&
      y >= target.box.y - pad &&
      y <= target.box.y + target.box.height + pad
    );
  };
  return targets.find((target) => target.kind === "run" && inside(target))
    ?? targets.find((target) => target.kind === "rule" && inside(target))
    ?? null;
}
