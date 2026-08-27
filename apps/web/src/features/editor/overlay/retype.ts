import type { RegisteredFont } from "@pdf-studio/api-client";
import { describeFontName, type FontStyle } from "./font-variants";
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

/** Channel bits dropped when bucketing samples; 16 levels per channel. */
const COLOR_BUCKET_SHIFT = 4;
/** The dominant colour must hold at least this share for the area to count as flat. */
const UNIFORM_SHARE = 0.72;

function toHex(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
}

/**
 * Samples rings just outside the run and reports the colour behind it. Pixel
 * coordinates are top-left origin, matching the rendered canvas.
 *
 * The result is the most common colour, not the average. Averaging was wrong
 * in practice: a ring that clips the line above, a rule, or a neighbouring word
 * picks up dark pixels, and their weight drags the mean away from the paper —
 * producing a patch that is visibly darker than the page. A modal colour
 * ignores that minority entirely.
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
  const steps = 16;
  // Two rings: the inner one hugs the glyphs, the outer one reaches clean paper.
  for (const distance of [ring, ring * 2]) {
    for (let index = 0; index <= steps; index += 1) {
      const alongX = box.x + (box.width * index) / steps;
      const alongY = box.y + (box.height * index) / steps;
      read(alongX, box.y - distance);
      read(alongX, box.y + box.height + distance);
      read(box.x - distance, alongY);
      read(box.x + box.width + distance, alongY);
    }
  }
  if (samples.length === 0) return { color: "#ffffff", uniform: false };

  const buckets = new Map<number, [number, number, number][]>();
  for (const sample of samples) {
    const key = sample.reduce((total, value) => (total << 4) | (value >> COLOR_BUCKET_SHIFT), 0);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(sample);
    else buckets.set(key, [sample]);
  }
  let dominant: [number, number, number][] = [];
  for (const bucket of buckets.values()) {
    if (bucket.length > dominant.length) dominant = bucket;
  }
  const mean = [0, 1, 2].map(
    (channel) => dominant.reduce((total, sample) => total + sample[channel], 0) / dominant.length,
  );
  return {
    color: `#${toHex(mean[0])}${toHex(mean[1])}${toHex(mean[2])}`,
    uniform: dominant.length / samples.length >= UNIFORM_SHARE,
  };
}

function normalizeFamily(value: string): string {
  // A subsetted font arrives tagged, as in "ABCDEF+Roboto"; the tag says which
  // subset it is, never which family, so it goes before anything else.
  return value.replace(/^[A-Z]{6}\+/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Proprietary families that PDFs routinely embed, mapped to the free
 * metric-compatible stand-in shipped in assets/fonts. Metrics match, so
 * replacement text occupies exactly the space the original did.
 */
const ALIAS_RULES: Array<[needles: string[], family: string]> = [
  [["times"], "Tinos"],
  [["arial", "helvetica"], "Arimo"],
  [["calibri"], "Carlito"],
  [["cambria"], "Caladea"],
  [["georgia"], "Gelasio"],
  [["mincho"], "Shippori Mincho"],
];

/** The substitute family for a document font, when a known alias applies. */
export function aliasFamilyFor(fontFamily: string): string | null {
  const lower = fontFamily.toLowerCase();
  for (const [needles, family] of ALIAS_RULES) {
    if (needles.some((needle) => lower.includes(needle))) return family;
  }
  return null;
}

/**
 * Picks the registered font closest to the one the page already uses, so the
 * replacement blends in. Falls back to a face with the same serif and pitch
 * character, then to the built-in Helvetica.
 */
export function matchFont(fontFamily: string, fonts: RegisteredFont[], declared?: FontStyle): string {
  if (fonts.length === 0) return "";
  const wanted = normalizeFamily(fontFamily);
  const described = describeFontName(fontFamily);
  const wantedStem = described.stem;
  // What the font program declares beats what its name reads, and it is the
  // only clue at all when the name is a generic like "sans-serif".
  const wantedStyle = declared ?? described.style;
  const candidates = fonts.map((font) => ({
    font,
    normalized: normalizeFamily(font.family),
    ...describeFontName(font.family),
  }));

  // The very same face, when the document uses one the server also has.
  const exact = candidates.find((candidate) => candidate.normalized === wanted);
  if (exact) return exact.font.id;

  // Otherwise the family comes first and the emphasis second. Matching on the
  // whole name instead would take whichever face sorted first — the reason a
  // plain "Roboto" run came back as Roboto-Bold.
  const sameFamily = candidates.filter((candidate) => candidate.stem === wantedStem);
  const chosen = closestStyle(sameFamily, wantedStyle);
  if (chosen) return chosen;

  const related = candidates.filter(
    (candidate) =>
      wantedStem.length > 2 &&
      candidate.stem.length > 2 &&
      (candidate.stem.includes(wantedStem) || wantedStem.includes(candidate.stem)),
  );
  const loose = closestStyle(related, wantedStyle);
  if (loose) return loose;

  // A known proprietary family resolves to its metric-compatible stand-in;
  // these substitutes are shipped precisely so this lookup succeeds.
  const alias = aliasFamilyFor(fontFamily);
  if (alias) {
    const aliasStem = describeFontName(alias).stem;
    const aliased = closestStyle(candidates.filter((candidate) => candidate.stem === aliasStem), wantedStyle);
    if (aliased) return aliased;
  }

  const lower = fontFamily.toLowerCase();
  // Pitch outranks serif: a monospace request is satisfied by any monospace
  // face, whether or not that face happens to have serifs.
  if (lower.includes("mono") || lower.includes("courier")) {
    const fixed = closestStyle(candidates.filter((candidate) => candidate.font.fixed), wantedStyle);
    if (fixed) return fixed;
  }
  const wantsSerif = lower.includes("sans")
    ? false
    : lower.includes("serif") || lower.includes("times") || lower.includes("georgia") || lower.includes("roman");
  const byCharacter = candidates.filter((candidate) => !candidate.font.fixed && candidate.font.serif === wantsSerif);
  return closestStyle(byCharacter, wantedStyle) ?? "";
}

/**
 * The face in a shortlist that carries the wanted emphasis, falling back to the
 * plain one. Taking the first entry instead is how an unemphasised run ended up
 * bold: the registry is ordered by file name, and "Bold" sorts before
 * "Regular".
 */
function closestStyle(
  candidates: Array<{ font: RegisteredFont; style: FontStyle }>,
  want: FontStyle,
): string | null {
  if (candidates.length === 0) return null;
  const sameStyle = candidates.find(
    (candidate) => candidate.style.bold === want.bold && candidate.style.italic === want.italic,
  );
  if (sameStyle) return sameStyle.font.id;
  const plain = candidates.find((candidate) => !candidate.style.bold && !candidate.style.italic);
  return (plain ?? candidates[0]).font.id;
}


/** Runs too small to click reliably are hidden from the picker. */
export function pickableRuns(runs: PdfTextRun[]): PdfTextRun[] {
  return runs.filter((run) => run.width >= 2 && run.fontSize >= 3);
}

/**
 * Guesses the colour of the original glyphs so the replacement text matches.
 * The ink is whichever sampled pixel sits furthest from the background, which
 * works for dark text on light pages and for light text on dark ones. Null
 * means the box holds nothing but background — a space, or an empty margin.
 */
export function sampledInk(
  data: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  box: { x: number; y: number; width: number; height: number },
  background: string,
): string | null {
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
  // Nothing here differs from its background, so there is no ink to read.
  if (!best || bestDistance < 40) return null;
  return `#${toHex(best[0])}${toHex(best[1])}${toHex(best[2])}`;
}

/** The colour of the ink in a box, falling back to near-black when there is none. */
export function inkColorFor(
  data: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  box: { x: number; y: number; width: number; height: number },
  background: string,
): string {
  return sampledInk(data, imageWidth, imageHeight, box, background) ?? "#111111";
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
