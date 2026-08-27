import { create } from "zustand";
import {
  MAX_ASSETS,
  MAX_OBJECTS,
  MAX_OBJECTS_PER_PAGE,
  type OverlayObject,
  type OverlayTool,
  boundsOf,
  isBox,
  isPath,
} from "./types";

const HISTORY_LIMIT = 50;

export type OverlayLimit = "page" | "document" | "assets";

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;

/** A trackpad pinch can produce a NaN delta, which would blank the canvas. */
export function clampZoom(zoom: number): number {
  if (Number.isNaN(zoom)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

type OverlayState = {
  objects: OverlayObject[];
  /** Uploaded JPEGs, keyed by the asset name the API will receive. */
  assets: Record<string, File>;
  selectedId: string | null;
  tool: OverlayTool;
  past: OverlayObject[][];
  future: OverlayObject[][];
  lastLimit: OverlayLimit | null;
  /** Which page the viewport shows, and at what scale. */
  page: number;
  zoom: number;
  /** Characters selected inside the canvas text editor, when any are. */
  textRange: { id: string; start: number; end: number } | null;
  /** Bumped when objects are swapped wholesale, so the editor can stand down. */
  revision: number;

  setPage: (page: number) => void;
  setZoom: (zoom: number) => void;
  setTool: (tool: OverlayTool) => void;
  select: (id: string | null) => void;
  add: (object: OverlayObject, asset?: File) => boolean;
  /** Adds several objects as one history step, e.g. a cover plus its replacement text. */
  addMany: (objects: OverlayObject[]) => boolean;
  update: (id: string, patch: Partial<OverlayObject>, options?: { history?: boolean }) => void;
  /** Swaps one object for the several it was cut into, in its own place in the stack. */
  replace: (id: string, objects: OverlayObject[]) => boolean;
  setTextRange: (range: { id: string; start: number; end: number } | null) => void;
  move: (id: string, deltaX: number, deltaY: number) => void;
  remove: (id: string) => void;
  duplicate: (id: string) => void;
  /** Render order is array order, so depth is a move within the list. */
  bringToFront: (id: string) => void;
  sendToBack: (id: string) => void;
  clearPage: (page: number) => void;
  undo: () => void;
  redo: () => void;
  reset: () => void;
  commit: () => void;
};

const empty = {
  objects: [] as OverlayObject[],
  assets: {} as Record<string, File>,
  selectedId: null,
  tool: "select" as OverlayTool,
  past: [] as OverlayObject[][],
  future: [] as OverlayObject[][],
  lastLimit: null,
  page: 1,
  zoom: 1,
  textRange: null,
  revision: 0,
};

function pushHistory(past: OverlayObject[][], objects: OverlayObject[]): OverlayObject[][] {
  return [...past, objects].slice(-HISTORY_LIMIT);
}

/** Objects are immutable, so a shallow copy of the array is a full snapshot. */
export const useOverlayStore = create<OverlayState>((set, get) => ({
  ...empty,

  // Switching away from Select clears the selection so a drawing tool never
  // acts on a stale object; switching back keeps whatever is selected.
  setPage: (page) => set({ page }),
  setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),
  setTool: (tool) => set({ tool, selectedId: tool === "select" ? get().selectedId : null }),
  select: (selectedId) => set({ selectedId }),

  add: (object, asset) => {
    const { objects, assets } = get();
    const onPage = objects.filter((item) => item.page === object.page).length;
    if (onPage >= MAX_OBJECTS_PER_PAGE) {
      set({ lastLimit: "page" });
      return false;
    }
    if (objects.length >= MAX_OBJECTS) {
      set({ lastLimit: "document" });
      return false;
    }
    if (asset && !assets[object.kind === "image" ? object.asset : ""] && Object.keys(assets).length >= MAX_ASSETS) {
      set({ lastLimit: "assets" });
      return false;
    }
    set((state) => ({
      past: pushHistory(state.past, state.objects),
      future: [],
      objects: [...state.objects, object],
      assets: asset && object.kind === "image" ? { ...state.assets, [object.asset]: asset } : state.assets,
      selectedId: object.id,
      lastLimit: null,
    }));
    return true;
  },

  // history:false is for the continuous stream of updates during a drag; the
  // caller takes one snapshot with commit() before the gesture starts.
  addMany: (incoming) => {
    if (incoming.length === 0) return false;
    const { objects } = get();
    const page = incoming[0].page;
    const onPage = objects.filter((item) => item.page === page).length;
    if (onPage + incoming.length > MAX_OBJECTS_PER_PAGE) {
      set({ lastLimit: "page" });
      return false;
    }
    if (objects.length + incoming.length > MAX_OBJECTS) {
      set({ lastLimit: "document" });
      return false;
    }
    set((state) => ({
      past: pushHistory(state.past, state.objects),
      future: [],
      objects: [...state.objects, ...incoming],
      selectedId: incoming[incoming.length - 1].id,
      lastLimit: null,
    }));
    return true;
  },

  update: (id, patch, options) =>
    set((state) => ({
      past: options?.history === false ? state.past : pushHistory(state.past, state.objects),
      future: options?.history === false ? state.future : [],
      objects: state.objects.map((object) =>
        object.id === id ? ({ ...object, ...patch } as OverlayObject) : object,
      ),
    })),

  setTextRange: (textRange) => set({ textRange }),

  replace: (id, next) => {
    const { objects } = get();
    const index = objects.findIndex((object) => object.id === id);
    if (index === -1 || next.length === 0) return false;
    const onPage = objects.filter((item) => item.page === next[0].page).length;
    if (onPage - 1 + next.length > MAX_OBJECTS_PER_PAGE) {
      set({ lastLimit: "page" });
      return false;
    }
    set((state) => ({
      past: pushHistory(state.past, state.objects),
      future: [],
      objects: [...state.objects.slice(0, index), ...next, ...state.objects.slice(index + 1)],
      selectedId: next.some((object) => object.id === id) ? id : next[0].id,
      textRange: null,
      revision: state.revision + 1,
      lastLimit: null,
    }));
    return true;
  },

  move: (id, deltaX, deltaY) =>
    set((state) => {
      // Pinned patches stay put: they hide printed text at a fixed spot, and
      // dragging them along would uncover it.
      const ids = new Set(memberIds(state.objects, id));
      return {
      objects: state.objects.map((object) => {
        if (!ids.has(object.id) || object.pinned) return object;
        if (isPath(object)) {
          return { ...object, points: object.points.map((point) => ({ x: point.x + deltaX, y: point.y + deltaY })) };
        }
        if (object.kind === "image") {
          return { ...object, centerX: object.centerX + deltaX, centerY: object.centerY + deltaY };
        }
        return { ...object, x: object.x + deltaX, y: object.y + deltaY };
      }),
      };
    }),

  duplicate: (id) =>
    set((state) => {
      const group = state.objects.filter((object) => memberIds(state.objects, id).includes(object.id));
      // A copy of a patch would hide whatever sits under the copy, so only the
      // replacement travels — unless the patch is all there is.
      const movable = group.filter((object) => !object.pinned);
      const members = movable.length > 0 ? movable : group;
      if (members.length === 0) return state;
      // Offset the copies so they do not hide exactly behind the originals.
      const shift = 12;
      const groupId = members.length > 1 ? crypto.randomUUID() : undefined;
      const copies = members.map((source) => {
        const moved = isPath(source)
          ? { ...source, points: source.points.map((point) => ({ x: point.x + shift, y: point.y - shift })) }
          : source.kind === "image"
            ? { ...source, centerX: source.centerX + shift, centerY: source.centerY - shift }
            : { ...source, x: source.x + shift, y: source.y - shift };
        return { ...moved, id: crypto.randomUUID(), groupId } as OverlayObject;
      });
      return {
        past: pushHistory(state.past, state.objects),
        future: [],
        objects: [...state.objects, ...copies],
        // A duplicated image points at the same file, which stays referenced.
        selectedId: copies[copies.length - 1].id,
      };
    }),

  bringToFront: (id) =>
    set((state) => {
      const ids = new Set(memberIds(state.objects, id));
      if (ids.size === 0) return state;
      // Group members travel together and keep their internal paint order.
      const members = state.objects.filter((object) => ids.has(object.id));
      return {
        past: pushHistory(state.past, state.objects),
        future: [],
        objects: [...state.objects.filter((object) => !ids.has(object.id)), ...members],
      };
    }),

  sendToBack: (id) =>
    set((state) => {
      const ids = new Set(memberIds(state.objects, id));
      if (ids.size === 0) return state;
      const members = state.objects.filter((object) => ids.has(object.id));
      return {
        past: pushHistory(state.past, state.objects),
        future: [],
        objects: [...members, ...state.objects.filter((object) => !ids.has(object.id))],
      };
    }),

  remove: (id) =>
    set((state) => {
      const ids = new Set(memberIds(state.objects, id));
      if (ids.size === 0) return state;
      const target = state.objects.find((object) => object.id === id);
      const objects = state.objects.filter((object) => !ids.has(object.id));
      const assets = { ...state.assets };
      // Drop the file only once nothing else points at it.
      if (target?.kind === "image" && !objects.some((object) => object.kind === "image" && object.asset === target.asset)) {
        delete assets[target.asset];
      }
      return {
        past: pushHistory(state.past, state.objects),
        future: [],
        objects,
        assets,
        selectedId: ids.has(state.selectedId ?? "") ? null : state.selectedId,
      };
    }),

  clearPage: (page) =>
    set((state) => {
      const objects = state.objects.filter((object) => object.page !== page);
      const assets: Record<string, File> = {};
      for (const object of objects) {
        if (object.kind === "image" && state.assets[object.asset]) assets[object.asset] = state.assets[object.asset];
      }
      return {
        past: pushHistory(state.past, state.objects),
        future: [],
        objects,
        assets,
        selectedId: null,
      };
    }),

  commit: () => set((state) => ({ past: pushHistory(state.past, state.objects), future: [] })),

  undo: () =>
    set((state) => {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        past: state.past.slice(0, -1),
        future: [state.objects, ...state.future].slice(0, HISTORY_LIMIT),
        objects: previous,
        selectedId: previous.some((object) => object.id === state.selectedId) ? state.selectedId : null,
      };
    }),

  redo: () =>
    set((state) => {
      const next = state.future[0];
      if (!next) return state;
      return {
        past: pushHistory(state.past, state.objects),
        future: state.future.slice(1),
        objects: next,
        selectedId: next.some((object) => object.id === state.selectedId) ? state.selectedId : null,
      };
    }),

  reset: () => set({ ...empty, assets: {}, objects: [], past: [], future: [] }),
}));

export function objectsOnPage(objects: OverlayObject[], page: number): OverlayObject[] {
  return objects.filter((object) => object.page === page);
}

/**
 * A retype pair (patch + replacement text) acts as one selectable unit.
 * An id nothing matches yields no members at all, so callers that guard on an
 * empty result stay no-ops instead of recording an edit that changed nothing.
 */
function memberIds(objects: OverlayObject[], id: string): string[] {
  const target = objects.find((object) => object.id === id);
  if (!target) return [];
  if (!target.groupId) return [id];
  const ids = objects.filter((object) => object.groupId === target.groupId).map((object) => object.id);
  return ids.length > 0 ? ids : [id];
}

/** The movable object a click should act on: a patch hands over to its replacement. */
export function pickAt(objects: OverlayObject[], page: number, x: number, y: number): OverlayObject | null {
  const hit = hitTest(objects, page, x, y);
  if (!hit?.pinned || !hit.groupId) return hit;
  const replacement = objects.find((object) => object.groupId === hit.groupId && !object.pinned);
  return replacement ?? hit;
}

/** Topmost object whose bounds contain the point, so clicks pick what is drawn last. */
export function hitTest(objects: OverlayObject[], page: number, x: number, y: number): OverlayObject | null {
  const candidates = objectsOnPage(objects, page);
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const object = candidates[index];
    const bounds = boundsOf(object);
    // Thin strokes need a little slack to stay clickable.
    const slack = isBox(object) || object.kind === "image" ? 0 : 6;
    if (
      x >= bounds.x - slack &&
      x <= bounds.x + bounds.width + slack &&
      y >= bounds.y - slack &&
      y <= bounds.y + bounds.height + slack
    ) {
      return object;
    }
  }
  return null;
}
