import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PropertiesPanel } from "./properties-panel";
import { useOverlayStore } from "./store";
import { EditorToolbar } from "./toolbar";
import type { BoxObject, TextObject } from "./types";

const fonts = [{ id: "arialmt", family: "ArialMT", serif: false, fixed: false }];
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

  it("keeps undo, redo, and delete disabled until they can do something", () => {
    render(toolbar());
    expect(screen.getByLabelText("Urungkan")).toBeDisabled();
    expect(screen.getByLabelText("Ulangi")).toBeDisabled();
    expect(screen.getByLabelText("Hapus objek terpilih")).toBeDisabled();
  });

  it("enables undo and delete once an object exists and is selected", () => {
    const view = render(toolbar());
    state().add(box);
    view.rerender(toolbar());
    expect(screen.getByLabelText("Urungkan")).toBeEnabled();
    expect(screen.getByLabelText("Hapus objek terpilih")).toBeEnabled();
    fireEvent.click(screen.getByLabelText("Hapus objek terpilih"));
    expect(state().objects).toHaveLength(0);
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

describe("PropertiesPanel", () => {
  it("tells the user what to click when nothing is selected", () => {
    render(<PropertiesPanel fonts={fonts} fontsAvailable />);
    expect(screen.getByText(/Klik teks atau garis di halaman/)).toBeVisible();
  });

  it("never lets a line break into the stored text", () => {
    state().add(text);
    render(<PropertiesPanel fonts={fonts} fontsAvailable />);
    fireEvent.change(screen.getByLabelText("Isi teks"), { target: { value: "baris satu\nbaris dua" } });
    // The engine rejects newlines, so the field must not be able to produce one.
    expect((state().objects[0] as TextObject).text).not.toMatch(/[\r\n]/);
  });

  it("offers the built-in font plus every registered face", () => {
    state().add(text);
    render(<PropertiesPanel fonts={fonts} fontsAvailable />);
    const select = screen.getByLabelText("Font") as HTMLSelectElement;
    expect([...select.options].map((option) => option.value)).toEqual(["", "arialmt"]);
    fireEvent.change(select, { target: { value: "arialmt" } });
    expect((state().objects[0] as TextObject).font).toBe("arialmt");
  });

  it("toggles a fill on and off", () => {
    state().add(box);
    render(<PropertiesPanel fonts={fonts} fontsAvailable />);
    fireEvent.click(screen.getByLabelText("Beri warna isi"));
    expect((state().objects[0] as BoxObject).fill).toBe("#ffe08a");
  });

  it("warns about a shape that would be invisible", () => {
    state().add({ ...box, strokeWidth: 0 });
    render(<PropertiesPanel fonts={fonts} fontsAvailable />);
    expect(screen.getByRole("alert")).toHaveTextContent("tidak akan terlihat");
  });

  it("sets a colour from a typed hex code", () => {
    state().add(box);
    render(<PropertiesPanel fonts={fonts} fontsAvailable />);
    const hex = screen.getByLabelText("Warna garis: kode hex");
    fireEvent.change(hex, { target: { value: "#2e7d32" } });
    expect((state().objects[0] as BoxObject).stroke).toBe("#2e7d32");
  });

  it("accepts a hex code without the leading hash", () => {
    state().add(box);
    render(<PropertiesPanel fonts={fonts} fontsAvailable />);
    fireEvent.change(screen.getByLabelText("Warna garis: kode hex"), { target: { value: "ab12cd" } });
    expect((state().objects[0] as BoxObject).stroke).toBe("#ab12cd");
  });

  it("ignores a half-typed hex instead of blanking the colour", () => {
    state().add(box);
    render(<PropertiesPanel fonts={fonts} fontsAvailable />);
    const hex = screen.getByLabelText("Warna garis: kode hex");
    fireEvent.focus(hex);
    fireEvent.change(hex, { target: { value: "#2e7" } });
    expect((state().objects[0] as BoxObject).stroke).toBe("#1565c0");
  });

  it("picks the text size from a dropdown of usable sizes", () => {
    state().add(text);
    render(<PropertiesPanel fonts={fonts} fontsAvailable />);
    const select = screen.getByLabelText("Ukuran teks") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    fireEvent.change(select, { target: { value: "24" } });
    expect((state().objects[0] as TextObject).fontSize).toBe(24);
  });

  it("keeps the odd size a retyped run carries as its own option", () => {
    state().add({ ...text, fontSize: 11.4 });
    render(<PropertiesPanel fonts={fonts} fontsAvailable />);
    const select = screen.getByLabelText("Ukuran teks") as HTMLSelectElement;
    expect([...select.options].map((option) => option.value)).toContain("11.4");
    expect(select.value).toBe("11.4");
  });

  it("says where fonts go when the registry is empty", () => {
    state().add(text);
    render(<PropertiesPanel fonts={[]} fontsAvailable={false} />);
    expect(screen.getByText(/assets\/fonts\//)).toBeVisible();
  });

  it("toggles bold, italic, underline, and strikethrough", () => {
    state().add(text);
    render(<PropertiesPanel fonts={fonts} fontsAvailable />);
    for (const [label, key] of [["Tebal", "bold"], ["Miring", "italic"], ["Garis bawah", "underline"], ["Coret", "strikethrough"]] as const) {
      fireEvent.click(screen.getByLabelText(label));
      expect(state().objects[0]).toHaveProperty(key, true);
    }
    fireEvent.click(screen.getByLabelText("Tebal"));
    expect(state().objects[0]).toHaveProperty("bold", false);
  });

  it("sets alignment from the toggle row rather than a dropdown", () => {
    state().add(text);
    render(<PropertiesPanel fonts={fonts} fontsAvailable />);
    expect(screen.getByLabelText("Rata kiri")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByLabelText("Rata tengah"));
    expect((state().objects[0] as TextObject).align).toBe("center");
  });

  it("duplicates and reorders the selected object", () => {
    state().add(box);
    render(<PropertiesPanel fonts={fonts} fontsAvailable />);
    fireEvent.click(screen.getByLabelText("Duplikat"));
    expect(state().objects).toHaveLength(2);
    fireEvent.click(screen.getByLabelText("Kirim ke belakang"));
    expect(state().objects[0].id).toBe(state().selectedId);
  });

  it("changes opacity through the slider", () => {
    state().add(box);
    render(<PropertiesPanel fonts={fonts} fontsAvailable />);
    fireEvent.change(screen.getByLabelText("Opacity"), { target: { value: "0.5" } });
    expect(state().objects[0].opacity).toBe(0.5);
  });
});

describe("PropertiesPanel sizing", () => {
  it("resizes a box after it was drawn", () => {
    state().add(box);
    render(<PropertiesPanel fonts={fonts} fontsAvailable />);
    fireEvent.change(screen.getByLabelText("Lebar"), { target: { value: "240" } });
    fireEvent.change(screen.getByLabelText("Tinggi"), { target: { value: "120" } });
    expect(state().objects[0]).toMatchObject({ width: 240, height: 120 });
  });

  it("does not offer sizing for a freehand path", () => {
    state().add({
      id: "p1", kind: "draw", page: 1, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }],
      stroke: "#000000", strokeWidth: 2, opacity: 1, rotation: 0,
    });
    render(<PropertiesPanel fonts={fonts} fontsAvailable />);
    expect(screen.queryByLabelText("Lebar")).toBeNull();
    expect(screen.getByLabelText("Tebal garis")).toBeVisible();
  });
});

describe("PropertiesPanel retype guidance", () => {
  it("does not warn about overflow for ordinary text objects", () => {
    state().add(text);
    render(<PropertiesPanel fonts={fonts} fontsAvailable />);
    expect(screen.queryByText(/lebih panjang daripada teks asli/)).toBeNull();
  });

  it("keeps the cover width out of the wire format", async () => {
    const { toAnnotationDocument } = await import("./serialize");
    state().add({ ...text, coverWidth: 120 });
    const [page] = toAnnotationDocument(state().objects).pages;
    expect(page.texts?.[0]).not.toHaveProperty("coverWidth");
  });
});
