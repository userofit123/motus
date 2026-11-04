// Notifications for planned workouts (a routine's schedule with "Remind me"): on the Android app they are scheduled on
// the phone for the next two weeks each time Motus opens, so they arrive even when the app is closed.
import { api } from "../api/client";
import { localYmd } from "../core/format";

const P = (n: string) => (globalThis as any).Capacitor?.Plugins?.[n];
const BASE = 8000; // notification ids 8000-8999 belong to planned workouts

export async function schedulePlanned(enabled: boolean) {
  const ln = P("LocalNotifications");
  if (!ln) return;
  try {
    const pending = await ln.getPending();
    const ours = (pending.notifications ?? []).filter((n: any) => n.id >= BASE && n.id < BASE + 1000);
    if (ours.length) await ln.cancel({ notifications: ours.map((n: any) => ({ id: n.id })) });
    if (!enabled) return;
    const from = localYmd(new Date()), to = localYmd(new Date(Date.now() + 14 * 86400000));
    const cal = await api.get("/calendar", { from, to });
    const list = (cal.planned ?? []).filter((p: any) => p.timeOfDay && p.remindMin != null).map((p: any, i: number) => {
      const at = new Date(`${p.date}T${p.timeOfDay}:00`); at.setMinutes(at.getMinutes() - p.remindMin);
      return { id: BASE + i, title: p.name, body: p.remindMin ? `In ${p.remindMin} minutes` : "Time for your workout", schedule: { at, allowWhileIdle: true }, extra: { routineId: p.routineId } };
    }).filter((n: any) => n.schedule.at.getTime() > Date.now()).slice(0, 60);
    if (list.length) await ln.schedule({ notifications: list });
  } catch { /* notifications not allowed */ }
}
