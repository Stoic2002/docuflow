import { api, type RegisteredFont } from "@pdf-studio/api-client";
import { useEffect, useState } from "react";

/**
 * The editor draws its preview with the browser's own text rendering, and it
 * measures strings the same way to place frames, grips, and the caret. Both
 * are only right if the browser actually has the face the export will embed,
 * which it usually does not — the server's fonts live on the server. So the
 * faces in use are fetched from the API and registered with the document.
 */

/** One promise per face, so a font shared by many objects is fetched once. */
const requested = new Map<string, Promise<void>>();

export function loadRegisteredFont(font: RegisteredFont): Promise<void> {
  const existing = requested.get(font.id);
  if (existing) return existing;
  const pending = (async () => {
    // jsdom and very old browsers have no CSS Font Loading API; measurement
    // then keeps its estimate instead of failing.
    if (typeof FontFace === "undefined" || !document.fonts) return;
    const face = new FontFace(font.family, `url(${api.fontFileUrl(font.id)}) format("truetype")`);
    await face.load();
    document.fonts.add(face);
  })().catch(() => undefined);
  requested.set(font.id, pending);
  return pending;
}

/**
 * Loads the faces the given ids name and returns a counter that changes once
 * more of them are ready, so callers can re-measure and repaint. Only the
 * fonts a document actually uses are fetched — the registry holds a hundred.
 */
export function useRegisteredFonts(fonts: RegisteredFont[], ids: string[]): number {
  const [ready, setReady] = useState(0);
  // A stable key, so the effect does not re-run on every render just because
  // the caller built a new array.
  const wanted = [...new Set(ids.filter(Boolean))].sort().join(" ");
  useEffect(() => {
    const targets = wanted
      .split(" ")
      .map((id) => fonts.find((font) => font.id === id))
      .filter((font): font is RegisteredFont => Boolean(font));
    if (targets.length === 0) return;
    let active = true;
    void Promise.all(targets.map(loadRegisteredFont)).then(() => {
      if (active) setReady((count) => count + 1);
    });
    return () => {
      active = false;
    };
  }, [wanted, fonts]);
  return ready;
}
