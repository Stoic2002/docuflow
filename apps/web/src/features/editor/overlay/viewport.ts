/**
 * The scroller's geometry. The page sits inside a wrapper padded by half a
 * viewport on every side, which is what gives the paper room to be dragged
 * freely; the padding is fixed while the page itself grows with zoom, so both
 * the layout and the zoom compensation have to agree on where the page's
 * top-left corner sits.
 */

/** Empty travel around the page, in CSS pixels. */
export function canvasPads(width: number, height: number): { x: number; y: number } {
  return {
    x: Math.max(96, Math.round(width / 2)),
    y: Math.max(48, Math.round(height / 2)),
  };
}

/**
 * Scroll offsets that keep whatever sits under `anchor` in place across a zoom
 * step. The scaling happens about the page origin — the constant padding
 * offset inside the scroller — not about the wrapper origin: padding does not
 * grow with zoom, and dropping that term is what used to make the view slide
 * away while pinching.
 */
export function scrollForZoom(
  scroll: { left: number; top: number },
  pads: { x: number; y: number },
  anchor: { x: number; y: number },
  factor: number,
): { left: number; top: number } {
  return {
    left: pads.x + (scroll.left + anchor.x - pads.x) * factor - anchor.x,
    top: pads.y + (scroll.top + anchor.y - pads.y) * factor - anchor.y,
  };
}

/**
 * Where the scroller should start so the page greets the reader in the middle
 * rather than tucked into a corner. The wrapper pads the page by half a
 * viewport, so scroll 0 shows that empty travel instead of the paper.
 *
 * A page taller than the viewport is aligned near its top edge — centring it
 * vertically would open the document halfway down the first page.
 */
export function initialScroll(
  page: { width: number; height: number },
  viewport: { width: number; height: number },
  zoom: number,
): { left: number; top: number } {
  const pads = canvasPads(viewport.width, viewport.height);
  const height = page.height * zoom;
  return {
    left: pads.x + (page.width * zoom - viewport.width) / 2,
    top: height <= viewport.height ? pads.y + (height - viewport.height) / 2 : pads.y - 24,
  };
}
