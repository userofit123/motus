// Offline use for server accounts: the app works on a copy of your data in this device's own database (PGlite,
// the same engine the server runs), so everything keeps working without a connection or while the server is down.
// Every change is saved here first and sent to the server when it can be reached; changes made on your other
// devices come back the same way. The newest change to a row wins (packages/engine/src/sync).
import { reactive } from "vue";
import { ApiError, httpTransport, server, setTransport, type Transport } from "./client";
import { invalidate, setRemoteHandler } from "./live";

export const sync = reactive({ on: false, online: true, syncing: false, waiting: 0, lastAt: 0, error: "" });

// what only the server can do: signing in, the admin pages, files, and sync itself
const SERVER_ONLY = /^\/(auth|admin|media|upload|share|version|update-check|events|sync)(\/|\?|$)/;
const PAGE_WAIT = 30_000;

let eng: any = null, R: any = null, db: any = null, userId = "", name = "";
let running = false, again = false, timer: ReturnType<typeof setTimeout> | null = null;

const hash = (s: string) => { let h = 5381; for (const c of s) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0; return h.toString(36); };
const http = <T = any>(method: string, path: string, body?: unknown) => httpTransport.request(method, path, body) as Promise<T>;

const transport: Transport = {
  async request(method, path, body) {
    if (SERVER_ONLY.test(path) || body instanceof Blob) return httpTransport.request(method, path, body);
    // your name lives with your sign-in on the server; the copy here follows it
    if (method === "PUT" && path === "/me") {
      const r = await httpTransport.request(method, path, body);
      await eng.handle({ method, path, body, userId }).catch(() => {});
      return r;
    }
    const [p, qs] = path.split("?");
    const r = await eng.handle({ method, path: p, query: Object.fromEntries(new URLSearchParams(qs ?? "")), body, userId });
    if (r.status === 404 && r.body?.error === "Not found") return httpTransport.request(method, path, body); // not one of the engine's
    if (r.status !== 200) throw new ApiError(r.status, r.body?.error ?? "Something went wrong");
    return r.body;
  },
};

/** One database per server and person. False when this browser can't (or another tab already has it open). */
export async function startReplica(user: { id: string }): Promise<boolean> {
  if (sync.on) { if (user.id === userId) return true; location.reload(); return false; } // signed in again (or as someone else)
  if (!globalThis.indexedDB || !globalThis.WebAssembly || !navigator.locks) return false;
  name = `motus-r-${hash(server.value.base || location.origin)}-${user.id}`;
  // PGlite can't share its database between tabs: the first tab works offline, others talk to the server directly
  const mine = await new Promise<boolean>((ok) => {
    navigator.locks.request(name, { ifAvailable: true }, (lock) => { ok(!!lock); return lock ? new Promise(() => {}) : undefined; });
  });
  if (!mine) return false;
  try {
    const [{ createEngine, replica }, { pgliteDb }] = await Promise.all([import("@motus/engine"), import("@motus/engine/pglite")]);
    R = replica;
    db = await pgliteDb(`idb://${name}`);
    eng = await createEngine(db, { mode: "local", seed: false });
    userId = user.id;
    if (!(await R.replicaMeta(db)).ready) {
      // the first copy needs the server once
      const cat = await http("GET", "/sync/catalog");
      await R.loadCatalog(db, cat.stamp, cat.rows);
      await R.loadSnapshot(db, await http("GET", "/sync/snapshot"));
    }
  } catch {
    await db?.close().catch(() => {}); db = null; eng = null;
    return false;
  }
  eng.onChange((_u: string, topics: string[]) => { invalidate(topics); schedule(); });
  setTransport(transport);
  setRemoteHandler(() => schedule(0));
  sync.on = true;
  addEventListener("online", () => schedule(0));
  addEventListener("offline", () => { sync.online = false; });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") schedule(0); });
  setInterval(() => schedule(0), PAGE_WAIT);
  sync.waiting = await R.waitingCount(db);
  schedule(0);
  return true;
}

export function schedule(ms = 400) {
  if (!sync.on) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(run, ms);
}

/** Send what changed here, then fetch what changed elsewhere. */
async function run() {
  if (running) { again = true; return; }
  running = true; sync.syncing = true;
  let changed = false;
  try {
    const meta = await R.replicaMeta(db);
    for (;;) {
      const out = await R.localChanges(db);
      if (!out.changes.length) break;
      const res = await http("POST", "/sync/push", { device: meta.device, changes: out.changes });
      await R.markSent(db, out.upTo);
      if (res.rejected.length) { await R.applyRemote(db, userId, res.rejected); changed = true; }
    }
    const retry: any[] = [];
    for (;;) {
      const m = await R.replicaMeta(db);
      const p = await http("GET", `/sync/pull?since=${m.cursor}&device=${encodeURIComponent(m.device)}`);
      if (p.catalog !== m.catalog) { const cat = await http("GET", "/sync/catalog"); await R.loadCatalog(db, cat.stamp, cat.rows); changed = true; }
      const r = await R.applyRemote(db, userId, p.changes, p.cursor);
      if (p.changes.length) changed = true;
      retry.push(...r.failed.map((f: any) => f.change));
      if (!p.more) break;
    }
    // a row that arrived before the row it belongs to (they came in different pages)
    if (retry.length) await R.applyRemote(db, userId, retry);
    Object.assign(sync, { online: true, error: "", lastAt: Date.now() });
  } catch (e) {
    if (e instanceof ApiError && e.status === 0) sync.online = false;
    else sync.error = (e as Error).message;
  } finally {
    sync.waiting = await R.waitingCount(db).catch(() => sync.waiting);
    running = false; sync.syncing = false;
    if (changed) invalidate(["*"]);
    if (again) { again = false; schedule(0); }
  }
}

/** Signing out: the copy on this device goes too (another person may use it next). */
export async function eraseReplica() {
  if (!sync.on) return;
  sync.on = false;
  await db?.close().catch(() => {});
  indexedDB.deleteDatabase(`/pglite/${name}`);
}
