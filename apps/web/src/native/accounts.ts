// Accounts inside the Android app (PLAN.md §2.4). Each account is local (the Motus engine runs in the app with
// PGlite, data in this phone's storage) or a server account (signed in with a token; the app and photos stay local).
// The desktop app has its own implementation in Electron (apps/desktop), exposed the same way as window.motusNative.
import { reactive } from "vue";
import { readJson, writeJson } from "../core/prefs";
import { server, setTransport, httpTransport, type Transport, ApiError } from "../api/client";

export interface Account { id: string; kind: "local" | "server"; name: string; url?: string; token?: string }
const KEY = "motusAccounts";
export const accounts = reactive<{ list: Account[]; active: string | null }>(readJson(KEY, { list: [], active: null }));
const save = () => writeJson(KEY, accounts);
export const current = () => accounts.list.find((a) => a.id === accounts.active) ?? null;

let engine: any = null;
async function localTransport(acc: Account): Promise<Transport> {
  const [{ createEngine }, { pgliteDb }] = await Promise.all([import("@motus/engine"), import("@motus/engine/pglite")]);
  const db = await pgliteDb(`idb://motus-${acc.id}`);
  engine = await createEngine(db, { mode: "local" });
  const userId = await engine.ensureLocalUser(acc.name);
  const { invalidate } = await import("../api/live");
  engine.onChange((_u: string, topics: string[]) => invalidate(topics));
  return {
    async request(method, path, body) {
      // photos added to a local account are kept as data inside it
      if (path === "/media" && body instanceof Blob) {
        const url = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(body); });
        return { id: url, url };
      }
      if (path.startsWith("/auth/status")) return { setupNeeded: false, registration: "closed", user: { id: userId, username: "me", role: "admin" }, version: (import.meta as any).env?.VITE_VERSION ?? "", apiLevel: 1 };
      if (path.startsWith("/update-check") || path.startsWith("/version")) return (globalThis as any).motusNative?.update?.check?.() ?? { newer: false };
      if (path.startsWith("/auth/")) return { ok: true };
      const [p, qs] = path.split("?");
      const r = await engine.handle({ method, path: p, query: Object.fromEntries(new URLSearchParams(qs ?? "")), body, userId });
      if (r.status !== 200) throw new ApiError(r.status, r.body?.error ?? "Something went wrong");
      return r.body;
    },
  };
}

/** Points the app at the open account. Returns false when there is none (the chooser shows). */
export async function connect(): Promise<boolean> {
  const acc = current();
  if (!acc) return false;
  if (acc.kind === "local") setTransport(await localTransport(acc));
  else { server.value = { base: acc.url!, token: acc.token ?? null }; setTransport(httpTransport); }
  return true;
}

export async function addLocal(name: string) {
  const acc: Account = { id: crypto.randomUUID(), kind: "local", name: name || "Me" };
  accounts.list.push(acc); accounts.active = acc.id; save();
  location.reload();
}
export async function addServer(url: string, username: string, password: string, name?: string) {
  const base = new URL(/^https?:\/\//.test(url) ? url : `https://${url}`).origin;
  const r = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password, wantToken: true, deviceName: "Android app", platform: "android" }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.token) throw new Error(j.error ?? "Could not sign in");
  const acc: Account = { id: crypto.randomUUID(), kind: "server", name: name || username, url: base, token: j.token };
  accounts.list.push(acc); accounts.active = acc.id; save();
  location.reload();
}
export function open(id: string) { accounts.active = id; save(); location.reload(); }
export function remove(id: string) {
  const acc = accounts.list.find((a) => a.id === id);
  accounts.list = accounts.list.filter((a) => a.id !== id);
  if (accounts.active === id) accounts.active = null;
  save();
  if (acc?.kind === "local") indexedDB.deleteDatabase(`/pglite/motus-${id}`);
  location.reload();
}
export const chooser = () => { accounts.active = null; save(); location.reload(); };
