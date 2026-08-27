import { flipY } from "./geometry";
import { MIN_DRAW_SIZE, type OverlayObject, type TextAlign, type TextObject, boundsOf, isBox, isPath } from "./types";

type Frame = { x: number; y: number; width: number; height: number };

/** Screen-space resize grips, Canva-style. Corners exist for every kind; edges only for boxes and images. */
export type ScaleHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export const CORNERS = ["nw", "ne", "sw", "se"] as const;
export const EDGES = ["n", "e", "s", "w"] as const;

export const HANDLE_CURSOR: Record<ScaleHandle, string> = {
  nw: "nwse-resize", se: "nwse-resize",
  ne: "nesw-resize", sw: "nesw-resize",
  n: "ns-resize", s: "ns-resize",
  e: "ew-resize", w: "ew-resize",
};

/**
 * The box enclosing a whole selection. The grips resize this box, so the frame
 * drawn on screen has to come from here too — a retype pair whose patch is
 * wider than its text would otherwise show grips that miss the area they act on.
 */
export function unionBounds(
  members: OverlayObject[],
): { x: number; y: number; width: number; height: number } | null {
  if (members.length === 0) return null;
  const boxes = members.map(boundsOf);
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((box) => box.x + box.width)) - x,
    height: Math.max(...boxes.map((box) => box.y + box.height)) - y,
  };
}

/**
 * Canva-style resize for a selection (a single object or a retype group):
 * edges and corners rewrite geometry directly, while text scales its font
 * uniformly so glyphs keep their proportions. Everything scales about the
 * corner opposite the handle being dragged.
 *
 * `members` is the selection as it stood when the drag began and `dx`/`dy` is
 * the total travel since then, so every move recomputes the result from the
 * original geometry: dragging back to the start restores the original size and
 * no rounding accumulates along the way.
 */
export function scaleGroupPatches(
  members: OverlayObject[],
  handle: ScaleHandle,
  dx: number,
  dy: number,
): Array<[string, Partial<OverlayObject>]> {
  const boxes = members.map((member) => ({ member, bounds: boundsOf(member) }));
  const union = unionBounds(members);
  if (!union) return [];
  const { x: ux1, y: uy1, width: unionWidth, height: unionHeight } = union;

  const west = handle.includes("w");
  const east = handle.includes("e");
  const south = handle.includes("s");
  const north = handle.includes("n");

  /**
   * The dragged edge follows the pointer while the opposite one stays put, so
   * travel away from the anchor grows the selection. West grows as x falls,
   * and — because PDF space has Y growing upward — south is the low-Y edge and
   * grows as y falls.
   */
  const factor = (base: number, delta: number, inverted: boolean) =>
    Math.max(0.05, (base + (inverted ? -delta : delta)) / Math.max(1, base));

  // An edge grip drives one axis and leaves the other alone; a corner drives
  // both. Groups containing text are the exception: they stay proportional so
  // the glyphs are never distorted, driven by whichever axis the grip offers.
  const uniform = members.some((member) => member.kind === "text");
  const horizontal = east || west;
  let kx = horizontal ? factor(unionWidth, dx, west) : 1;
  let ky = north || south ? factor(unionHeight, dy, south) : 1;
  if (uniform) kx = ky = horizontal ? factor(unionWidth, dx, west) : factor(unionHeight, dy, south);

  const anchorX = west ? ux1 + unionWidth : ux1;
  const anchorY = south ? uy1 + unionHeight : uy1;

  return boxes.flatMap(({ member, bounds }) => {
    const nx = anchorX + (bounds.x - anchorX) * kx;
    const ny = anchorY + (bounds.y - anchorY) * ky;
    const nw = bounds.width * kx;
    const nh = bounds.height * ky;
    if (isBox(member)) {
      return [[member.id, { x: nx, y: ny, width: Math.max(MIN_DRAW_SIZE, nw), height: Math.max(MIN_DRAW_SIZE, nh) }] as [string, Partial<OverlayObject>]];
    }
    if (member.kind === "image") {
      return [[member.id, { centerX: nx + nw / 2, centerY: ny + nh / 2, width: Math.max(MIN_DRAW_SIZE, nw), height: Math.max(MIN_DRAW_SIZE, nh) }] as [string, Partial<OverlayObject>]];
    }
    if (member.kind === "text") {
      // Text is resized by its font size, so it takes the single driving axis.
      const fontSize = Math.min(288, Math.max(4, member.fontSize * (horizontal ? kx : ky)));
      const ratio = fontSize / member.fontSize;
      // boundsOf reports the visual left edge; the object stores the baseline
      // anchor, so re-apply the alignment offset (scaled) after resizing.
      const alignOffset = (member.x - bounds.x) * ratio;
      return [[member.id, { x: nx + alignOffset, y: ny + member.fontSize * 0.22 * ratio, fontSize }] as [string, Partial<OverlayObject>]];
    }
    if (isPath(member)) {
      return [[member.id, { points: member.points.map((point) => ({ x: anchorX + (point.x - anchorX) * kx, y: anchorY + (point.y - anchorY) * ky })) }] as [string, Partial<OverlayObject>]];
    }
    return [];
  });
}

/** Thickness of the grab ring around the frame, and how much of it sits inside. */
const RING = 10;
const RING_INSIDE = 2;

/** The four screen-space strips that make a selection frame draggable. */
export function ringStrips(
  frame: Frame,
  pageHeight: number,
  scale: number,
): Array<{ edge: string; style: { left: number; top: number; width: number; height: number } }> {
  const left = frame.x * scale;
  const top = flipY(frame.y + frame.height, pageHeight) * scale;
  const width = frame.width * scale;
  const height = frame.height * scale;
  const outside = RING - RING_INSIDE;
  return [
    { edge: "top", style: { left: left - outside, top: top - outside, width: width + outside * 2, height: RING } },
    { edge: "bottom", style: { left: left - outside, top: top + height - RING_INSIDE, width: width + outside * 2, height: RING } },
    { edge: "left", style: { left: left - outside, top: top - outside, width: RING, height: height + outside * 2 } },
    { edge: "right", style: { left: left + width - RING_INSIDE, top: top - outside, width: RING, height: height + outside * 2 } },
  ];
}


/**
 * Where a grip sits, in PDF space: exactly on the edge or corner it drags, so
 * the grips line up with the frame instead of floating inside or outside it.
 */
export function handleCenter(handle: ScaleHandle, frame: Frame): { x: number; y: number } {
  return {
    x: handle.includes("w")
      ? frame.x
      : handle.includes("e") ? frame.x + frame.width : frame.x + frame.width / 2,
    y: handle.includes("s")
      ? frame.y
      : handle.includes("n") ? frame.y + frame.height : frame.y + frame.height / 2,
  };
}

/**
 * A side grip on text sets the width of its box rather than the size of its
 * type: the wording reflows inside the new width, which is what a side handle
 * means on a text box everywhere else. The edge being dragged follows the
 * pointer and the opposite edge stays put, which for centred and right-aligned
 * text means moving the anchor as well as the width.
 */
export function wrapPatches(
  members: OverlayObject[],
  handle: ScaleHandle,
  dx: number,
): Array<[string, Partial<OverlayObject>]> {
  const east = handle.includes("e");
  return members.flatMap((member) => {
    if (member.kind !== "text") return [];
    const current = member.boxWidth ?? boundsOf(member).width;
    const width = Math.max(member.fontSize * 2, MIN_DRAW_SIZE, current + (east ? dx : -dx));
    // How far the anchor travels depends on which edge it sits on.
    const anchorShift = east
      ? member.align === "right" ? dx : member.align === "center" ? dx / 2 : 0
      : member.align === "left" ? dx : member.align === "center" ? dx / 2 : 0;
    return [[member.id, { boxWidth: width, x: member.x + anchorShift }] as [string, Partial<OverlayObject>]];
  });
}

/**
 * A grip needs room to be grabbed without colliding with the corner beside it.
 * A side bar is 20px and the two corners take 11px between them, so an edge
 * shorter than this leaves no daylight around any of them. Below it the side
 * grip on that edge is dropped rather than shown squeezed between two corners
 * — which is what made a small box, or any box at low zoom, show a jumble of
 * half its handles.
 */
const SIDE_GRIP_ROOM = 60;

/** Below this, even two corner dots on one edge would touch. */
const CORNER_PAIR_ROOM = 26;

export function gripsFor({ kind, hasText, widthPx, heightPx }: {
  kind: OverlayObject["kind"];
  hasText: boolean;
  widthPx: number;
  heightPx: number;
}): ScaleHandle[] {
  // Freehand points do not scale cleanly, so a scribble gets a frame and no grips.
  if (kind === "draw") return [];

  // A short edge cannot hold a corner and a side handle without them touching,
  // so instead of dropping one job the two are split between the sides: resize
  // lives on the left, the side handle on the right. Both jobs stay reachable
  // however far the page is zoomed out.
  if (heightPx < SIDE_GRIP_ROOM) {
    const left: ScaleHandle[] = heightPx >= CORNER_PAIR_ROOM ? ["nw", "sw"] : ["nw"];
    return [...left, "e"];
  }

  // With room to breathe, everything shows: corners resize, and each edge gets
  // a side handle at its middle.
  const grips: ScaleHandle[] = [...CORNERS, "e", "w"];
  // Text has no height handle: its box grows by the line as the words wrap.
  if (!hasText && widthPx >= SIDE_GRIP_ROOM) grips.push("n", "s");
  return grips;
}

/**
 * What a grip does. A corner resizes; a grip at the middle of an edge is a side
 * handle, which drives that one dimension — the width of a text box, or one
 * axis of a shape.
 */
export function gripRole(handle: ScaleHandle): "size" | "side" {
  return handle.length === 1 ? "side" : "size";
}

/** Screen size of a grip: side handles are bars along their edge, corners are dots. */
export function gripShape(handle: ScaleHandle): { width: number; height: number } {
  if (handle === "e" || handle === "w") return { width: 6, height: 20 };
  if (handle === "n" || handle === "s") return { width: 20, height: 6 };
  return { width: 11, height: 11 };
}

/**
 * Changing the alignment of text must not move its box: the words rearrange
 * inside the same rectangle. Since `x` is the anchor — the left edge, the
 * centre, or the right edge depending on the alignment — it has to move by the
 * same amount the meaning of it does.
 */
export function alignPatch(object: TextObject, align: TextAlign): Partial<TextObject> {
  const bounds = boundsOf(object);
  const width = object.boxWidth ?? bounds.width;
  const x = align === "center"
    ? bounds.x + width / 2
    : align === "right" ? bounds.x + width : bounds.x;
  return { align, x };
}
