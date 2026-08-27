import { type TextObject, boundsOf, textLayoutOf } from "./types";

/**
 * One text object carries one style, which is fine until a reader wants a
 * single word inside it bold. Rather than a rich-text model, the object is cut
 * into up to three: the part before the selection, the selected part with its
 * new style, and the part after. Each piece is placed at the offset the ones
 * before it actually measure, so the line reads as it did — and the exporter
 * needs no new concept, since it already places runs.
 *
 * Returns null when there is nothing to split: an empty or whole-string
 * selection, or a box whose words wrap, where separate pieces could not flow
 * together and the style has to apply to the object as a whole.
 */
export function splitForStyle(
  object: TextObject,
  start: number,
  end: number,
  patch: Partial<TextObject>,
): TextObject[] | null {
  if (object.boxWidth) return null;
  const from = Math.max(0, Math.min(start, end));
  const to = Math.min(object.text.length, Math.max(start, end));
  if (to <= from) return null;
  if (from === 0 && to === object.text.length) return null;

  const before = object.text.slice(0, from);
  const middle = object.text.slice(from, to);
  const after = object.text.slice(to);
  const styled = { ...object, ...patch } as TextObject;

  // The visual left edge, which is where the first piece starts whatever the
  // alignment was; the pieces are positioned individually from here on.
  const left = boundsOf(object).x;
  const beforeWidth = widthOf(object, before);
  const middleWidth = widthOf(styled, middle);

  // A retype pair keeps its group so the patch underneath still travels with
  // the words; anything else gains one, so the pieces stay a single object to
  // drag, delete, and restack.
  const groupId = object.groupId ?? crypto.randomUUID();
  const pieces: Array<{ text: string; x: number; styled: boolean }> = [
    { text: before, x: left, styled: false },
    { text: middle, x: left + beforeWidth, styled: true },
    { text: after, x: left + beforeWidth + middleWidth, styled: false },
  ];

  return pieces
    .filter((piece) => piece.text.length > 0)
    .map((piece) => ({
      ...(piece.styled ? styled : object),
      // The styled piece keeps the id, so the toolbar carries on pointing at
      // what the reader just changed.
      id: piece.styled ? object.id : crypto.randomUUID(),
      text: piece.text,
      x: piece.x,
      align: "left" as const,
      groupId,
      // The patch width belonged to the whole run; a piece of it would only
      // raise a false overflow warning.
      coverWidth: undefined,
    }));
}

function widthOf(object: TextObject, text: string): number {
  return text ? textLayoutOf({ ...object, text, boxWidth: undefined }).width : 0;
}
