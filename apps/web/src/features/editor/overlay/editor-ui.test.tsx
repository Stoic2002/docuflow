import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryControls } from "./history-controls";
import { PropertiesBar } from "./properties-bar";
import { useOverlayStore } from "./store";
import { setTextLayout } from "./types";
import { EditorToolbar } from "./toolbar";
import type { BoxObject, TextObject } from "./types";

const fonts = [{ id: "arialmt", family: "ArialMT", serif: false, fixed: false, category: "sans" as const }];
const state = () => useOverlayStore.getState();

const box: BoxObject = {
  id: "b1", kind: "rectangle", page: 1, x: 10, y: 10, width: 100, height: 50,
  stroke: "#1565c0", strokeWidth: 2, fill: null, opacity: 1, rotation: 0,
};
const text: TextObject = {
  id: "t1", kind: "text", page: 1, text: "Halo", x: 10, y: 10, fontSize: 16,
  font: "", color: "#111111", align: "left", opacity: 1, rotation: 0,
};

beforeEach(() => state().reset());
afterEach(cleanup);

function toolbar(props: Partial<Parameters<typeof EditorToolbar>[0]> = {}) {
  return (
    <EditorToolbar
      onPickImage={vi.fn()}
      disabled={false}
      showHints={false}
      onToggleHints={vi.fn()}
      {...props}
    />
  );
}

describe("EditorToolbar", () => {
  it("marks the active tool and switches on click", () => {
    render(toolbar());
    expect(screen.getByLabelText("Pilih")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByLabelText("Kotak"));
    expect(state().tool).toBe("rectangle");
    expect(screen.getByLabelText("Kotak")).toHaveAttribute("aria-pressed", "true");
  });

  it("offers a hand tool for dragging the page", () => {
    render(toolbar());
    fireEvent.click(screen.getByLabelText("Geser halaman"));
    expect(state().tool).toBe("hand");
  });

  it("no longer needs a separate mode for replacing printed text", () => {
    render(toolbar());
    // Picking happens straight from Select, so these modes are gone.
    expect(screen.queryByLabelText("Ganti teks asli")).toBeNull();
    expect(screen.queryByLabelText("Garis & tabel")).toBeNull();
  });

  it("leaves history and deletion to the header and the properties bar", () => {
    // The rail is for drawing tools: undoing belongs to the document, and
    // deleting belongs to whatever is selected.
    render(toolbar());
    expect(screen.queryByLabelText("Urungkan")).toBeNull();
    expect(screen.queryByLabelText("Ulangi")).toBeNull();
    expect(screen.queryByLabelText("Hapus objek terpilih")).toBeNull();
  });

  it("offers a highlighter and an arrow among the drawing tools", () => {
    render(toolbar());
    fireEvent.click(screen.getByLabelText("Stabilo"));
    expect(state().tool).toBe("highlight");
    fireEvent.click(screen.getByLabelText("Panah"));
    expect(state().tool).toBe("arrow");
  });

  it("reports the highlight toggle as pressed and calls back", () => {
    const onToggleHints = vi.fn();
    render(toolbar({ showHints: true, onToggleHints }));
    const toggle = screen.getByLabelText("Sorot elemen asli");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(toggle);
    expect(onToggleHints).toHaveBeenCalledWith(false);
  });

  it("disables every control when the capability is unavailable", () => {
    render(toolbar({ disabled: true }));
    expect(screen.getByLabelText("Teks")).toBeDisabled();
    expect(screen.getByLabelText("Sisipkan JPG")).toBeDisabled();
  });
});

describe("PropertiesBar", () => {
  it("stays out of the way while nothing is selected", () => {
    // Canva-style: the bar belongs to a selection, so with none there is
    // nothing for it to say and it does not take up the page.
    render(<PropertiesBar fonts={fonts} fontsAvailable />);
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("never lets a line break into the stored text", () => {
    state().add(text);
    render(<PropertiesBar fonts={fonts} fontsAvailable />);
    fireEvent.click(screen.getByLabelText("Ubah isi"));
    fireEvent.change(screen.getByLabelText("Isi teks"), { target: { value: "baris satu\nbaris dua" } });
    // The engine rejects newlines, so the field must not be able to produce one.
    expect((state().objects[0] as TextObject).text).not.toMatch(/[\r\n]/);
  });

  it("offers the built-in font plus every registered face", () => {
    state().add(text);
    render(<PropertiesBar fonts={fonts} fontsAvailable />);
    const select = screen.getByLabelText("Font") as HTMLSelectElement;
    expect([...select.options].map((option) => option.value)).toEqual(["", "arialmt"]);
    fireEvent.change(select, { target: { value: "arialmt" } });
    expect((state().objects[0] as TextObject).font).toBe("arialmt");
  });

  it("toggles a fill on and off", () => {
    state().add(box);
    render(<PropertiesBar fonts={fonts} fontsAvailable />);
    fireEvent.click(screen.getByLabelText("Warna isi"));
    fireEvent.click(screen.getByLabelText("Beri warna isi"));
    expect((state().objects[0] as BoxObject).fill).toBe("#ffe08a");
  });

  it("warns about a shape that would be invisible", () => {
    state().add({ ...box, strokeWidth: 0 });
    render(<PropertiesBar fonts={fonts} fontsAvailable />);
    fireEvent.click(screen.getByLabelText("Warna isi"));
    expect(screen.getByRole("alert")).toHaveTextContent("tidak akan terlihat");
  });

  it("sets a colour from a typed hex code", () => {
    state().add(box);
    render(<PropertiesBar fonts={fonts} fontsAvailable />);
    fireEvent.click(screen.getByLabelText("Warna garis"));
    const hex = screen.getByLabelText("Warna garis: kode hex");
    fireEvent.change(hex, { target: { value: "#2e7d32" } });
    expect((state().objects[0] as BoxObject).stroke).toBe("#2e7d32");
  });

  it("accepts a hex code without the leading hash", () => {
    state().add(box);
    render(<PropertiesBar fonts={fonts} fontsAvailable />);
    fireEvent.click(screen.getByLabelText("Warna garis"));
    fireEvent.change(screen.getByLabelText("Warna garis: kode hex"), { target: { value: "ab12cd" } });
    expect((state().objects[0] as BoxObject).stroke).toBe("#ab12cd");
  });

  it("ignores a half-typed hex instead of blanking the colour", () => {
    state().add(box);
    render(<PropertiesBar fonts={fonts} fontsAvailable />);
    fireEvent.click(screen.getByLabelText("Warna garis"));
    const hex = screen.getByLabelText("Warna garis: kode hex");
    fireEvent.focus(hex);
    fireEvent.change(hex, { target: { value: "#2e7" } });
    expect((state().objects[0] as BoxObject).stroke).toBe("#1565c0");
  });

  it("picks the text size from a dropdown of usable sizes", () => {
    state().add(text);
    render(<PropertiesBar fonts={fonts} fontsAvailable />);
    const select = screen.getByLabelText("Ukuran teks") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    fireEvent.change(select, { target: { value: "24" } });
    expect((state().objects[0] as TextObject).fontSize).toBe(24);
  });

  it("keeps the odd size a retyped run carries as its own option", () => {
    state().add({ ...text, fontSize: 11.4 });
    render(<PropertiesBar fonts={fonts} fontsAvailable />);
    const select = screen.getByLabelText("Ukuran teks") as HTMLSelectElement;
    expect([...select.options].map((option) => option.value)).toContain("11.4");
    expect(select.value).toBe("11.4");
  });

  it("says where fonts go when the registry is empty", () => {
    state().add(text);
    render(<PropertiesBar fonts={[]} fontsAvailable={false} />);
    expect(screen.getByLabelText("Font")).toHaveAttribute("title", expect.stringContaining("assets/fonts"));
  });

  it("toggles bold, italic, underline, and strikethrough", () => {
    state().add(text);
    render(<PropertiesBar fonts={fonts} fontsAvailable />);
    for (const [label, key] of [["Tebal", "bold"], ["Miring", "italic"], ["Garis bawah", "underline"], ["Coret", "strikethrough"]] as const) {
      fireEvent.click(screen.getByLabelText(label));
      expect(state().objects[0]).toHaveProperty(key, true);
    }
    fireEvent.click(screen.getByLabelText("Tebal"));
    expect(state().objects[0]).toHaveProperty("bold", false);
  });

  it("sets alignment from the toggle row rather than a dropdown", () => {
    state().add(text);
    render(<PropertiesBar fonts={fonts} fontsAvailable />);
    expect(screen.getByLabelText("Rata kiri")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByLabelText("Rata tengah"));
    expect((state().objects[0] as TextObject).align).toBe("center");
  });

  it("duplicates and reorders the selected object", () => {
    state().add(box);
    render(<PropertiesBar fonts={fonts} fontsAvailable />);
    fireEvent.click(screen.getByLabelText("Posisi"));
    fireEvent.click(screen.getByLabelText("Duplikat"));
    expect(state().objects).toHaveLength(2);
    fireEvent.click(screen.getByLabelText("Kirim ke belakang"));
    expect(state().objects[0].id).toBe(state().selectedId);
  });

  it("changes opacity through the slider", () => {
    state().add(box);
    render(<PropertiesBar fonts={fonts} fontsAvailable />);
    fireEvent.click(screen.getByLabelText("Tampilan"));
    fireEvent.change(screen.getByLabelText("Opacity"), { target: { value: "0.5" } });
    expect(state().objects[0].opacity).toBe(0.5);
  });
});

describe("PropertiesPanel sizing", () => {
  it("resizes a box after it was drawn", () => {
    state().add(box);
    render(<PropertiesBar fonts={fonts} fontsAvailable />);
    fireEvent.click(screen.getByLabelText("Ukuran"));
    fireEvent.change(screen.getByLabelText("Lebar"), { target: { value: "240" } });
    fireEvent.change(screen.getByLabelText("Tinggi"), { target: { value: "120" } });
    expect(state().objects[0]).toMatchObject({ width: 240, height: 120 });
  });

  it("does not offer sizing for a freehand path", () => {
    state().add({
      id: "p1", kind: "draw", page: 1, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }],
      stroke: "#000000", strokeWidth: 2, opacity: 1, rotation: 0,
    });
    render(<PropertiesBar fonts={fonts} fontsAvailable />);
    expect(screen.queryByLabelText("Ukuran")).toBeNull();
    expect(screen.getByLabelText("Tebal garis")).toBeVisible();
  });
});

describe("PropertiesPanel retype guidance", () => {
  it("does not warn about overflow for ordinary text objects", () => {
    state().add(text);
    render(<PropertiesBar fonts={fonts} fontsAvailable />);
    fireEvent.click(screen.getByLabelText("Ubah isi"));
    expect(screen.queryByText(/lebih panjang daripada teks asli/)).toBeNull();
  });

  it("keeps the cover width out of the wire format", async () => {
    const { toAnnotationDocument } = await import("./serialize");
    state().add({ ...text, coverWidth: 120 });
    const [page] = toAnnotationDocument(state().objects).pages;
    expect(page.texts?.[0]).not.toHaveProperty("coverWidth");
  });
});

describe("PropertiesBar popovers", () => {
  it("steps the text size through the sizes a document uses", () => {
    state().add({ ...text, fontSize: 16 });
    render(<PropertiesBar fonts={fonts} fontsAvailable />);
    fireEvent.click(screen.getByLabelText("Perbesar ukuran"));
    expect((state().objects[0] as TextObject).fontSize).toBe(18);
    fireEvent.click(screen.getByLabelText("Perkecil ukuran"));
    expect((state().objects[0] as TextObject).fontSize).toBe(16);
  });

  it("keeps a popover shut until it is asked for, and closes it on Escape", () => {
    state().add(box);
    render(<PropertiesBar fonts={fonts} fontsAvailable />);
    expect(screen.queryByLabelText("Warna garis: kode hex")).toBeNull();
    fireEvent.click(screen.getByLabelText("Warna garis"));
    expect(screen.getByLabelText("Warna garis: kode hex")).toBeVisible();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByLabelText("Warna garis: kode hex")).toBeNull();
  });

  it("keeps line thickness in the bar itself, not behind a popover", () => {
    state().add(box);
    render(<PropertiesBar fonts={fonts} fontsAvailable />);
    const thickness = screen.getByLabelText("Tebal garis");
    expect(thickness).toBeVisible();
    fireEvent.change(thickness, { target: { value: "6" } });
    expect((state().objects[0] as BoxObject).strokeWidth).toBe(6);
    fireEvent.click(screen.getByLabelText("Tebalkan garis"));
    expect((state().objects[0] as BoxObject).strokeWidth).toBe(8);
    fireEvent.click(screen.getByLabelText("Tipiskan garis"));
    expect((state().objects[0] as BoxObject).strokeWidth).toBe(6);
  });

  it("toggles an arrow head straight from the bar", () => {
    state().add({
      id: "p1", kind: "line", page: 1, points: [{ x: 0, y: 0 }, { x: 40, y: 40 }],
      stroke: "#000000", strokeWidth: 2, opacity: 1, rotation: 0,
    });
    render(<PropertiesBar fonts={fonts} fontsAvailable />);
    fireEvent.click(screen.getByLabelText("Mata panah di ujung"));
    expect(state().objects[0]).toHaveProperty("arrow", true);
  });

  it("closes a popover when the pointer goes elsewhere", () => {
    state().add(box);
    render(<PropertiesBar fonts={fonts} fontsAvailable />);
    fireEvent.click(screen.getByLabelText("Tampilan"));
    expect(screen.getByLabelText("Opacity")).toBeVisible();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByLabelText("Opacity")).toBeNull();
  });

  it("offers text controls only for text, and stroke controls only for shapes", () => {
    state().add(text);
    const view = render(<PropertiesBar fonts={fonts} fontsAvailable />);
    expect(screen.getByLabelText("Font")).toBeVisible();
    expect(screen.queryByLabelText("Warna garis")).toBeNull();

    state().reset();
    state().add(box);
    view.rerender(<PropertiesBar fonts={fonts} fontsAvailable />);
    expect(screen.queryByLabelText("Font")).toBeNull();
    expect(screen.getByLabelText("Warna garis")).toBeVisible();
  });

  it("keeps the editor's keyboard shortcuts out of its own controls", () => {
    state().add(text);
    render(<PropertiesBar fonts={fonts} fontsAvailable />);
    expect(screen.getByRole("toolbar")).toHaveAttribute("data-editor-chrome");
  });
});

describe("PropertiesBar text wrapping", () => {
  it("offers to wrap a single-line text, then to undo that", () => {
    state().add(text);
    const view = render(<PropertiesBar fonts={fonts} fontsAvailable />);
    fireEvent.click(screen.getByLabelText("Bungkus teks"));
    fireEvent.click(screen.getByText("Bungkus dalam kotak"));
    expect((state().objects[0] as TextObject).boxWidth).toBeGreaterThan(0);

    view.rerender(<PropertiesBar fonts={fonts} fontsAvailable />);
    fireEvent.click(screen.getByText("Kembalikan ke satu baris"));
    expect((state().objects[0] as TextObject).boxWidth).toBeUndefined();
  });

  it("sets the box width from the slider", () => {
    state().add({ ...text, boxWidth: 200 });
    render(<PropertiesBar fonts={fonts} fontsAvailable />);
    fireEvent.click(screen.getByLabelText("Bungkus teks"));
    fireEvent.change(screen.getByLabelText("Lebar kotak"), { target: { value: "320" } });
    expect((state().objects[0] as TextObject).boxWidth).toBe(320);
  });

  it("does not offer a box width for shapes", () => {
    state().add(box);
    render(<PropertiesBar fonts={fonts} fontsAvailable />);
    expect(screen.queryByLabelText("Bungkus teks")).toBeNull();
  });
});

describe("HistoryControls", () => {
  it("stays dead on a file nothing has happened to yet", () => {
    render(<HistoryControls />);
    expect(screen.getByLabelText("Urungkan")).toBeDisabled();
    expect(screen.getByLabelText("Ulangi")).toBeDisabled();
  });

  it("wakes up once there is something to undo, and redo after that", () => {
    const view = render(<HistoryControls />);
    state().add(box);
    view.rerender(<HistoryControls />);
    expect(screen.getByLabelText("Urungkan")).toBeEnabled();
    expect(screen.getByLabelText("Ulangi")).toBeDisabled();

    fireEvent.click(screen.getByLabelText("Urungkan"));
    view.rerender(<HistoryControls />);
    expect(state().objects).toHaveLength(0);
    expect(screen.getByLabelText("Ulangi")).toBeEnabled();

    fireEvent.click(screen.getByLabelText("Ulangi"));
    expect(state().objects).toHaveLength(1);
  });

  it("stays dead while the backend cannot annotate at all", () => {
    state().add(box);
    render(<HistoryControls disabled />);
    expect(screen.getByLabelText("Urungkan")).toBeDisabled();
  });
});

describe("PropertiesBar deletion", () => {
  it("deletes the selected object from the bar", () => {
    state().add(box);
    render(<PropertiesBar fonts={fonts} fontsAvailable />);
    fireEvent.click(screen.getByLabelText("Hapus objek terpilih"));
    expect(state().objects).toHaveLength(0);
  });

  it("has nothing to delete when nothing is selected", () => {
    render(<PropertiesBar fonts={fonts} fontsAvailable />);
    expect(screen.queryByLabelText("Hapus objek terpilih")).toBeNull();
  });
});

describe("PropertiesBar styling part of a line", () => {
  const line: TextObject = { ...text, text: "Nama Budi Santoso", x: 100, fontSize: 10 };

  afterEach(() => setTextLayout(null));

  function measurable() {
    setTextLayout((object) => ({ lines: [object.text], width: object.text.length }));
  }

  it("bolds only the selected word, leaving the rest of the line alone", () => {
    measurable();
    state().add(line);
    state().setTextRange({ id: line.id, start: 5, end: 9 });
    render(<PropertiesBar fonts={fonts} fontsAvailable />);
    fireEvent.click(screen.getByLabelText("Tebal"));

    const pieces = state().objects as TextObject[];
    expect(pieces.map((piece) => piece.text)).toEqual(["Nama ", "Budi", " Santoso"]);
    expect(pieces.map((piece) => Boolean(piece.bold))).toEqual([false, true, false]);
  });

  it("styles the whole object when nothing in it is selected", () => {
    measurable();
    state().add(line);
    render(<PropertiesBar fonts={fonts} fontsAvailable />);
    fireEvent.click(screen.getByLabelText("Tebal"));
    expect(state().objects).toHaveLength(1);
    expect(state().objects[0]).toHaveProperty("bold", true);
  });

  it("styles the whole object when the selection covers all of it", () => {
    measurable();
    state().add(line);
    state().setTextRange({ id: line.id, start: 0, end: line.text.length });
    render(<PropertiesBar fonts={fonts} fontsAvailable />);
    fireEvent.click(screen.getByLabelText("Miring"));
    expect(state().objects).toHaveLength(1);
  });

  it("changes size and colour on the selection too, not just emphasis", () => {
    measurable();
    state().add(line);
    state().setTextRange({ id: line.id, start: 0, end: 4 });
    render(<PropertiesBar fonts={fonts} fontsAvailable />);
    fireEvent.click(screen.getByLabelText("Perbesar ukuran"));
    const pieces = state().objects as TextObject[];
    expect(pieces).toHaveLength(2);
    expect(pieces[0].fontSize).toBe(11);
    expect(pieces[1].fontSize).toBe(10);
  });
});
