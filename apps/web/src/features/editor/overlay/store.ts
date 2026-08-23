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

  setPage: (page: number) => void;
  setZoom: (zoom: number) => void;
  setTool: (tool: OverlayTool) => void;
  select: (id: string | null) => void;
  add: (object: OverlayObject, asset?: File) => boolean;
  /** Adds several objects as one history step, e.g. a cover plus its replacement text. */
  addMany: (objects: OverlayObject[]) => boolean;
  update: (id: string, patch: Partial<OverlayObject>, options?: { history?: boolean }) => void;
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

  move: (id, deltaX, deltaY) =>
    set((state) => ({
      objects: state.objects.map((object) => {
        if (object.id !== id) return object;
        if (isPath(object)) {
          return { ...object, points: object.points.map((point) => ({ x: point.x + deltaX, y: point.y + deltaY })) };
        }
        if (object.kind === "image") {
          return { ...object, centerX: object.centerX + deltaX, centerY: object.centerY + deltaY };
        }
        return { ...object, x: object.x + deltaX, y: object.y + deltaY };
      }),
    })),

  duplicate: (id) =>
    set((state) => {
      const source = state.objects.find((object) => object.id === id);
      if (!source) return state;
      // Offset the copy so it does not hide exactly behind the original.
      const shift = 12;
      const moved = isPath(source)
        ? { ...source, points: source.points.map((point) => ({ x: point.x + shift, y: point.y - shift })) }
        : source.kind === "image"
          ? { ...source, centerX: source.centerX + shift, centerY: source.centerY - shift }
          : { ...source, x: source.x + shift, y: source.y - shift };
      const copy = { ...moved, id: crypto.randomUUID() } as OverlayObject;
      return {
        past: pushHistory(state.past, state.objects),
        future: [],
        objects: [...state.objects, copy],
        // A duplicated image points at the same file, which stays referenced.
        selectedId: copy.id,
      };
    }),

  bringToFront: (id) =>
    set((state) => {
      const target = state.objects.find((object) => object.id === id);
      if (!target) return state;
      return {
        past: pushHistory(state.past, state.objects),
        future: [],
        objects: [...state.objects.filter((object) => object.id !== id), target],
      };
    }),

  sendToBack: (id) =>
    set((state) => {
      const target = state.objects.find((object) => object.id === id);
      if (!target) return state;
      return {
        past: pushHistory(state.past, state.objects),
        future: [],
        objects: [target, ...state.objects.filter((object) => object.id !== id)],
      };
    }),

  remove: (id) =>
    set((state) => {
      const target = state.objects.find((object) => object.id === id);
      const objects = state.objects.filter((object) => object.id !== id);
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
        selectedId: state.selectedId === id ? null : state.selectedId,
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
