// Who is signed in, and how this app reaches its data.
import { reactive } from "vue";
import { api, setOnUnauthorized } from "../api/client";
import { queryClient } from "../api/live";

export const session = reactive<{ ready: boolean; setupNeeded: boolean; user: { id: string; username: string; role: string } | null; registration: string; version: string; apiLevel: number }>(
  { ready: false, setupNeeded: false, user: null, registration: "invite", version: "", apiLevel: 0 });

export async function loadSession() {
  try {
    const s = await api.get("/auth/status");
    Object.assign(session, { setupNeeded: s.setupNeeded, user: s.user, registration: s.registration, version: s.version, apiLevel: s.apiLevel });
  } catch { session.user = null; }
  session.ready = true;
}
export async function signOut() {
  try { await api.post("/auth/logout"); } catch { /* signed out anyway */ }
  session.user = null;
  queryClient.clear();
}
setOnUnauthorized(() => { if (session.user) { session.user = null; queryClient.clear(); } });
