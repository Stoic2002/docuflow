import { afterEach, describe, expect, it } from "vitest";
import { fromEditorChrome } from "./keyboard";

function keyOn(element: Element): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: "a", bubbles: true });
  Object.defineProperty(event, "target", { value: element });
  return event;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("fromEditorChrome", () => {
  it("claims keys typed into a form control", () => {
    document.body.innerHTML = `<input id="field" /><textarea id="area"></textarea><select id="pick"></select>`;
    for (const id of ["field", "area", "pick"]) {
      expect(fromEditorChrome(keyOn(document.getElementById(id)!))).toBe(true);
    }
  });

  it("claims keys aimed at anything inside the editor's own chrome", () => {
    // Focus a toolbar button, press space, and the page used to pan under it.
    document.body.innerHTML = `<div data-editor-chrome><span><button id="tool">B</button></span></div>`;
    expect(fromEditorChrome(keyOn(document.getElementById("tool")!))).toBe(true);
  });

  it("leaves keys aimed at the page alone", () => {
    document.body.innerHTML = `<div id="canvas" role="application"></div>`;
    expect(fromEditorChrome(keyOn(document.getElementById("canvas")!))).toBe(false);
  });
});
