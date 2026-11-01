// Short messages at the bottom: "Saved · Undo", records, goals reached. Only results, never chatter (PLAN.md §10.0).
import { reactive } from "vue";

export interface Toast { id: number; text: string; kind: "ok" | "err" | "pr"; action?: { label: string; run: () => void } }
export const toasts = reactive<Toast[]>([]);
let n = 0;
export function toast(text: string, o: { kind?: Toast["kind"]; action?: Toast["action"]; ms?: number } = {}) {
  const t: Toast = { id: ++n, text, kind: o.kind ?? "ok", action: o.action };
  toasts.push(t);
  if (toasts.length > 3) toasts.shift();
  setTimeout(() => { const i = toasts.findIndex((x) => x.id === t.id); if (i >= 0) toasts.splice(i, 1); }, o.ms ?? (o.action ? 6000 : 3200));
}
export const toastError = (e: unknown) => toast(e instanceof Error ? e.message : String(e), { kind: "err" });
