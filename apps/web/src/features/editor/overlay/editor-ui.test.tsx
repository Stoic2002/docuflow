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

describe("EditorToolbar", () => {
  it("marks the active tool and switches on click", () => {
    render(<EditorToolbar onPickImage={vi.fn()} disabled={false} />);
    expect(screen.getByLabelText("Pilih & geser")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByLabelText("Kotak"));
    expect(state().tool).toBe("rectangle");
    expect(screen.getByLabelText("Kotak")).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps undo, redo, and delete disabled until they can do something", () => {
    render(<EditorToolbar onPickImage={vi.fn()} disabled={false} />);
    expect(screen.getByLabelText("Urungkan")).toBeDisabled();
    expect(screen.getByLabelText("Ulangi")).toBeDisabled();
    expect(screen.getByLabelText("Hapus objek terpilih")).toBeDisabled();
  });

  it("enables undo and delete once an object exists and is selected", () => {
    const view = render(<EditorToolbar onPickImage={vi.fn()} disabled={false} />);
    state().add(box);
    view.rerender(<EditorToolbar onPickImage={vi.fn()} disabled={false} />);
    expect(screen.getByLabelText("Urungkan")).toBeEnabled();
    expect(screen.getByLabelText("Hapus objek terpilih")).toBeEnabled();
    fireEvent.click(screen.getByLabelText("Hapus objek terpilih"));
    expect(state().objects).toHaveLength(0);
  });

  it("disables every control when the capability is unavailable", () => {
    render(<EditorToolbar onPickImage={vi.fn()} disabled />);
    expect(screen.getByLabelText("Teks")).toBeDisabled();
    expect(screen.getByLabelText("Sisipkan JPG")).toBeDisabled();
  });
});

describe("PropertiesPanel", () => {
  it("explains what to do when nothing is selected", () => {
    render(<PropertiesPanel fonts={fonts} fontsAvailable />);
    expect(screen.getByText(/Pilih objek di kanvas/)).toBeVisible();
  });

  it("edits the selected text and strips line breaks", () => {
    state().add(text);
    render(<PropertiesPanel fonts={fonts} fontsAvailable />);
    fireEvent.change(screen.getByLabelText("Isi teks"), { target: { value: "baris satu\nbaris dua" } });
    expect((state().objects[0] as TextObject).text).toBe("baris satu baris dua");
  });

  it("offers the built-in font plus every registered face", () => {
    state().add(text);
    render(<PropertiesPanel fonts={fonts} fontsAvailable />);
    const select = screen.getByLabelText("Font") as HTMLSelectElement;
    expect([...select.options].map((option) => option.value)).toEqual(["", "arialmt"]);
    fireEvent.change(select, { target: { value: "arialmt" } });
    expect((state().objects[0] as TextObject).font).toBe("arialmt");
  });

  it("warns when the server has no fonts installed", () => {
    state().add(text);
    render(<PropertiesPanel fonts={[]} fontsAvailable={false} />);
    expect(screen.getByText(/hanya Helvetica bawaan/)).toBeVisible();
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

  it("changes opacity through the slider", () => {
    state().add(box);
    render(<PropertiesPanel fonts={fonts} fontsAvailable />);
    fireEvent.change(screen.getByLabelText("Opacity"), { target: { value: "0.5" } });
    expect(state().objects[0].opacity).toBe(0.5);
  });
});
