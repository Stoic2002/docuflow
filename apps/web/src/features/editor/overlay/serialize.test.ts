import { afterEach, describe, expect, it } from "vitest";
import { toAnnotationDocument, usedAssets } from "./serialize";
import { LINE_HEIGHT, setTextLayout, type BoxObject, type ImageObject, type PathObject, type OverlayObject, type TextObject } from "./types";

const text: TextObject = {
  id: "t1", kind: "text", page: 2, text: "Disetujui", x: 100, y: 700,
  fontSize: 18, font: "arialmt", color: "#c62828", align: "center", opacity: 1, rotation: -12,
};
const box: BoxObject = {
  id: "b1", kind: "rectangle", page: 1, x: 60, y: 600, width: 200, height: 90,
  stroke: "#1565c0", strokeWidth: 2, fill: "#e3f2fd", opacity: 0.9, rotation: 0,
};
const outline: BoxObject = { ...box, id: "b2", kind: "ellipse", fill: null };
const scribble: PathObject = {
  id: "p1", kind: "draw", page: 1, points: [{ x: 10, y: 20 }, { x: 30, y: 40 }, { x: 50, y: 25 }],
  stroke: "#2e7d32", strokeWidth: 3, opacity: 1, rotation: 0,
};
const straight: PathObject = { ...scribble, id: "p2", kind: "line", points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] };
const image: ImageObject = {
  id: "i1", kind: "image", page: 1, asset: "ttd", centerX: 400, centerY: 300,
  width: 120, height: 60, previewUrl: "blob:x", opacity: 1, rotation: 5,
};

describe("toAnnotationDocument", () => {
  it("groups objects by page and orders the pages", () => {
    const document = toAnnotationDocument([text, box, image]);
    expect(document.pages.map((page) => page.page)).toEqual([1, 2]);
    expect(document.pages[0].shapes).toHaveLength(1);
    expect(document.pages[0].images).toHaveLength(1);
    expect(document.pages[1].texts).toHaveLength(1);
  });

  it("omits empty collections so the payload stays minimal", () => {
    const [page] = toAnnotationDocument([text]).pages;
    expect(page.texts).toHaveLength(1);
    expect(page).not.toHaveProperty("shapes");
    expect(page).not.toHaveProperty("images");
  });

  it("keeps text coordinates untouched because both sides use PDF space", () => {
    const [page] = toAnnotationDocument([text]).pages;
    expect(page.texts?.[0]).toMatchObject({
      text: "Disetujui", x: 100, y: 700, fontSize: 18,
      font: "arialmt", color: "#c62828", align: "center", rotation: -12,
    });
  });

  it("turns a box into the two opposite corners the engine expects", () => {
    const [page] = toAnnotationDocument([box]).pages;
    expect(page.shapes?.[0].points).toEqual([{ x: 60, y: 600 }, { x: 260, y: 690 }]);
    expect(page.shapes?.[0].fill).toBe("#e3f2fd");
  });

  it("sends no fill for an outline-only shape", () => {
    const [page] = toAnnotationDocument([outline]).pages;
    expect(page.shapes?.[0].fill).toBeUndefined();
  });

  it("maps the freehand tool onto the polyline geometry", () => {
    const [page] = toAnnotationDocument([scribble, straight]).pages;
    expect(page.shapes?.[0].kind).toBe("polyline");
    expect(page.shapes?.[0].points).toHaveLength(3);
    expect(page.shapes?.[1].kind).toBe("line");
  });

  it("drops an empty font so the server falls back to the built-in face", () => {
    const [page] = toAnnotationDocument([{ ...text, font: "" }]).pages;
    expect(page.texts?.[0].font).toBeUndefined();
  });
});

describe("usedAssets", () => {
  const file = new File(["x"], "ttd.jpg", { type: "image/jpeg" });
  const orphan = new File(["y"], "old.jpg", { type: "image/jpeg" });

  it("uploads only the files an object still references", () => {
    const assets = usedAssets([image] as OverlayObject[], { ttd: file, lama: orphan });
    expect(Object.keys(assets)).toEqual(["ttd"]);
  });

  it("returns nothing when no image objects remain", () => {
    expect(usedAssets([text], { ttd: file })).toEqual({});
  });
});

describe("text emphasis and arrows", () => {
  it("sends emphasis only when it is switched on", () => {
    const [page] = toAnnotationDocument([{ ...text, bold: true, underline: true }]).pages;
    expect(page.texts?.[0]).toMatchObject({ bold: true, underline: true });
    // Unset flags are omitted rather than sent as false, keeping the payload small.
    expect(page.texts?.[0]).not.toHaveProperty("italic");
    expect(page.texts?.[0]).not.toHaveProperty("strikethrough");
  });

  it("omits emphasis entirely for plain text", () => {
    const [page] = toAnnotationDocument([text]).pages;
    expect(page.texts?.[0]).not.toHaveProperty("bold");
  });

  it("marks an arrow on a line", () => {
    const [page] = toAnnotationDocument([{ ...straight, arrow: true }]).pages;
    expect(page.shapes?.[0]).toMatchObject({ kind: "line", arrow: true });
  });

  it("omits the arrow flag on a plain line", () => {
    const [page] = toAnnotationDocument([straight]).pages;
    expect(page.shapes?.[0]).not.toHaveProperty("arrow");
  });
});

describe("wrapped text", () => {
  afterEach(() => setTextLayout(null));

  it("sends one positioned run per line, top down", () => {
    // The engine places runs and never reflows them, so the breaks the browser
    // measured have to travel as separate texts.
    setTextLayout(() => ({ lines: ["baris satu", "baris dua"], width: 160 }));
    const wrapped: TextObject = {
      id: "t1", kind: "text", page: 1, text: "baris satu baris dua",
      x: 100, y: 700, fontSize: 20, font: "", color: "#111111",
      align: "left", opacity: 1, rotation: 0, boxWidth: 160,
    };
    const [page] = toAnnotationDocument([wrapped]).pages;
    expect(page.texts).toHaveLength(2);
    expect(page.texts?.[0]).toMatchObject({ text: "baris satu", x: 100, y: 700 });
    expect(page.texts?.[1]).toMatchObject({ text: "baris dua", x: 100, y: 700 - 20 * LINE_HEIGHT });
  });

  it("still sends unwrapped text as a single run", () => {
    setTextLayout(() => ({ lines: ["satu baris saja"], width: 160 }));
    const plain: TextObject = {
      id: "t2", kind: "text", page: 1, text: "satu baris saja",
      x: 10, y: 20, fontSize: 12, font: "", color: "#111111",
      align: "left", opacity: 1, rotation: 0,
    };
    expect(toAnnotationDocument([plain]).pages[0].texts).toHaveLength(1);
  });
});
