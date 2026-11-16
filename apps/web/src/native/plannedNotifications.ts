// Notifications for planned workouts (a routine's schedule with "Remind me"): on the Android app they are scheduled on
// the phone for the next two weeks, so they arrive even when the app is closed. Scheduled again whenever the switch
// (Settings → Notifications → Planned workouts) or the planned days change, not only when Motus opens, so switching it
// off takes the coming ones off at once and a new or moved schedule reminds without restarting the app.
import { computed, watch } from "vue";
import { useCalendar, type CalendarPlanned } from "../api/queries";
import { localYmd } from "../core/format";

const P = (n: string) => (globalThis as any).Capacitor?.Plugins?.[n];
const BASE = 8000; // notification ids 8000-8999 belong to planned workouts

/** Only the Android app can schedule notifications for when it is closed. */
export const plannedSupported = () => !!P("LocalNotifications");

// one run after the other, so a quick off-then-on never leaves the older run's notifications behind
let queue: Promise<void> = Promise.resolve();
function schedulePlanned(enabled: boolean, planned: CalendarPlanned[] | undefined) {
  const ln = P("LocalNotifications");
  // switched on with the planned days not loaded yet (or not loading, offline): the ones scheduled stay until they are
  if (!ln || (enabled && !planned)) return;
  queue = queue.then(async () => {
    try {
      const pending = await ln.getPending();
      const ours = (pending.notifications ?? []).filter((n: { id: number }) => n.id >= BASE && n.id < BASE + 1000);
      if (ours.length) await ln.cancel({ notifications: ours.map((n: { id: number }) => ({ id: n.id })) });
      if (!enabled || !planned) return;
      const list = planned.filter((p) => typeof p.timeOfDay === "string" && typeof p.remindMin === "number").map((p, i) => {
        const remindMin = p.remindMin as number, at = new Date(`${p.date}T${p.timeOfDay as string}:00`);
        at.setMinutes(at.getMinutes() - remindMin);
        return { id: BASE + i, title: p.name, body: remindMin ? `In ${remindMin} minutes` : "Time for your workout", schedule: { at, allowWhileIdle: true }, extra: { routineId: p.routineId } };
      }).filter((n) => n.schedule.at.getTime() > Date.now()).slice(0, 60);
      if (list.length) await ln.schedule({ notifications: list });
    } catch { /* notifications not allowed: Settings → Notifications says so */ }
  });
}

/** Keeps the phone's planned workout notifications in step with `on` and the planned days (the calendar topic). Call
 *  once, from a component that stays mounted. */
/** on: the switch, or null while the account's settings haven't loaded (nothing is scheduled or taken off until they
 *  have: the defaults have it on, which would briefly schedule reminders for someone who switched them off). */
export function usePlannedReminders(on: () => boolean | null) {
  const supported = plannedSupported();
  const range = { from: localYmd(new Date()), to: localYmd(new Date(Date.now() + 14 * 86400000)) };
  const cal = useCalendar(range, computed(() => supported && on() === true));
  watch([on, () => cal.data.value], ([yes, d]) => { if (yes != null) schedulePlanned(yes, d?.planned); }, { immediate: true });
}
