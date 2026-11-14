// Reading and writing synced rows, the same way on the server and on a device.
// Rows travel as JSON made by to_jsonb and are written back with jsonb_populate_record, so every column type round-trips.
import { cleanProgression } from "@motus/shared";
import type { Sql } from "../db";
import { isUuid } from "../ids";
import { SYNCED, SYNCED_BY_NAME } from "./tables";

export interface Change { tbl: string; pk: Record<string, unknown>; op: "upsert" | "delete"; at: string; row?: Record<string, unknown> | null }

/** One key per row: the table and its key columns, in the table's own order. */
export const keyOf = (tbl: string, pk: Record<string, unknown>) => tbl + ":" + JSON.stringify((SYNCED_BY_NAME.get(tbl)?.pk ?? Object.keys(pk)).map((c) => pk[c]));

const cols = new Map<string, string[]>();
async function columns(q: Sql, t: string) {
  if (!cols.has(t)) cols.set(t, (await q.query<{ c: string }>(
    "SELECT column_name AS c FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position", [t])).rows.map((x) => x.c));
  return cols.get(t)!;
}

/** The rows as they are now, for a list of keys (missing = deleted). */
export async function readRows(q: Sql, keys: { tbl: string; pk: Record<string, unknown> }[]): Promise<Map<string, Record<string, unknown> | null>> {
  const out = new Map<string, Record<string, unknown> | null>();
  const byTable = new Map<string, { tbl: string; pk: Record<string, unknown> }[]>();
  for (const k of keys) { out.set(keyOf(k.tbl, k.pk), null); byTable.set(k.tbl, [...(byTable.get(k.tbl) ?? []), k]); }
  for (const [t, list] of byTable) {
    const def = SYNCED_BY_NAME.get(t);
    if (!def) continue;
    if (def.pk.length === 1 && def.pk[0] === "id") {
      for (const r of (await q.query(`SELECT to_jsonb(x) AS r FROM ${t} x WHERE x.id = ANY($1::uuid[])`, [list.map((k) => k.pk.id)])).rows)
        out.set(keyOf(t, { id: r.r.id }), r.r);
    } else {
      for (const k of list) {
        const r = (await q.query(`SELECT to_jsonb(x) AS r FROM ${t} x WHERE to_jsonb(x) @> $1::jsonb`, [JSON.stringify(k.pk)])).rows[0];
        if (r) out.set(keyOf(t, k.pk), r.r);
      }
    }
  }
  return out;
}

/** Every synced row of the person (the first copy a device gets). */
export async function allRows(q: Sql): Promise<Record<string, Record<string, unknown>[]>> {
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const t of SYNCED) tables[t.name] = (await q.query(`SELECT to_jsonb(x) AS r FROM ${t.name} x ${t.name === "exercises" ? "WHERE owner_id IS NOT NULL" : ""}`)).rows.map((x: any) => x.r);
  return tables;
}

/**
 * Workouts and what's in them: a deletion here is final (a cancelled workout, a removed set, the unticked sets dropped
 * when finishing), so a later change to the same row made somewhere that hadn't heard yet must not bring it back.
 * Their ids are made fresh every time, so a deleted one never legitimately comes back.
 */
export const DELETES_WIN = new Set(["workouts", "workout_exercises", "workout_sets"]);
const finished = (status: unknown) => status != null && status !== "in_progress";
/** The tables overrule() looks at the row here for. */
export const RULED = new Set([...DELETES_WIN, "health_imports"]);

/**
 * Rules that decide before "the newest change wins" (whose clocks can disagree between a phone and a server):
 * a deleted workout stays deleted, and a finished workout never goes back to running (a set ticked or the name changed
 * on a copy that didn't know it was finished must not reopen it). true: the incoming change wins; false: what's here
 * stays; null: newest wins. here: the row as it is now (null: none), and the last thing logged for it here.
 */
export function overrule(c: Change, here: { row: Record<string, unknown> | null; lastOp?: string | null }): boolean | null {
  if (DELETES_WIN.has(c.tbl)) {
    if (c.op === "delete") return true;
    if (!here.row && here.lastOp === "delete") return false;
  }
  // a Health Connect import deleted anywhere stays deleted: a phone that hadn't heard yet and synced the same day again
  // (a newer imported_at) must not bring it back
  if (c.tbl === "health_imports" && c.op === "upsert" && c.row && here.row) {
    if (c.row.deleted_at != null) return true;
    if (here.row.deleted_at != null) return false;
  }
  if (c.tbl === "workouts" && c.op === "upsert" && c.row && here.row) {
    const a = finished(c.row.status), b = finished(here.row.status);
    if (a && !b) return true;
    if (!a && b) return false;
  }
  return null;
}

/**
 * Every column of a synced row that points at another row, and the table it points into (for a note or reminder,
 * the target's kind says which). Foreign keys are checked without row-level security, so a device could otherwise
 * point a row at someone else's (a copy that once held another account's rows did: M-184). required: the row means
 * nothing without it (refused); otherwise the reference is cleared, as the app shows a reference it can't follow.
 */
type Ref = { col: string; table: string | ((row: Record<string, unknown>) => string | null); required?: boolean };
const NOTE_TARGET: Record<string, string> = { exercise: "exercises", routine: "routines", workout: "workouts", workout_exercise: "workout_exercises", routine_exercise: "routine_exercises", activity: "activities" };
export const REFS: Record<string, Ref[]> = {
  exercise_prefs: [{ col: "exercise_id", table: "exercises", required: true }],
  routines: [{ col: "folder_id", table: "folders" }, { col: "based_on_id", table: "routines" }],
  routine_exercises: [{ col: "routine_id", table: "routines", required: true }, { col: "exercise_id", table: "exercises", required: true }],
  routine_sets: [{ col: "routine_exercise_id", table: "routine_exercises", required: true }],
  routine_versions: [{ col: "routine_id", table: "routines", required: true }, { col: "workout_id", table: "workouts" }],
  schedules: [{ col: "routine_id", table: "routines" }],
  schedule_exceptions: [{ col: "schedule_id", table: "schedules", required: true }],
  workouts: [{ col: "routine_id", table: "routines" }, { col: "program_id", table: "programs" }, { col: "schedule_id", table: "schedules" }],
  workout_exercises: [{ col: "workout_id", table: "workouts", required: true }, { col: "exercise_id", table: "exercises", required: true }, { col: "routine_exercise_id", table: "routine_exercises" }],
  workout_sets: [{ col: "workout_exercise_id", table: "workout_exercises", required: true }],
  notes: [{ col: "target_id", table: (r) => NOTE_TARGET[String(r.target_type)] ?? null, required: true }, { col: "scope_routine_id", table: "routines" }, { col: "workout_id", table: "workouts" }],
  reminders: [
    { col: "target_id", table: (r) => (r.target_type === "routine" ? "routines" : "exercises"), required: true }, { col: "scope_routine_id", table: "routines" },
    { col: "created_workout_id", table: "workouts" }, { col: "deferred_workout_id", table: "workouts" }, { col: "last_shown_workout_id", table: "workouts" },
  ],
  goals: [{ col: "scope_id", table: (r) => (r.scope === "routine" ? "routines" : r.scope === "exercise" ? "exercises" : null), required: true }],
};

/**
 * Makes a row from a device point only at rows its person can see (the same rule visible() applies to the app's own
 * requests): a reference that can't be cleared refuses the row; others are cleared, and a program's days leave out
 * routines that aren't the person's. Returns whether anything was cleared (the device then gets the row as written).
 */
async function ownRefs(q: Sql, tbl: string, row: Record<string, unknown>, seen: Set<string>) {
  const canSee = async (table: string, v: unknown) => {
    if (!isUuid(v)) return false;
    // only what was found is remembered: a row can point at one written later in the same batch (a routine based on another)
    const k = table + ":" + v;
    if (seen.has(k)) return true;
    const ok = (await q.query(`SELECT 1 FROM ${table} WHERE id = $1`, [v])).rows.length > 0;
    if (ok) seen.add(k);
    return ok;
  };
  let cleared = false;
  for (const ref of REFS[tbl] ?? []) {
    const v = row[ref.col];
    if (v == null) continue;
    const table = typeof ref.table === "string" ? ref.table : ref.table(row);
    if (!table || (await canSee(table, v))) continue;
    if (ref.required) throw new Error(`${ref.col} points at a row this person can't see`);
    row[ref.col] = null;
    cleared = true;
  }
  if (tbl === "programs" && Array.isArray(row.weeks)) {
    const weeks: unknown[] = [];
    for (const w of row.weeks as any[]) {
      if (!w || typeof w !== "object" || !Array.isArray(w.days)) { weeks.push(w); continue; }
      const days: unknown[] = [];
      for (const d of w.days) if (await canSee("routines", d)) days.push(d); else cleared = true;
      weeks.push({ ...w, days });
    }
    row.weeks = weeks;
  }
  return cleared;
}

/** Whether the user has Progression switched on (the default); a stored false is the only thing that turns it off. */
async function progressionOn(q: Sql, userId: string) {
  const r = await q.query<{ on: boolean | null }>(
    "SELECT CASE WHEN jsonb_typeof(data->'features'->'progression') = 'boolean' THEN (data->'features'->>'progression')::boolean END AS on FROM user_settings WHERE user_id = $1", [userId]);
  return r.rows[0]?.on ?? true;
}

/**
 * Writes changes made elsewhere: upserts parents first, then deletes children first.
 * Each row on its own savepoint, so one that no longer fits (its parent was deleted meanwhile) doesn't stop the rest.
 * origin: who made them (the server logs it, so that device isn't sent its own changes back); apply: a device writing
 * the server's rows (not logged at all; those were checked by the server, and a row may come before what it points at).
 * Rows from a device have their references checked (ownRefs); cleared lists the ones written with some cleared.
 */
export async function applyChanges(q: Sql, userId: string, changes: Change[], opts: { origin?: string; apply?: boolean } = {}) {
  const ord = (c: Change) => SYNCED_BY_NAME.get(c.tbl)!.order;
  const list = [
    ...changes.filter((c) => c.op === "upsert" && c.row).sort((a, b) => ord(a) - ord(b)),
    ...changes.filter((c) => c.op === "delete").sort((a, b) => ord(b) - ord(a)),
  ];
  if (opts.apply) await q.query("SELECT set_config('motus.sync_apply', '1', true)");
  const failed: { change: Change; error: string }[] = [];
  // upserts that were not written because the row here is a finished workout and the change would reopen it
  const kept: Change[] = [], cleared: Change[] = [];
  const seen = new Set<string>();
  for (const c of list) {
    const def = SYNCED_BY_NAME.get(c.tbl)!;
    await q.query("SAVEPOINT motus_row");
    try {
      if (opts.origin != null) await q.query("SELECT set_config('motus.sync_origin', $1, true), set_config('motus.sync_at', $2, true)", [opts.origin, c.at]);
      if (c.op === "upsert") {
        const all = await columns(q, c.tbl);
        // a row always belongs to whoever is writing it, whatever the JSON says
        const row: Record<string, unknown> = { ...c.row, ...(c.tbl === "exercises" ? { owner_id: userId } : all.includes("user_id") ? { user_id: userId } : {}) };
        // a routine exercise from a device on an app from before 015_routine_now: its Progression made safe (an old rule
        // becomes its own Automatic), and "Always start with these numbers" (prefill 'target') becomes fixed
        if (c.tbl === "routine_exercises") {
          if ("progression" in row) {
            const p = row.progression as Record<string, unknown> | null;
            // an old rule only becomes Automatic when the Progression feature is on (as migration 015 does), else Settings rule
            const old = !!p && typeof p === "object" && "kind" in p && !("mode" in p);
            row.progression = old && !(await progressionOn(q, userId)) ? null : cleanProgression(p);
          }
          if ("prefill" in row && !("fixed" in row)) row.fixed = row.prefill === "target";
        }
        const fixed = !opts.apply && (await ownRefs(q, c.tbl, row, seen));
        // only the columns the JSON has: a device on an older app doesn't know newer columns, so a new row takes their
        // default and an existing row keeps its value, instead of both becoming NULL
        const has = all.filter((x) => x in row);
        const rest = has.filter((x) => !def.pk.includes(x));
        // the last guard against a finished workout going back to running, whatever got this far
        const guard = c.tbl === "workouts" ? " WHERE NOT (workouts.status <> 'in_progress' AND EXCLUDED.status = 'in_progress') RETURNING 1 AS ok" : "";
        const r = await q.query(
          `INSERT INTO ${c.tbl} (${has.join(", ")}) SELECT ${has.join(", ")} FROM jsonb_populate_record(NULL::${c.tbl}, $1::jsonb)
           ON CONFLICT (${def.pk.join(", ")}) DO ${rest.length ? `UPDATE SET ${rest.map((x) => `${x} = EXCLUDED.${x}`).join(", ")}` : "NOTHING"}${guard}`, [JSON.stringify(row)]);
        if (guard && !r.rows.length) kept.push(c);
        else if (fixed) cleared.push(c);
      } else if (def.pk.length === 1 && def.pk[0] === "id") {
        await q.query(`DELETE FROM ${c.tbl} WHERE id = $1`, [c.pk.id]);
      } else {
        await q.query(`DELETE FROM ${c.tbl} x WHERE to_jsonb(x) @> $1::jsonb`, [JSON.stringify(c.pk)]);
      }
      await q.query("RELEASE SAVEPOINT motus_row");
    } catch (e) {
      await q.query("ROLLBACK TO SAVEPOINT motus_row");
      failed.push({ change: c, error: (e as Error).message });
    }
  }
  if (opts.apply) await q.query("SELECT set_config('motus.sync_apply', '', true)");
  return { applied: list.length - failed.length - kept.length, failed, kept, cleared };
}

/** The latest change per row among log entries (oldest first, as they come from the log). */
export function latestPerRow<T extends { tbl: string; pk: Record<string, unknown> }>(entries: T[]): T[] {
  const m = new Map<string, T>();
  for (const e of entries) { const k = keyOf(e.tbl, e.pk); m.delete(k); m.set(k, e); }
  return [...m.values()];
}
