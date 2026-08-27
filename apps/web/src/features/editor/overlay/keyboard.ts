/**
 * Keys typed into the editor's own controls belong to those controls. The
 * canvas listens on the window so a selected object can be typed into without
 * a second click, which means every toolbar button would otherwise feed the
 * page: focus a rail button, press space, and the page panned.
 */
export function fromEditorChrome(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return true;
  return typeof target.closest === "function" && target.closest("[data-editor-chrome]") !== null;
}
