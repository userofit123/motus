// Health Connect (Android): what other apps on the phone recorded (a band through Gadgetbridge, a scale, a watch) comes
// in here. The Android app reads Health Connect and sends one batch; the engine decides what to keep, so the rules hold
// for a local account and for a server account's copy on the phone alike.
// - Daily steps and sleep go into the daily log as source "health_connect". A value typed in by hand stays: the person's
//   own number wins over a device's (as for steps, PLAN.md decision M-155).
// - Weight goes into the body log once: a reading already logged at the same minute is the same reading.
// - Exercise sessions become activities keyed by their Health Connect id, so a second sync never adds them twice and an
//   activity edited in Motus keeps the edits.
import type { Router } from "../router";
import { dateStr, isoTime, numOrNull, intOrNull, str } from "../util";
import { uuidv7 } from "../ids";
import { ensureTypes, saveActivity } from "./activities";

export const HEALTH_SOURCE = "health_connect";

export function healthRoutes(r: Router) {
  r.post("/health/import", async (ctx, _p, b) => {
    const list = (v: unknown, max: number): any[] => (Array.isArray(v) ? v.slice(0, max) : []);
    const out = { steps: 0, sleep: 0, weight: 0, activities: 0 };

    // a typed value (source "manual", or null on rows from before sources) is never replaced
    const daily = async (date: unknown, kind: string, value: number | null) => {
      const d = dateStr(date);
      if (!d || value == null) return false;
      const { rows } = await ctx.q.query(
        `INSERT INTO daily_logs (user_id, date, kind, value, source) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (user_id, date, kind) DO UPDATE SET value = $4, source = $5
         WHERE daily_logs.source = $5 AND daily_logs.value <> $4 RETURNING 1`, [ctx.userId, d, kind, value, HEALTH_SOURCE]);
      return rows.length > 0;
    };
    for (const e of list(b.steps, 400)) if (await daily(e?.date, "steps", intOrNull(e?.value, 0, 1e6))) out.steps++;
    for (const e of list(b.sleep, 400)) {
      const h = numOrNull(e?.hours, 0, 24);
      if (await daily(e?.date, "sleep_h", h == null ? null : Math.round(h * 10) / 10)) out.sleep++;
    }

    for (const e of list(b.weight, 1000)) {
      const kg = numOrNull(e?.kg, 1, 700);
      if (kg == null || !e?.at) continue;
      const at = isoTime(e.at);
      const same = await ctx.q.query("SELECT 1 FROM body_metrics WHERE kind = 'weight' AND measured_at BETWEEN $1::timestamptz - interval '1 minute' AND $1::timestamptz + interval '1 minute'", [at]);
      if (same.rows.length) continue;
      await ctx.q.query("INSERT INTO body_metrics (id, user_id, kind, value, measured_at) VALUES ($1,$2,'weight',$3,$4)", [uuidv7(), ctx.userId, Math.round(kg * 100) / 100, at]);
      out.weight++;
    }

    const sessions = list(b.sessions, 500).filter((s) => s?.id && s?.start && s?.end);
    if (sessions.length) await ensureTypes(ctx);
    for (const s of sessions) {
      const clientId = `hc:${str(s.id, 70)}`;
      if ((await ctx.q.query("SELECT 1 FROM activities WHERE client_id = $1", [clientId])).rows.length) continue;
      const type = str(s.type, 40) || "other";
      const known = (await ctx.q.query("SELECT 1 FROM activity_types WHERE slug = $1", [type])).rows.length > 0;
      await saveActivity(ctx, {
        type: known ? type : "other", name: str(s.title, 120), startedAt: s.start, endedAt: s.end,
        distanceM: s.distanceM, steps: s.steps, avgHr: s.avgHr, calories: s.calories, source: HEALTH_SOURCE, clientId,
      });
      out.activities++;
    }

    if (out.steps || out.sleep || out.activities) ctx.changed("activity");
    if (out.weight) ctx.changed("body");
    return out;
  });
}
