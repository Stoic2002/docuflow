import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadRegisteredFont, useRegisteredFonts } from "./font-loading";

type Face = { family: string; source: string };
const created: Face[] = [];
const added: Face[] = [];

function font(id: string, family = id.toUpperCase()) {
  return { id, family, serif: false, fixed: false, category: "sans" as const };
}

/** Stands in for the CSS Font Loading API, which jsdom does not implement. */
function installFontFace() {
  class FakeFontFace {
    constructor(public family: string, public source: string) {
      created.push({ family, source });
    }
    load() {
      return Promise.resolve(this);
    }
  }
  vi.stubGlobal("FontFace", FakeFontFace);
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { add: (face: Face) => added.push(face) },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  created.length = 0;
  added.length = 0;
});

describe("loadRegisteredFont", () => {
  it("registers the face under the name the editor renders with", async () => {
    installFontFace();
    await loadRegisteredFont(font("tinos", "Tinos"));
    expect(created).toEqual([{ family: "Tinos", source: 'url(/api/fonts/tinos/file) format("truetype")' }]);
    expect(added).toHaveLength(1);
  });

  it("fetches a face only once however many objects use it", async () => {
    installFontFace();
    await Promise.all([loadRegisteredFont(font("arimo")), loadRegisteredFont(font("arimo"))]);
    expect(created).toHaveLength(1);
  });

  it("stays quiet where the browser has no font loading API", async () => {
    // jsdom takes this path: measurement then keeps its estimate rather than
    // the editor failing to open.
    await expect(loadRegisteredFont(font("lato"))).resolves.toBeUndefined();
    expect(created).toHaveLength(0);
  });
});

describe("useRegisteredFonts", () => {
  it("loads only the faces the document actually uses", async () => {
    installFontFace();
    const fonts = [font("roboto"), font("merriweather"), font("oswald")];
    const { result } = renderHook(() => useRegisteredFonts(fonts, ["roboto", "roboto", ""]));
    await waitFor(() => expect(result.current).toBe(1));
    expect(created.map((face) => face.family)).toEqual(["ROBOTO"]);
  });

  it("does nothing when no text carries a registered font", async () => {
    installFontFace();
    const { result } = renderHook(() => useRegisteredFonts([font("inter")], ["", "tidak-terdaftar"]));
    await waitFor(() => expect(created).toHaveLength(0));
    expect(result.current).toBe(0);
  });
});
