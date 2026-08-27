import type { RegisteredFont } from "@pdf-studio/api-client";

/**
 * Emphasis is better served by a real face than by a synthesised one. When the
 * registry holds the bold or italic member of the same family, the editor
 * switches to it; otherwise the engine synthesises the effect. These helpers
 * decide which of the two applies.
 */

export type FontStyle = { bold: boolean; italic: boolean };

/** Style words foundries append to a family name. */
const STYLE_WORDS = ["bolditalic", "boldoblique", "bold", "italic", "oblique", "regular", "book", "roman"];

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Splits a PostScript name into its family stem and the style it declares. */
export function splitFamily(family: string): { stem: string; style: FontStyle } {
  let rest = normalize(family);
  const style: FontStyle = { bold: false, italic: false };
  let matched = true;
  while (matched) {
    matched = false;
    for (const word of STYLE_WORDS) {
      if (!rest.endsWith(word) || rest.length === word.length) continue;
      if (word.includes("bold")) style.bold = true;
      if (word.includes("italic") || word.includes("oblique")) style.italic = true;
      rest = rest.slice(0, -word.length);
      matched = true;
      break;
    }
  }
  return { stem: rest, style };
}

/**
 * Style words that PostScript names carry, plus the foundry noise they end
 * with. `splitFamily` only strips a trailing style word, which is all a
 * registry face needs ("Roboto-Bold"); a name taken from a document puts them
 * mid-word instead ("Arial-BoldMT", "TimesNewRomanPS-BoldMT"), so this reads
 * the whole name and peels the noise off first.
 */
const NAME_NOISE = /(psmt|ps|mt)$/;
const NAME_STYLE = /(semibold|demibold|extrabold|ultrabold|bold|black|heavy|light|thin|medium|regular|book|roman|italic|oblique)$/;

export function describeFontName(family: string): { stem: string; style: FontStyle } {
  // A subsetted font is tagged, as in "BZZZZZ+Arial-BoldMT"; the tag names the
  // subset, never the family, so it is dropped before anything else.
  const normalized = normalize(family.replace(/^[A-Z]{6}\+/, ""));
  const style: FontStyle = {
    bold: /bold|black|heavy/.test(normalized),
    italic: /italic|oblique/.test(normalized),
  };
  let stem = normalized;
  // Peel noise and style words off the tail until nothing more comes away, so
  // "timesnewromanpsboldmt" reduces the same way "robotobold" does.
  for (let previous = ""; previous !== stem; ) {
    previous = stem;
    stem = stem.replace(NAME_NOISE, "");
    const trimmed = stem.replace(NAME_STYLE, "");
    // Never strip a name down to nothing: "Bold" alone is a family, not a style.
    if (trimmed.length > 0) stem = trimmed;
  }
  return { stem, style };
}

/** The emphasis a font id already carries by virtue of which face it is. */
export function styleOf(fontId: string, fonts: RegisteredFont[]): FontStyle {
  const font = fonts.find((entry) => entry.id === fontId);
  return font ? splitFamily(font.family).style : { bold: false, italic: false };
}

/**
 * Finds the sibling face with the requested emphasis, or null when the family
 * does not ship one and the effect has to be synthesised.
 */
export function resolveVariant(
  fontId: string,
  fonts: RegisteredFont[],
  want: FontStyle,
): string | null {
  const current = fonts.find((entry) => entry.id === fontId);
  if (!current) return null;
  const { stem } = splitFamily(current.family);
  const match = fonts.find((entry) => {
    const parsed = splitFamily(entry.family);
    return parsed.stem === stem && parsed.style.bold === want.bold && parsed.style.italic === want.italic;
  });
  return match?.id ?? null;
}

/**
 * Works out the whole patch for toggling one emphasis: swap to the real face
 * where the family provides it, and fall back to the synthetic flags where it
 * does not.
 */
export function toggleEmphasis(
  selected: { font: string; bold?: boolean; italic?: boolean },
  fonts: RegisteredFont[],
  which: "bold" | "italic",
): { font: string; bold: boolean; italic: boolean } {
  const inherited = styleOf(selected.font, fonts);
  const effective: FontStyle = {
    bold: inherited.bold || Boolean(selected.bold),
    italic: inherited.italic || Boolean(selected.italic),
  };
  const want: FontStyle = { ...effective, [which]: !effective[which] };
  const variant = resolveVariant(selected.font, fonts, want);
  if (variant) {
    // The face itself now carries the emphasis, so nothing is synthesised.
    return { font: variant, bold: false, italic: false };
  }
  return { font: selected.font, bold: want.bold, italic: want.italic };
}

/** Whether the object reads as bold or italic, from either source. */
export function effectiveStyle(
  selected: { font: string; bold?: boolean; italic?: boolean },
  fonts: RegisteredFont[],
): FontStyle {
  const inherited = styleOf(selected.font, fonts);
  return {
    bold: inherited.bold || Boolean(selected.bold),
    italic: inherited.italic || Boolean(selected.italic),
  };
}

/** Turns "LiberationSans-Bold" into "Liberation Sans" for a group heading. */
export function displayFamily(family: string): string {
  const withoutStyle = family.replace(/[-_ ]?(BoldItalic|BoldOblique|Bold|Italic|Oblique|Regular|Book|Roman)$/i, "");
  return withoutStyle
    .replace(/[-_]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim() || family;
}

/** Names the face within its family: Regular, Bold, Italic, Bold Italic. */
export function displayStyle(family: string): string {
  const { style } = splitFamily(family);
  if (style.bold && style.italic) return "Bold Italic";
  if (style.bold) return "Bold";
  if (style.italic) return "Italic";
  return "Regular";
}

export type FontFamilyGroup = { name: string; faces: RegisteredFont[] };

/**
 * Groups faces under their family. Panose would be the structural way to sort a
 * long list into sans, serif, and script, but it is left zeroed in a great many
 * shipping fonts, so the family name — which foundries do fill in — is the
 * signal that actually works.
 */
export function groupByFamily(fonts: RegisteredFont[]): FontFamilyGroup[] {
  const groups = new Map<string, FontFamilyGroup>();
  for (const font of fonts) {
    const name = displayFamily(font.family);
    const group = groups.get(name) ?? { name, faces: [] };
    group.faces.push(font);
    groups.set(name, group);
  }
  const order = ["Regular", "Italic", "Bold", "Bold Italic"];
  for (const group of groups.values()) {
    group.faces.sort((left, right) => order.indexOf(displayStyle(left.family)) - order.indexOf(displayStyle(right.family)));
  }
  return [...groups.values()].sort((left, right) => left.name.localeCompare(right.name));
}
