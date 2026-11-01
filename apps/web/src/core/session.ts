// Who is signed in, and how this app reaches its data.
import { reactive } from "vue";
import { api, setOnUnauthorized, ApiError, server, usingHttp } from "../api/client";
import { queryClient } from "../api/live";
import { readJson, writeJson } from "./prefs";
import { startReplica, eraseReplica, sync } from "../api/replica";
import { confirm } from "./ask";

export const session = reactive<{ ready: boolean; setupNeeded: boolean; user: { id: string; username: string; role: string } | null; registration: string; version: string; apiLevel: number }>(
  { ready: false, setupNeeded: false, user: null, registration: "invite", version: "", apiLevel: 0 });

// the last answer from the server, so the app can open without a connection
const KEY = () => "motusSession:" + (server.value.base || location.origin);

export async function loadSession() {
  let s: any = null;
  try { s = await api.get("/auth/status"); writeJson(KEY(), s.user ? s : null); }
  catch (e) { if (e instanceof ApiError && e.status === 0) s = readJson(KEY(), null); }
  if (s) Object.assign(session, { setupNeeded: s.setupNeeded, user: s.user, registration: s.registration, version: s.version, apiLevel: s.apiLevel });
  else session.user = null;
  // a server account works on a copy on this device (offline use); local accounts already are one
  if (session.user && usingHttp() && !(await isLocalDesktopAccount())) await startReplica(session.user);
  session.ready = true;
}
async function isLocalDesktopAccount() {
  try { return (await (globalThis as any).motusNative?.accounts?.current?.())?.kind === "local"; } catch { return false; }
}

export async function signOut() {
  if (sync.on && sync.waiting && !(await confirm(`${sync.waiting} change${sync.waiting === 1 ? " hasn't" : "s haven't"} reached the server yet`,
    { text: "Signing out removes them from this device. Stay signed in and they're sent when the server can be reached.", ok: "Sign out anyway", danger: true }))) return;
  try { await api.post("/auth/logout"); } catch { /* signed out anyway */ }
  await eraseReplica();
  writeJson(KEY(), null);
  session.user = null;
  queryClient.clear();
}
setOnUnauthorized(() => { if (session.user) { session.user = null; writeJson(KEY(), null); queryClient.clear(); } });
