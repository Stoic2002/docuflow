/**
 * A PDF changes text colour with a graphics-state operator, not by starting a
 * new text run, so one fragment can hold words of two colours — "Nama: " in
 * black and a name after it in red. Reading a single ink colour for the whole
 * fragment repaints them all the same, which is exactly what a reader notices.
 *
 * The page is already rendered, so the colours are read back off it character
 * by character and the fragment is cut where they change.
 */

export type ColorSpan = { text: string; offset: number; color: string };

/** Channel bits dropped before comparing, so anti-aliasing does not read as a new colour. */
const BUCKET = 24;
/** Total channel difference that counts as a different colour rather than noise. */
const DIFFERENT = 96;
/** How many characters must agree before a new colour is believed. */
const CONFIRM = 2;

function bucket(color: string): [number, number, number] {
  return [1, 3, 5].map((offset) => {
    const value = parseInt(color.slice(offset, offset + 2), 16);
    return Number.isNaN(value) ? 0 : Math.round(value / BUCKET) * BUCKET;
  }) as [number, number, number];
}

function apart(left: string, right: string): number {
  const a = bucket(left);
  const b = bucket(right);
  return a.reduce((total, value, channel) => total + Math.abs(value - b[channel]), 0);
}

/**
 * Splits `text` where its ink colour changes. `offsets` holds the cumulative
 * advance of every character, so `offsets[i]`..`offsets[i + 1]` is the cell to
 * read for character `i`; `sample` returns null where a cell holds no ink,
 * which is what a space does, and those simply continue the run they are in.
 */
export function colorSpans(
  text: string,
  offsets: number[],
  sample: (from: number, to: number) => string | null,
  fallback: string,
): ColorSpan[] {
  if (text.length === 0 || offsets.length < text.length + 1) {
    return [{ text, offset: 0, color: fallback }];
  }

  const colors = [...text].map((character, index) =>
    character.trim() === "" ? null : sample(offsets[index], offsets[index + 1]),
  );

  const spans: ColorSpan[] = [];
  let current: { start: number; color: string } | null = null;
  for (let index = 0; index < text.length; index += 1) {
    const color = colors[index];
    if (!current) {
      current = { start: index, color: color ?? fallback };
      continue;
    }
    if (!color || apart(color, current.color) <= DIFFERENT) continue;
    // One odd character is anti-aliasing or a stray pixel; a run of them is a
    // real change of colour.
    const confirmed = colors
      .slice(index, index + CONFIRM)
      .filter((candidate): candidate is string => candidate !== null);
    if (confirmed.length < CONFIRM || confirmed.some((candidate) => apart(candidate, color) > DIFFERENT)) {
      continue;
    }
    spans.push({ text: text.slice(current.start, index), offset: offsets[current.start], color: current.color });
    current = { start: index, color };
  }
  if (current) {
    spans.push({ text: text.slice(current.start), offset: offsets[current.start], color: current.color });
  }
  return spans.length > 0 ? spans : [{ text, offset: 0, color: fallback }];
}
