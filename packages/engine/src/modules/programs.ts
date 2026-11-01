// Programs (optional feature): weeks of routines followed in order. Where you are is worked out from the workouts you
// finished since the program started, so skipping the app for a week or logging out of order never breaks it.
import type { Router } from "../router";
import type { Sql } from "../db";
import { camel, id, str, intOrNull, bool, dateStr, visible } from "../util";
import { uuidv7 } from "../ids";
import { notFound, bad } from "../errors";

interface Week { days: string[]; deload?: boolean }

export async function programState(q: Sql, p: any) {
  const weeks: Week[] = p.weeks ?? [];
  const seq = weeks.flatMap((w, wi) => w.days.map((r, di) => ({ routineId: r, week: wi + 1, day: di + 1, deload: !!w.deload })));
  if (!seq.length) return { next: null, done: 0, total: 0 };
  const done = (await q.query(
    "SELECT routine_id FROM workouts WHERE status = 'completed' AND started_at >= $1::date AND (program_id = $2 OR routine_id = ANY($3::uuid[])) ORDER BY started_at",
    [p.start_date ?? p.startDate, p.id, [...new Set(seq.map((s) => s.routineId))]])).rows;
  let i = 0;
  for (const w of done) { if (i < seq.length && w.routine_id === seq[i]!.routineId) i++; }
  const names = new Map((await q.query("SELECT id, name, color FROM routines WHERE id = ANY($1::uuid[])", [seq.map((s) => s.routineId)])).rows.map((r: any) => [r.id, r]));
  const next = i < seq.length ? { ...seq[i]!, name: names.get(seq[i]!.routineId)?.name ?? "Routine", color: names.get(seq[i]!.routineId)?.color ?? null } : null;
  return { next, done: i, total: seq.length, finished: i >= seq.length };
}

export function programRoutes(r: Router) {
  r.get("/programs", async ({ q }) => {
    const rows = (await q.query("SELECT * FROM programs ORDER BY active DESC, created_at DESC")).rows;
    const out = [];
    for (const p of rows) { const c = camel<any>(p); delete c.userId; out.push({ ...c, state: await programState(q, p) }); }
    return out;
  });
  r.post("/programs", async (ctx, _p, b) => {
    const weeks = sanitize(b.weeks);
    for (const w of weeks) for (const rid of w.days) await visible(ctx.q, "routines", rid, "routine");
    const pid = uuidv7();
    await ctx.q.query("INSERT INTO programs (id, user_id, name, description, weeks, deload_pct, start_date, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [pid, ctx.userId, str(b.name, 120).trim() || "Program", str(b.description, 2000), JSON.stringify(weeks), intOrNull(b.deloadPct, 0, 90) ?? 40, dateStr(b.startDate) ?? new Date().toISOString().slice(0, 10), bool(b.active, true)]);
    ctx.changed("routine");
    return { id: pid };
  });
  r.put("/programs/:id", async (ctx, p, b) => {
    const weeks = b.weeks ? sanitize(b.weeks) : null;
    if (weeks) for (const w of weeks) for (const rid of w.days) await visible(ctx.q, "routines", rid, "routine");
    const { rows } = await ctx.q.query(
      `UPDATE programs SET name = coalesce($2, name), description = coalesce($3, description), weeks = coalesce($4, weeks), deload_pct = coalesce($5, deload_pct),
         start_date = coalesce($6, start_date), active = coalesce($7, active) WHERE id = $1 RETURNING id`,
      [id(p.id), b.name ? str(b.name, 120) : null, b.description != null ? str(b.description, 2000) : null, weeks ? JSON.stringify(weeks) : null, intOrNull(b.deloadPct, 0, 90), dateStr(b.startDate), typeof b.active === "boolean" ? b.active : null]);
    if (!rows.length) throw notFound("Program not found");
    ctx.changed("routine");
    return { ok: true };
  });
  r.del("/programs/:id", async (ctx, p) => {
    await ctx.q.query("DELETE FROM programs WHERE id = $1", [id(p.id)]);
    ctx.changed("routine");
    return { ok: true };
  });
}

function sanitize(v: unknown): Week[] {
  if (!Array.isArray(v)) throw bad("Expected weeks");
  return v.slice(0, 52).map((w: any) => ({ days: (Array.isArray(w?.days) ? w.days : []).slice(0, 14).map((x: unknown) => id(x, "routine")), deload: !!w?.deload }));
}
