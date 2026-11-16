// Reading and writing synced rows, the same way on the server and on a device.
// Rows travel as JSON made by to_jsonb and are written back with jsonb_populate_record, so every column type round-trips.
import { cleanProgression } from "@motus/shared";
import type { Sql } from "../db";
import { isUuid } from "../ids";
import { SYNCED, SYNCED_BY_NAME } from "./tables";
import { lockRecords } from "../modules/healthDerive";

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
  // A deletion taken back (Imported data → Restore, restored_at, 039) wins over that same deletion still on a copy that
  // hadn't heard of the restore; a deletion made after the restore wins again.
  if (c.tbl === "health_imports" && c.op === "upsert" && c.row && here.row) {
    const t = (v: unknown) => (v == null ? null : Date.parse(String(v)));
    const inDel = t(c.row.deleted_at), hereDel = t(here.row.deleted_at), inBack = t(c.row.restored_at), hereBack = t(here.row.restored_at);
    if (inDel != null) return !(hereDel == null && hereBack != null && hereBack >= inDel);
    if (hereDel != null) return inBack != null && inBack >= hereDel;
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

/** The code of a failure for a required reference to someone else's row (ownRefs). */
export const FOREIGN_REF = "FOREIGN_REF";
export interface Failure { change: Change; error: string; code?: string; detail?: string }

/**
 * Tables whose rows the server may give a new id when their own is another account's (modules/sync.ts push): every
 * reference to them is in REFS (or a program's days), so a row pointing at one can be pointed at the new id. Not
 * exercises or schedules, whose ids are part of other rows' keys (exercise_prefs, schedule_exceptions).
 */
export const REKEYABLE = new Set(["folders", "programs", "routines", "routine_exercises", "routine_sets", "routine_versions", "workouts",
  "workout_exercises", "workout_sets", "notes", "reminders", "goals", "activity_types", "activities", "body_metrics"]);

/**
 * A row with its references to moved rows pointed at their new ids. moves: "table:old id" → new id. Returns the row
 * (a copy) and whether anything changed. A program's days point into routines.
 */
export function remapRefs(tbl: string, row: Record<string, unknown>, moves: Map<string, string>): { row: Record<string, unknown>; changed: boolean } {
  const out = { ...row };
  let changed = false;
  for (const ref of REFS[tbl] ?? []) {
    const v = out[ref.col];
    const table = v == null ? null : typeof ref.table === "string" ? ref.table : ref.table(out);
    const to = table ? moves.get(table + ":" + v) : undefined;
    if (to) { out[ref.col] = to; changed = true; }
  }
  if (tbl === "programs" && Array.isArray(out.weeks))
    out.weeks = (out.weeks as unknown[]).map((w) => {
      if (!isWeek(w)) return w;
      return { ...w, days: w.days.map((d) => { const to = moves.get("routines:" + d); if (to) changed = true; return to ?? d; }) };
    });
  return { row: out, changed };
}

/** A program's week as a device sends it (untrusted JSON): only its days are looked at, the rest is kept as sent. */
type Week = Record<string, unknown> & { days: unknown[] };
const isWeek = (w: unknown): w is Week => !!w && typeof w === "object" && Array.isArray((w as { days?: unknown }).days);

/**
 * Makes a row from a device point only at rows its person can see (the same rule visible() applies to the app's own
 * requests): a reference that can't be cleared refuses the row; others are cleared, and a program's days leave out
 * routines that aren't the person's. Returns whether anything was cleared (the device then gets the row as written).
 * Only a row that is someone else's counts against a reference (035). One that isn't here is kept: the person's own,
 * sent in the same push after the row pointing at it (rows go table by table: a routine's version names the workout
 * finished offline, a program the routine made for it) or in a later page of the push, or one already deleted (the
 * app shows a reference it can't follow; a required one with a foreign key still fails on its own). foreign: what was
 * found per row. The push's own rows need no list of their own: not here yet, they aren't someone else's either, and
 * one with someone else's id is refused when written (row-level security), so nothing may count it as the person's.
 */
async function ownRefs(q: Sql, tbl: string, row: Record<string, unknown>, foreign: Map<string, boolean>) {
  const canSee = async (table: string, v: unknown) => {
    if (!isUuid(v)) return false;
    const k = table + ":" + v;
    if (!foreign.has(k)) foreign.set(k, !!(await q.query<{ f: boolean }>("SELECT motus_foreign_row($1, $2) AS f", [table, v])).rows[0]?.f);
    return !foreign.get(k);
  };
  let cleared = false;
  for (const ref of REFS[tbl] ?? []) {
    const v = row[ref.col];
    if (v == null) continue;
    const table = typeof ref.table === "string" ? ref.table : ref.table(row);
    if (!table || (await canSee(table, v))) continue;
    if (ref.required) throw Object.assign(new Error(`${ref.col} points at a row this person can't see`), { code: FOREIGN_REF });
    row[ref.col] = null;
    cleared = true;
  }
  if (tbl === "programs" && Array.isArray(row.weeks)) {
    const weeks: unknown[] = [];
    for (const w of row.weeks as unknown[]) {
      if (!isWeek(w)) { weeks.push(w); continue; }
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
/**
 * A day's number from an app that knows typed_at (039) is merged per column (mergeDay), so it never loses whole to a
 * newer change of the same day elsewhere: a phone that imported offline and sends later still brings its synced value,
 * while a value typed elsewhere since stays. A deletion stays a whole-row matter.
 */
export function perColumn(c: Change) {
  return c.tbl === "daily_logs" && c.op === "upsert" && c.row != null && "typed_at" in c.row;
}

/** `own`: keys (keyOf) of days whose synced value, worn and device stay as they are here (a device's unsent import). */
const HEALTH_TABLES = new Set(["daily_logs", "activities", "body_metrics", "health_imports"]);
export async function applyChanges(q: Sql, userId: string, changes: Change[], opts: { origin?: string; apply?: boolean; own?: Set<string> } = {}) {
  const ord = (c: Change) => SYNCED_BY_NAME.get(c.tbl)!.order;
  const list = [
    ...changes.filter((c) => c.op === "upsert" && c.row).sort((a, b) => ord(a) - ord(b)),
    ...changes.filter((c) => c.op === "delete").sort((a, b) => ord(b) - ord(a)),
  ];
  if (opts.apply) await q.query("SELECT set_config('motus.sync_apply', '1', true)");
  // a row of these deleted or written marks or writes the import log, whose deletion takes the records lock (034, 041),
  // and afterRecords writes them under it: taken first, before any row (modules/healthDerive.ts lockRecords)
  if (changes.some((c) => HEALTH_TABLES.has(c.tbl))) await lockRecords(q, userId);
  // code: the SQLSTATE (or FOREIGN_REF, ownRefs), detail: the database's detail; what the server makes of a failure
  // depends on them (modules/sync.ts push)
  const failed: Failure[] = [];
  // upserts that were not written: the row here is a finished workout and the change would reopen it, or a trigger
  // skipped it (the device then gets the row as it is here, or its deletion)
  // skipped: those of kept not written at all (the rest of kept were written, differently: a day's number, below)
  const kept: Change[] = [], cleared: Change[] = [];
  let skipped = 0;
  const foreign = new Map<string, boolean>();
  for (const c of list) {
    const def = SYNCED_BY_NAME.get(c.tbl)!;
    await q.query("SAVEPOINT motus_row");
    try {
      if (opts.origin != null) await q.query("SELECT set_config('motus.sync_origin', $1, true), set_config('motus.sync_at', $2, true)", [opts.origin, c.at]);
      if (c.op === "upsert") {
        const all = await columns(q, c.tbl);
        // a row always belongs to whoever is writing it, whatever the JSON says
        // (a device writing the server's rows keeps an exercise's owner as it is there: the shared catalog has none, and
        // one sent back to the device (modules/sync.ts push) must not become the person's own there)
        const row: Record<string, unknown> = { ...c.row, ...(c.tbl === "exercises" ? (opts.apply ? {} : { owner_id: userId }) : all.includes("user_id") ? { user_id: userId } : {}) };
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
        const fixed = !opts.apply && (await ownRefs(q, c.tbl, row, foreign));
        if (c.tbl === "daily_logs") await mergeDay(q, row, c.pk, opts.own?.has(keyOf(c.tbl, c.pk)) ?? false);
        // only the columns the JSON has: a device on an older app doesn't know newer columns, so a new row takes their
        // default and an existing row keeps its value, instead of both becoming NULL
        const has = all.filter((x) => x in row);
        const rest = has.filter((x) => !def.pk.includes(x));
        // the last guard against a finished workout going back to running, whatever got this far
        const guard = c.tbl === "workouts" ? " WHERE NOT (workouts.status <> 'in_progress' AND EXCLUDED.status = 'in_progress')" : "";
        // RETURNING tells a row not written: by that guard, or by a trigger that skips it (a day's number from Health
        // Connect under a deleted import, 031). Not with DO NOTHING, where a row already here returns nothing either.
        // A day's number returns what the trigger made of it (039), to tell one written other than as sent.
        const ret = c.tbl === "daily_logs" ? "value::text AS value, source, typed::text AS typed, chosen" : "1 AS ok";
        const r = await q.query(
          `INSERT INTO ${c.tbl} (${has.join(", ")}) SELECT ${has.join(", ")} FROM jsonb_populate_record(NULL::${c.tbl}, $1::jsonb)
           ON CONFLICT (${def.pk.join(", ")}) DO ${rest.length ? `UPDATE SET ${rest.map((x) => `${x} = EXCLUDED.${x}`).join(", ")}${guard} RETURNING ${ret}` : "NOTHING"}`, [JSON.stringify(row)]);
        if (rest.length && !r.rows.length) { kept.push(c); skipped++; }
        // written, but not as sent: a value from an app before 039 filed beside a typed one the day keeps using, or a
        // typed value or choice made more recently here (mergeDay). The sender gets the row as it is here.
        else if (c.tbl === "daily_logs" && r.rows[0] && !sameDay(c.row!, r.rows[0])) kept.push(c);
        else if (fixed) cleared.push(c);
      } else if (def.pk.length === 1 && def.pk[0] === "id") {
        await q.query(`DELETE FROM ${c.tbl} WHERE id = $1`, [c.pk.id]);
      } else {
        await q.query(`DELETE FROM ${c.tbl} x WHERE to_jsonb(x) @> $1::jsonb`, [JSON.stringify(c.pk)]);
      }
      await q.query("RELEASE SAVEPOINT motus_row");
    } catch (e) {
      await q.query("ROLLBACK TO SAVEPOINT motus_row");
      const err = e as Error & { code?: unknown; detail?: unknown };
      failed.push({ change: c, error: err.message, code: typeof err.code === "string" ? err.code : undefined, detail: typeof err.detail === "string" ? err.detail : undefined });
    }
  }
  if (opts.apply) await q.query("SELECT set_config('motus.sync_apply', '', true)");
  return { applied: list.length - failed.length - skipped, failed, kept, cleared };
}

/**
 * A day's number is merged per column (039), not taken whole: its typed value and choice from whichever copy changed
 * them last (typed_at), its synced value, worn and device from the row coming in (the newest import). A phone that
 * hadn't heard of a value typed or a choice made elsewhere still brings its import in, without its stale typed value.
 * Only for a row that knows typed_at (an app from before 039 sends value and source, which the trigger files). value
 * and source are left as they are here, so the trigger works them out from the three and never reads the row as an
 * older app's write. `own`: this copy's synced value, worn and device stand (a device's import not yet sent, against
 * the server's older one).
 */
async function mergeDay(q: Sql, row: Record<string, unknown>, pk: Record<string, unknown>, own: boolean) {
  if (!("typed_at" in row)) return;
  const here = (await q.query<{ value: string; source: string | null; typed: string | null; chosen: string | null; typed_at: string | null; newer: boolean; synced: string | null; worn: boolean; device: string | null }>(
    `SELECT value::text AS value, source, typed::text AS typed, chosen, to_jsonb(typed_at) #>> '{}' AS typed_at,
       synced::text AS synced, worn, device,
       typed_at IS NOT NULL AND ($4::timestamptz IS NULL OR typed_at > $4::timestamptz) AS newer
     FROM daily_logs WHERE user_id = $1 AND date = $2::date AND kind = $3`, [row.user_id, row.date, row.kind, row.typed_at ?? null])).rows[0];
  if (!here) {
    // the day was deleted here after its typed value or choice was made (the web cleared it while the phone, not yet
    // told, imported into it): only the import comes in, never the cleared typed value. Nothing synced either: the
    // trigger writes nothing (value filed as synced, both empty), and the sender gets the deletion.
    const last = (await q.query<{ op: string; at: string; after: boolean }>(
      `SELECT op, to_jsonb(at) #>> '{}' AS at, ($2::timestamptz IS NULL OR at > $2::timestamptz) AS after FROM sync_log WHERE tbl = 'daily_logs' AND pk = $1::jsonb ORDER BY seq DESC LIMIT 1`,
      [JSON.stringify(pk), row.typed_at ?? null])).rows[0];
    if (last?.op === "delete" && last.after)
      // stamped with the deletion, so a copy still holding the old typed value takes the clearing over it (here.newer)
      Object.assign(row, { typed: null, chosen: null, typed_at: last.at, value: row.synced ?? null, source: "health_connect" });
    return;
  }
  if (here.newer) Object.assign(row, { typed: here.typed, chosen: here.chosen, typed_at: here.typed_at });
  if (own) Object.assign(row, { synced: here.synced, worn: here.worn, device: here.device });
  Object.assign(row, { value: here.value, source: here.source });
}

/** Whether a day's number was written as sent: the value it uses and where from, and (when sent) its typed value and choice. */
function sameDay(sent: Record<string, unknown>, got: { value: string | null; source: string | null; typed: string | null; chosen: string | null }) {
  const n = (v: unknown) => (v == null ? null : Number(v));
  if ("value" in sent && n(sent.value) !== n(got.value)) return false;
  if ("source" in sent && (sent.source ?? null) !== got.source) return false;
  if ("typed" in sent && n(sent.typed) !== n(got.typed)) return false;
  if ("chosen" in sent && (sent.chosen ?? null) !== got.chosen) return false;
  return true;
}

/** The latest change per row among log entries (oldest first, as they come from the log). */
export function latestPerRow<T extends { tbl: string; pk: Record<string, unknown> }>(entries: T[]): T[] {
  const m = new Map<string, T>();
  for (const e of entries) { const k = keyOf(e.tbl, e.pk); m.delete(k); m.set(k, e); }
  return [...m.values()];
}
