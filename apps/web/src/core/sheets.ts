// Each open sheet adds a step to the browser history, so Back (the phone's button or gesture) closes the sheet instead of leaving the page.
const stack: { id: number; close: () => void }[] = [];
let n = 0, skip = 0;
export const sheetIsOpen = () => stack.length > 0;

export function sheetOpened(close: () => void) {
  const id = ++n;
  stack.push({ id, close });
  // keep the router's own state, so the router sees the same page when this step is taken back
  history.pushState({ ...history.state, motusSheet: id }, "");
  return id;
}
/** Closed by its own button or the page: take back the step it added, if nothing was added after it. */
export function sheetClosed(id: number) {
  const i = stack.findIndex((e) => e.id === id);
  if (i < 0) return; // already closed by Back
  stack.splice(i, 1);
  // wait a moment: a sheet often closes because one of its buttons went to another page, and that page's step must not be undone
  setTimeout(() => { if (!navigating && history.state?.motusSheet === id) { skip++; history.back(); } }, 0);
}
let navigating = false;
export function watchRouter(r: { beforeEach: (f: () => void) => void; afterEach: (f: () => void) => void }) {
  r.beforeEach(() => { navigating = true; });
  r.afterEach(() => { navigating = false; });
}
addEventListener("popstate", () => {
  if (skip) { skip--; return; }
  stack.pop()?.close();
});
