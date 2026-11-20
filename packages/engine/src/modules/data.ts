// Everything in and out: the full backup/export (JSON), restore (replace or merge), CSV export in Strong's layout,
// and imports from Strong, Hevy and FitNotes CSV files.
import { cleanProgression, TRACKINGS } from "@motus/shared";
import type { Router, Ctx } from "../router";
import type { Sql } from "../db";
import { uuidv7, isUuid, ownCopyId } from "../ids";
import { bad } from "../errors";
import { oneOf, visible } from "../util";
import { historyNow } from "../migrations/016_history_now";
import { repRangeMove } from "../migrations/022_progression_rep_range";
import { unpinSeededGoals, type SeededGoals } from "../migrations/026_unpin_seeded_goals";
import { clearAutoTitles } from "../migrations/033_goal_names_only";
import { lockRecords, mergeBlock } from "./healthRecords";

const EXPORT_FORMAT = 1;
// The schema a file was written with: the number of migrations (migrate.ts) when it was made, so a restore knows which
// of their changes to existing rows the file's rows still need. A test keeps it equal to the number of migrations, so a
// new one is checked against backups (does the file carry it, does an older file need converting).
const BACKUP_SCHEMA = 53; // 40: health_records (an older file has none: nothing to convert); 41: its trigger only; 42, 43: health_record_reads, not in backups; 44: health_records.apps, worked out again by its trigger on restore; 45: more record types (nothing to convert; an older version refuses the file, its rows would break the type check); 46: health_imports.linked, apart and span (an older file has none: its sessions stay as they were, unlinked; their span filled in as 046 did, SINCE.sessionSpans); 47: health_imports.copied and activities.edited_at (an older file has none: nothing to take back, nothing marked edited); 48: band_link_pass, not in backups (a restore runs the linking pass again); 49: sync_resets, not in backups (a restore sets it); 50: a function only; 51: programs.start_date may be empty (an older file always has one: nothing to convert; an older version refuses the file, a program with no date would break its NOT NULL); 52: programs.counts_from (an older file has none: a program with no date counts from when it was made, as before); 53: programs.goal (an older file has none: its programs take the default, muscle size; an older version refuses the file, as it has no such column)
const NEWER = "This backup is from a newer version of Motus. Update the app first.";
const DAMAGED = "This backup is damaged and can't be restored.";
/** The schema a file says it has (refused when newer than this version, or not a whole number from 0 up), or
 * undefined for a file from before files said it. */
function fileSchema(data: any): number | undefined {
  if (data.schema === undefined) return undefined;
  if (!Number.isSafeInteger(data.schema) || data.schema < 0) throw bad(DAMAGED);
  // its rows may hold what this version has no place for (new tables and columns), which a restore would drop for good
  if (data.schema > BACKUP_SCHEMA) throw bad(NEWER);
  return data.schema;
}
// The migrations that changed rows (not only added columns or tables), with the first release that had each (the time
// of its tag, v0.1.12 / v0.1.15 / v0.1.20 / v0.1.27): a file from before one (its schema, or for a file from before
// files said their schema, made before that release) gets that change on the way in, only on its own rows. A file made
// after the release by an app not yet updated still has the old form: 016 and 022 also run on whatever rows of a file
// without a schema still show it. 015 and 024 are converted row by row below.
const SINCE = {
  reminderBody: [14, "2026-11-08T23:55:39Z"], history: [16, "2026-11-08T23:55:39Z"], repRange: [22, "2026-11-10T23:52:11Z"],
  homePins: [26, "2026-11-13T23:53:22Z"], goalTitles: [33, "2026-11-14T22:32:54Z"], sessionSpans: [46, "2026-11-16T00:37:36Z"],
} as const;
const madeBefore = (data: any, [n, at]: readonly [number, string]) =>
  data.schema !== undefined ? Number(data.schema) < n : String(data.exportedAt ?? "") < at;
// a v7 id as Motus makes them (ids.ts): version 7, its variant, and a time from 2024 up to a year from now; an id made
// from md5 has all of these by chance almost never (about once in 200,000)
const madeAsV7 = (id: string) => {
  const t = parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
  return id[14] === "7" && /[89ab]/i.test(id[19]!) && t >= Date.UTC(2024, 0, 1) && t <= Date.now() + 365 * 86400000;
};
// an uploaded photo (on a server, a file beside the database) in a file: "media:<id>" in an exercise's images or a
// progress photo's note, carried in the file's media as a data: URL (apps/server adds them to an export)
const DATA_URL = /^data:[\w.+-]+\/[\w.+-]+;base64,[A-Za-z0-9+/=]*$/;
// in the order they are restored (a table only points at tables above it; programs list their routines; notes can be on activities)
const TABLES = [
  "exercises", "exercise_prefs", "folders", "routines", "routine_exercises", "routine_sets", "routine_versions", "programs", "schedules", "schedule_exceptions",
  "workouts", "workout_exercises", "workout_sets", "activity_types", "activities", "notes", "reminders", "goals", "body_metrics", "daily_logs",
  "sleep_nights", "hr_days", "health_records", "health_imports", // health_imports after what it points at (ref: a body entry or an activity), so a merge swaps those ids in it too
] as const;
type Table = (typeof TABLES)[number];
// A Motus file holds all of these or some of them, e.g. only routines to copy into another account.
// Custom exercises always come along, since routines and workouts point at them.
const PARTS = ["routines", "programs", "workouts", "other"] as const;
type Part = (typeof PARTS)[number];
const PART_TABLES: Record<Exclude<Part, "other">, Table[]> = {
  routines: ["folders", "routines", "routine_exercises", "routine_sets", "routine_versions", "notes"],
  programs: ["programs"],
  workouts: ["workouts", "workout_exercises", "workout_sets", "notes"],
};
// notes are split: the ones written in a workout go with workouts, those on routines with routines, the rest (on exercises, activities) with "other"
const OTHER: Table[] = [...TABLES.filter((t) => t !== "exercises" && !Object.values(PART_TABLES).flat().includes(t)), "notes"];
// without "other", workouts means finished ones and the notes written in them
const DONE = "SELECT id FROM workouts WHERE status = 'completed'";
const PART_WHERE: Partial<Record<Table, string>> = {
  exercises: "WHERE owner_id IS NOT NULL",
  workouts: "WHERE status = 'completed'",
  workout_exercises: `WHERE workout_id IN (${DONE})`,
  workout_sets: `WHERE workout_exercise_id IN (SELECT id FROM workout_exercises WHERE workout_id IN (${DONE}))`,
  notes: `WHERE workout_id IN (${DONE})`,
};
const ROUTINE_NOTE = "target_type IN ('routine', 'routine_exercise')";
const WORKOUT_NOTE = "target_type IN ('workout', 'workout_exercise')";
// the part of the notes a selection of parts takes
function notesWhere(parts: Part[]): string {
  const w: string[] = [];
  if (parts.includes("routines")) w.push(ROUTINE_NOTE);
  if (parts.includes("workouts")) w.push(parts.includes("other") ? `workout_id IS NOT NULL OR ${WORKOUT_NOTE}` : `workout_id IN (${DONE})`);
  if (parts.includes("other")) w.push(`(workout_id IS NULL AND target_type NOT IN ('routine', 'routine_exercise', 'workout', 'workout_exercise'))`);
  return `WHERE ${w.join(" OR ")}`;
}
const OWNER_COL: Record<string, string> = { exercises: "owner_id" };
// columns that point at another row: an imported row may only point at rows this account can see
const REFS: Record<string, Table> = {
  folder_id: "folders", routine_id: "routines", routine_exercise_id: "routine_exercises", workout_id: "workouts", workout_exercise_id: "workout_exercises",
  schedule_id: "schedules", program_id: "programs", exercise_id: "exercises", created_workout_id: "workouts",
  scope_routine_id: "routines", last_shown_workout_id: "workouts", deferred_workout_id: "workouts",
};
// what a note, reminder or goal is about: an id without a foreign key, so it is checked here; a row about something
// this account can't see is left out
const TARGETS: Record<string, Table> = {
  exercise: "exercises", routine: "routines", routine_exercise: "routine_exercises", workout: "workouts", workout_exercise: "workout_exercises", activity: "activities",
};
const targetOf = (t: Table, row: Record<string, unknown>): [Table, unknown] | null => {
  if (t === "notes" || t === "reminders") return [TARGETS[String(row.target_type)] ?? "exercises", row.target_id];
  if (t === "goals" && (row.scope === "routine" || row.scope === "exercise")) return [TARGETS[row.scope]!, row.scope_id];
  return null;
};
type IdRow = { id: string };

/** The parts asked for ("routines,workouts" or a list); none means all. Programs are made of routines, so they bring them along. */
function readParts(v: unknown): Part[] {
  const asked = (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []).map(String);
  const set = new Set(PARTS.filter((p) => asked.includes(p)));
  if (set.has("programs")) set.add("routines");
  return set.size ? PARTS.filter((p) => set.has(p)) : [...PARTS];
}

export async function exportAll(q: Sql, userId: string, partsAsked?: unknown) {
  const parts = readParts(partsAsked);
  const whole = parts.length === PARTS.length;
  const take = new Set<Table>(["exercises", ...parts.flatMap((p) => (p === "other" ? OTHER : PART_TABLES[p]))]);
  const tables: Record<string, any[]> = {};
  for (const t of TABLES) {
    if (!take.has(t)) continue;
    const where = t === "exercises" ? PART_WHERE[t]!
      : t === "notes" ? (whole ? "" : notesWhere(parts))
      : parts.includes("other") || whole ? "" : (PART_WHERE[t] ?? "");
    tables[t] = (await q.query(`SELECT * FROM ${t} ${where}`)).rows.map((r: any) => { const o = { ...r }; delete o.user_id; delete o.owner_id; return o; });
  }
  // catalog exercises are referred to by their catalog id, since the same exercise has a different row id on another server
  const used = new Set<string>([...(tables.routine_exercises ?? []), ...(tables.workout_exercises ?? [])].map((r) => r.exercise_id));
  for (const n of tables.notes ?? []) if (n.target_type === "exercise") used.add(n.target_id);
  for (const m of tables.reminders ?? []) if (m.target_type === "exercise") used.add(m.target_id);
  for (const p of tables.exercise_prefs ?? []) used.add(p.exercise_id);
  for (const g of tables.goals ?? []) if (g.scope === "exercise" && g.scope_id) used.add(g.scope_id);
  const refs = (await q.query("SELECT id, source, source_id FROM exercises WHERE owner_id IS NULL AND id = ANY($1::uuid[])", [[...used]])).rows;
  const settings = parts.includes("other") ? ((await q.query("SELECT data FROM user_settings")).rows[0]?.data ?? {}) : undefined;
  // the account's id too: the goals the app once made by itself have ids from it (026), which a restore elsewhere needs
  const user = (await q.query("SELECT id, username, display_name, email FROM users WHERE id = $1", [userId])).rows[0];
  return { app: "motus", format: EXPORT_FORMAT, schema: BACKUP_SCHEMA, exportedAt: new Date().toISOString(), parts, user, settings, catalogRefs: Object.fromEntries(refs.map((r: any) => [r.id, `${r.source}:${r.source_id}`])), tables };
}

export async function importAll(ctx: Ctx, data: any, mode: "replace" | "merge") {
  if (!data || data.app !== "motus" || !data.tables) throw bad("This is not a Motus export");
  if (data.format > EXPORT_FORMAT) throw bad("This export is from a newer version of Motus. Update the app first.");
  fileSchema(data);
  if (mode === "replace" && readParts(data.parts).length < PARTS.length) throw bad("This file holds only part of an account, so it can only be added to what you have");
  const q = ctx.q;
  // old id → id here: catalog exercises by their catalog id, custom ones by name, and rows whose id another account uses
  const map = new Map<string, string>();
  const refs: Record<string, string> = data.catalogRefs ?? {};
  if (Object.keys(refs).length) {
    const { rows } = await q.query("SELECT id, source || ':' || source_id AS k FROM exercises WHERE owner_id IS NULL");
    const local = new Map(rows.map((r: any) => [r.k, r.id]));
    for (const [oldId, key] of Object.entries(refs)) { const l = local.get(key); if (l) map.set(oldId, l); }
  }
  // a photo uploaded to the server the file came from: kept as data in the row (as a local account keeps photos), unless
  // this server has that upload for this account already (a restore into the same account). A server makes each photo an
  // upload again before this (apps/server POST /api/import) and leaves none here: only an app without uploads gets here.
  if (data.media && typeof data.media === "object") {
    for (const [mid, url] of Object.entries(data.media)) {
      if (!isUuid(mid) || typeof url !== "string" || !DATA_URL.test(url)) continue;
      if ((await q.query("SELECT 1 FROM media WHERE id = $1", [mid])).rows.length) continue;
      map.set(`media:${mid}`, `media:${url}`);
    }
  }
  // every id in a row (json columns included) is swapped for its id here
  const fix = (v: unknown): unknown => typeof v === "string" ? (map.get(v) ?? v) : Array.isArray(v) ? v.map(fix)
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fix(x)])) : v;
  const seen = new Set<string>();
  const canSee = async (table: string, rowId: unknown) => {
    if (typeof rowId !== "string" || !isUuid(rowId)) return false;
    if (seen.has(rowId)) return true;
    try { await visible(q, table, rowId); } catch { return false; }
    seen.add(rowId);
    return true;
  };
  let settingsWritten = false;
  // Health Connect records are changed one save at a time (lockRecords), taken before any row in either mode: a phone's
  // save running meanwhile would write back blocks a replace deletes, and the lock taken only later (mergeBlock, the
  // import log's trigger) after daily_logs/activities/sleep rows locked here would wait on a save that waits on them
  await lockRecords(q, ctx.userId);
  // the restored rows may hold duplicates from before linking: the one full linking pass runs again (048, bandMatch)
  await q.query("DELETE FROM band_link_pass");
  if (mode === "replace") {
    for (const t of [...TABLES].reverse()) {
      if (t === "exercises") await q.query("DELETE FROM exercises WHERE owner_id = $1 AND id NOT IN (SELECT exercise_id FROM workout_exercises UNION SELECT exercise_id FROM routine_exercises)", [ctx.userId]);
      else await q.query(`DELETE FROM ${t}`);
    }
    // when the phone read what (042) goes with the records it read: its next reads say again
    await q.query("DELETE FROM health_record_reads");
    if (data.settings) {
      await q.query("INSERT INTO user_settings (user_id, data) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET data = $2", [ctx.userId, JSON.stringify(data.settings)]);
      settingsWritten = true;
    }
  }
  // merged into an account whose settings were never changed (a new one, e.g. a local account moved to a server): the
  // file's settings come along; settings someone chose here are theirs and stay
  else if (data.settings && typeof data.settings === "object" && !Array.isArray(data.settings))
    settingsWritten = (await q.query("INSERT INTO user_settings (user_id, data) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING RETURNING user_id", [ctx.userId, JSON.stringify(data.settings)])).rows.length > 0;
  const counts: Record<string, number> = {};
  const added: Partial<Record<Table, string[]>> = {};
  for (const t of TABLES) {
    const rows: any[] = Array.isArray(data.tables[t]) ? data.tables[t] : [];
    const colRows = (await q.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1", [t])).rows;
    // a column this version doesn't have any more (an older file; a newer one is refused above) is left out rather than failing the restore
    const known = new Set<string>(colRows.map((x: any) => x.column_name));
    const json = new Set<string>(colRows.filter((x: any) => x.data_type === "json" || x.data_type === "jsonb").map((x: any) => x.column_name));
    const insert = async (row: Record<string, unknown>) => {
      const cols = Object.keys(row);
      // json columns get JSON (an empty list included); text[] columns get the list as it is
      const vals = cols.map((c) => { const v = row[c]; return v != null && json.has(c) ? JSON.stringify(v) : v; });
      const sql = `INSERT INTO ${t} (${cols.join(",")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")}) ON CONFLICT DO NOTHING RETURNING 1`;
      if (mode === "replace") return (await q.query(sql, vals)).rows.length;
      // a row that no longer fits (e.g. points at something missing) is left out of a merge
      await q.query("SAVEPOINT r");
      try { const n = (await q.query(sql, vals)).rows.length; await q.query("RELEASE SAVEPOINT r"); return n; }
      catch { await q.query("ROLLBACK TO SAVEPOINT r"); return 0; }
    };
    let n = 0;
    for (const raw of rows) {
      if (!raw || typeof raw !== "object") continue;
      const row: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(raw)) if (/^[a-z_0-9]+$/.test(k)) row[k] = fix(v);
      // a backup from before 014: "Ready for more weight" reminders carried their numbers in the body too
      if (t === "reminders" && madeBefore(data, SINCE.reminderBody) && row.action && typeof row.action === "object" && "setWeightKg" in row.action
        && typeof row.body === "string" && row.body.startsWith("Ready for more weight:")) row.body = "Ready for more weight";
      if (t === "routines") row.based_on_id = null;
      // a set's side is "L", "R" or both together (null), as writeRoutineBody keeps it (021_routine_set_side_check)
      if ((t === "routine_sets" || t === "workout_sets") && "side" in row) row.side = row.side === "L" || row.side === "R" ? row.side : null;
      // a backup from before "Keep these numbers fixed" and Progression (015_routine_now): carried over the same way
      if (t === "routine_exercises") {
        if (!("fixed" in row)) row.fixed = row.prefill === "target";
        row.progression = cleanProgression(row.progression);
        delete row.prefill; delete row.prefill_scope;
      }
      // a backup from before Track by (024_exercise_tracking): the reps-or-time switch becomes the tracking it stood for
      if (t === "exercise_prefs") {
        if (row.timed != null && row.tracking == null) row.tracking = await timedTracking(q, row.exercise_id, row.timed === true);
        delete row.timed;
        row.tracking = row.tracking == null ? null : oneOf(row.tracking, TRACKINGS, null);
      }
      if (t === "exercises") row.tracking = oneOf(row.tracking, TRACKINGS, "weight_reps");
      row[OWNER_COL[t] ?? "user_id"] = ctx.userId;
      if (t === "exercises") row.source = "custom";
      for (const k of Object.keys(row)) if (!known.has(k)) delete row[k];
      // a note or reminder limited to one routine means nothing without it: left out rather than made unlimited
      if (row.scope_routine_id != null && !(await canSee("routines", row.scope_routine_id))) continue;
      for (const [c, table] of Object.entries(REFS)) if (row[c] != null && !(await canSee(table, row[c]))) row[c] = null;
      const target = targetOf(t, row);
      if (target && !(await canSee(...target))) continue;
      const oldId = typeof raw.id === "string" ? raw.id : null;
      if (oldId) {
        if (await canSee(t, row.id)) continue; // already here: a re-import, or a restore into the same account
        if (t === "exercises") {
          // the same exercise made by hand in this account: use it rather than making a second one
          const same = (await q.query<IdRow>("SELECT id FROM exercises WHERE lower(name) = lower($1) AND NOT archived ORDER BY owner_id IS NULL LIMIT 1", [String(row.name ?? "")])).rows[0];
          if (same) { map.set(oldId, same.id); seen.add(same.id); continue; }
        }
      }
      // a day's block of Health Connect records (M-238) already here: the file's records are added to it by id
      if (t === "health_records" && mode !== "replace") { n += await mergeBlock(q, ctx.userId, row); continue; }
      let ok = await insert(row);
      if (!ok && oldId && isUuid(oldId)) {
        // another account on this server has this id (a copy into a second account): a new id, the same one each time,
        // so importing the file again finds it and adds nothing twice
        const nid = await ownCopyId(q, ctx.userId, oldId);
        map.set(oldId, nid); row.id = nid;
        if (await canSee(t, nid)) continue;
        ok = await insert(row);
      }
      if (ok && typeof row.id === "string") { seen.add(row.id); (added[t] ??= []).push(row.id); }
      n += ok;
    }
    counts[t] = n;
  }
  // what the migrations since an older file did to existing rows, done to the rows it brought, in the migrations' order
  const here = (id: unknown) => (typeof id === "string" ? map.get(id) ?? id : null);
  const showing = (ids: string[] | undefined, since: readonly [number, string], oldForm: Set<string | null>) =>
    !ids ? [] : madeBefore(data, since) ? ids : data.schema === undefined ? ids.filter((id) => oldForm.has(id)) : [];
  // History from before 016 kept whole exercises ("exercise", "prefill") rather than their names and muscles
  const oldHistory = new Set<string | null>((Array.isArray(data.tables.routine_versions) ? data.tables.routine_versions : [])
    .filter((v: any) => Array.isArray(v?.snapshot?.exercises) && v.snapshot.exercises.some((e: any) => e && typeof e === "object" && ("exercise" in e || "prefill" in e || !("primary" in e))))
    .map((v: any) => here(v.routine_id)));
  // sets from before 022 carried the rep range themselves
  const oldRanges = new Set<string | null>((Array.isArray(data.tables.routine_sets) ? data.tables.routine_sets : [])
    .filter((x: any) => x && (x.reps_max != null || x.start_reps != null)).map((x: any) => here(x.routine_exercise_id)));
  const history = showing(added.routines, SINCE.history, oldHistory), ranges = showing(added.routine_exercises, SINCE.repRange, oldRanges);
  if (history.length) await q.exec(historyNow(history));
  if (ranges.length) await q.exec(repRangeMove(ranges));
  // the goals the app once made have ids from the account the file was made in: found by that id, or in a file without
  // it by their id (not a v7 one, which every goal made by hand has) and what they count
  const unpin = settingsWritten && madeBefore(data, SINCE.homePins), titles = !!added.goals && madeBefore(data, SINCE.goalTitles);
  if (unpin || titles) {
    const goals: any[] = Array.isArray(data.tables.goals) ? data.tables.goals : [];
    const fileUser = typeof data.user?.id === "string" && isUuid(data.user.id) ? data.user.id : null;
    const pick = async (key: string, looks: (g: any) => boolean) => {
      if (fileUser) return (await q.query<IdRow>("SELECT md5($1 || ':' || $2)::uuid::text AS id", [fileUser, key])).rows[0]!.id;
      return goals.find((g) => g && typeof g.id === "string" && isUuid(g.id) && !madeAsV7(g.id) && looks(g))?.id ?? null;
    };
    const fileIds: SeededGoals = {
      weekly: await pick("weekly-target", (g) => g.scope === "activity" && g.metric === "sessions" && g.period === "week"),
      steps: await pick("daily-steps", (g) => g.scope === "activity" && g.scope_id == null && g.metric === "steps_avg" && g.period === "day"),
    };
    // pins in the file's settings name the file's ids; the goals themselves may have been given new ones here
    if (unpin) await q.exec(unpinSeededGoals(fileIds));
    if (titles) await q.exec(clearAutoTitles(added.goals!, { weekly: here(fileIds.weekly), steps: here(fileIds.steps) }));
  }
  // a session's time in the import log (046), kept after a deletion so the same session from a second app stays out:
  // filled in from its activity as 046 did, for the entries of a file from before it (only entries still without one)
  if (Array.isArray(data.tables.health_imports) && data.tables.health_imports.length && madeBefore(data, SINCE.sessionSpans))
    await q.exec(`UPDATE health_imports h SET span_start = a.started_at, span_end = a.ended_at FROM activities a
      WHERE h.kind = 'activity' AND h.span_start IS NULL AND a.id::text = h.ref`);
  // a replace deletes only the rows this copy had: a device's copy that holds a row it never got here (one refused
  // when sent, M-257) would keep it beside the restored ones, so every device makes its copy again (modules/sync.ts pull)
  if (mode === "replace") await q.query(`INSERT INTO sync_resets (user_id, seq) SELECT $1, coalesce(max(seq), 0) FROM sync_log
    ON CONFLICT (user_id) DO UPDATE SET seq = EXCLUDED.seq`, [ctx.userId]);
  ctx.changed("everything");
  return counts;
}

// ----- CSV -----

function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, "");
  const firstLine = t.split(/\r?\n/, 1)[0] ?? "";
  const delim = (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? "\t" : (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

const csvCell = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

interface ImportedSet { workoutKey: string; workoutName: string; start: string; end: string | null; exercise: string; order: number; kind: string; weightKg: number | null; reps: number | null; distanceM: number | null; durationS: number | null; rpe: number | null; notes: string; workoutNotes: string; superset?: string | null }

function parseNum(v: string | undefined): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v.trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function parseDate(v: string): string | null {
  if (!v) return null;
  let d = new Date(v.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) d = new Date(v.replace(",", ""));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function parseDur(v: string | undefined): number | null {
  if (!v) return null;
  const m = /^(\d+):(\d+)(?::(\d+))?$/.exec(v.trim());
  if (m) return m[3] ? +m[1]! * 3600 + +m[2]! * 60 + +m[3]! : +m[1]! * 60 + +m[2]!;
  const h = /(\d+)\s*h/.exec(v)?.[1], mi = /(\d+)\s*m(?!s)/.exec(v)?.[1], s = /(\d+)\s*s/.exec(v)?.[1];
  if (h || mi || s) return (+(h ?? 0)) * 3600 + (+(mi ?? 0)) * 60 + (+(s ?? 0));
  return parseNum(v);
}

/** Recognises Strong, Hevy and FitNotes exports by their headers. */
function readWorkoutCsv(text: string): { format: string; sets: ImportedSet[] } {
  const rows = parseCsv(text);
  if (rows.length < 2) throw bad("The file is empty");
  const head = rows[0]!.map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => names.map((n) => head.indexOf(n)).find((i) => i >= 0) ?? -1;
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const sets: ImportedSet[] = [];
  if (head.includes("exercise_title")) { // Hevy
    const lb = head.includes("weight_lbs"), mi = head.includes("distance_miles");
    const c = { title: col("title"), start: col("start_time"), end: col("end_time"), desc: col("description"), ex: col("exercise_title"), ss: col("superset_id"), exNotes: col("exercise_notes"),
      idx: col("set_index"), type: col("set_type"), w: col("weight_kg", "weight_lbs"), reps: col("reps"), dist: col("distance_km", "distance_miles"), dur: col("duration_seconds"), rpe: col("rpe") };
    for (const r of rows.slice(1)) {
      const start = parseDate(get(r, c.start)); if (!start) continue;
      const w = parseNum(get(r, c.w)), d = parseNum(get(r, c.dist));
      const type = get(r, c.type);
      sets.push({ workoutKey: start + get(r, c.title), workoutName: get(r, c.title) || "Workout", start, end: parseDate(get(r, c.end)), exercise: get(r, c.ex), order: parseNum(get(r, c.idx)) ?? 0,
        kind: type === "warmup" ? "warmup" : type === "dropset" ? "drop" : type === "failure" ? "failure" : "normal",
        weightKg: w == null ? null : lb ? w * 0.45359237 : w, reps: parseNum(get(r, c.reps)), distanceM: d == null ? null : d * (mi ? 1609.344 : 1000), durationS: parseNum(get(r, c.dur)),
        rpe: parseNum(get(r, c.rpe)), notes: get(r, c.exNotes), workoutNotes: get(r, c.desc), superset: get(r, c.ss) || null });
    }
    return { format: "Hevy", sets };
  }
  if (head.includes("exercise name") && head.includes("set order")) { // Strong
    const c = { date: col("date"), name: col("workout name"), dur: col("duration", "workout duration"), ex: col("exercise name"), order: col("set order"), w: col("weight"), unit: col("weight unit"),
      reps: col("reps"), dist: col("distance"), distUnit: col("distance unit"), secs: col("seconds"), notes: col("notes"), wnotes: col("workout notes"), rpe: col("rpe") };
    for (const r of rows.slice(1)) {
      const start = parseDate(get(r, c.date)); if (!start) continue;
      const dur = parseDur(get(r, c.dur));
      const order = get(r, c.order);
      const w = parseNum(get(r, c.w)), unit = get(r, c.unit).toLowerCase();
      const d = parseNum(get(r, c.dist)), du = get(r, c.distUnit).toLowerCase();
      sets.push({ workoutKey: start + get(r, c.name), workoutName: get(r, c.name) || "Workout", start, end: dur ? new Date(new Date(start).getTime() + dur * 1000).toISOString() : null,
        exercise: get(r, c.ex), order: parseNum(order) ?? 0, kind: /^w/i.test(order) ? "warmup" : /^d/i.test(order) ? "drop" : /^f/i.test(order) ? "failure" : "normal",
        weightKg: w == null ? null : /lb/.test(unit) ? w * 0.45359237 : w, reps: parseNum(get(r, c.reps)), distanceM: d == null || d === 0 ? null : /mi/.test(du) ? d * 1609.344 : /km/.test(du) ? d * 1000 : d,
        durationS: parseNum(get(r, c.secs)) || null, rpe: parseNum(get(r, c.rpe)), notes: get(r, c.notes), workoutNotes: get(r, c.wnotes) });
    }
    return { format: "Strong", sets };
  }
  if (head.includes("exercise") && head.includes("category") && head.includes("date")) { // FitNotes
    const c = { date: col("date"), ex: col("exercise"), w: col("weight (kg)", "weight (lbs)", "weight"), reps: col("reps"), dist: col("distance"), du: col("distance unit"), time: col("time"), comment: col("comment") };
    const lb = head.includes("weight (lbs)");
    const order = new Map<string, number>();
    for (const r of rows.slice(1)) {
      const day = get(r, c.date); const start = parseDate(day + "T12:00:00"); if (!start) continue;
      const k = day + get(r, c.ex); order.set(k, (order.get(k) ?? 0) + 1);
      const w = parseNum(get(r, c.w)), d = parseNum(get(r, c.dist)), du = get(r, c.du).toLowerCase();
      sets.push({ workoutKey: day, workoutName: "Workout", start, end: null, exercise: get(r, c.ex), order: order.get(k)!, kind: "normal", weightKg: w == null ? null : lb ? w * 0.45359237 : w,
        reps: parseNum(get(r, c.reps)), distanceM: d == null || d === 0 ? null : /mi/.test(du) ? d * 1609.344 : /km/.test(du) ? d * 1000 : d, durationS: parseDur(get(r, c.time)), rpe: null, notes: get(r, c.comment), workoutNotes: "" });
    }
    return { format: "FitNotes", sets };
  }
  throw bad("Unrecognised file. Motus reads exports from Strong, Hevy and FitNotes.");
}

const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, (m) => " " + m.slice(1, -1) + " ").replace(/[^a-z0-9]+/g, " ").trim();
async function matchNames(q: Sql, names: string[]) {
  const { rows } = await q.query("SELECT id, name, aliases, equipment FROM exercises WHERE NOT archived");
  const exact = new Map<string, any>();
  for (const r of rows) { exact.set(norm(r.name), r); for (const a of r.aliases ?? []) exact.set(norm(a), r); }
  return names.map((n) => {
    const k = norm(n);
    let m = exact.get(k);
    if (!m) {
      // "Bench Press (Barbell)" ≈ "Barbell Bench Press": same words in any order
      const words = new Set(k.split(" "));
      let best: any = null, score = 0;
      for (const r of rows) {
        const w = norm(r.name).split(" ");
        const hit = w.filter((x) => words.has(x)).length;
        const s = hit / Math.max(words.size, w.length);
        if (s > score) { score = s; best = r; }
      }
      if (score >= 0.75) m = best;
    }
    return { name: n, match: m ? { id: m.id, name: m.name } : null };
  });
}

export function dataRoutes(r: Router) {
  r.get("/export", async (ctx, _p, _b, qs) => exportAll(ctx.q, ctx.userId, qs.parts));
  r.post("/import", async (ctx, _p, b) => importAll(ctx, b.data, oneOf(b.mode, ["replace", "merge"], "merge")));
  r.post("/import/preview", async (_ctx, _p, b) => {
    const d = b.data;
    if (!d || d.app !== "motus") throw bad("This is not a Motus export");
    fileSchema(d);
    // the app sends only the file's head (apps/web core/backup.ts fileHead): counts for tables, workouts' start times
    const counts = Object.fromEntries(Object.entries(d.tables ?? {}).map(([k, v]) => [k, typeof v === "number" ? v : Array.isArray(v) ? v.length : 0]));
    const dates = (Array.isArray(d.tables?.workouts) ? d.tables.workouts : []).map((w: any) => w?.started_at).filter(Boolean).sort();
    return { exportedAt: d.exportedAt, format: d.format, parts: readParts(d.parts), whole: readParts(d.parts).length === PARTS.length, counts, settings: !!d.settings, from: dates[0] ?? null, to: dates.at(-1) ?? null };
  });

  r.get("/export/csv", async ({ q }, _p, _b, qs) => {
    if (qs.what === "activities") {
      const { rows } = await q.query("SELECT started_at, type, name, duration_s, distance_m, steps, elevation_m, notes FROM activities ORDER BY started_at");
      return { filename: "motus-activities.csv", text: ["Date,Type,Name,Duration (s),Distance (m),Steps,Elevation (m),Notes", ...rows.map((x: any) => [x.started_at, x.type, x.name, x.duration_s, x.distance_m, x.steps, x.elevation_m, x.notes].map(csvCell).join(","))].join("\n") };
    }
    if (qs.what === "body") {
      const { rows } = await q.query("SELECT measured_at, kind, value, note FROM body_metrics ORDER BY measured_at");
      return { filename: "motus-body.csv", text: ["Date,Kind,Value,Note", ...rows.map((x: any) => [x.measured_at, x.kind, x.value, x.note].map(csvCell).join(","))].join("\n") };
    }
    // workouts in Strong's layout, which most other apps can import
    const { rows } = await q.query(
      `SELECT w.started_at, w.name, extract(epoch FROM w.ended_at - w.started_at)::int - w.paused_s AS dur, e.name AS ex, s.position, s.kind, s.weight_kg, s.reps, s.distance_m, s.duration_s, s.rpe, w.notes
       FROM workout_sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id JOIN workouts w ON w.id = we.workout_id JOIN exercises e ON e.id = we.exercise_id
       WHERE w.status = 'completed' AND s.done ORDER BY w.started_at, we.position, s.position`);
    const head = "Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE";
    const fmtDur = (s: number) => `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
    const lines = rows.map((x: any) => [x.started_at.slice(0, 19).replace("T", " "), x.name, fmtDur(x.dur ?? 0), x.ex, x.kind === "warmup" ? "W" : x.kind === "drop" ? "D" : x.kind === "failure" ? "F" : x.position + 1,
      x.weight_kg ?? 0, x.reps ?? 0, x.distance_m ?? 0, x.duration_s ?? 0, "", x.notes, x.rpe ?? ""].map(csvCell).join(","));
    return { filename: "motus-workouts.csv", text: [head, ...lines].join("\n") };
  });

  r.post("/import/csv/preview", async ({ q }, _p, b) => {
    const { format, sets } = readWorkoutCsv(String(b.text ?? ""));
    const names = [...new Set(sets.map((s) => s.exercise).filter(Boolean))];
    const workouts = new Set(sets.map((s) => s.workoutKey)).size;
    const dates = sets.map((s) => s.start).sort();
    return { format, workouts, sets: sets.length, from: dates[0], to: dates.at(-1), exercises: await matchNames(q, names) };
  });
  // mapping: { "Bench Press (Barbell)": "<exercise id>" | "new" }
  r.post("/import/csv", async (ctx, _p, b) => {
    const { format, sets } = readWorkoutCsv(String(b.text ?? ""));
    const mapping: Record<string, string> = b.mapping ?? {};
    const auto = new Map((await matchNames(ctx.q, [...new Set(sets.map((s) => s.exercise))])).map((m) => [m.name, m.match?.id]));
    const exId = new Map<string, string>();
    for (const name of new Set(sets.map((s) => s.exercise))) {
      const want = mapping[name];
      if (want && want !== "new" && isUuid(want)) { exId.set(name, want); continue; }
      if (!want && auto.get(name)) { exId.set(name, auto.get(name)!); continue; }
      const nid = uuidv7();
      const timed = sets.some((s) => s.exercise === name && s.durationS && !s.reps);
      const dist = sets.some((s) => s.exercise === name && s.distanceM);
      await ctx.q.query("INSERT INTO exercises (id, owner_id, source, name, tracking) VALUES ($1,$2,'custom',$3,$4)", [nid, ctx.userId, name, dist ? "distance_duration" : timed ? "duration" : "weight_reps"]);
      exId.set(name, nid);
    }
    const byWorkout = new Map<string, ImportedSet[]>();
    for (const s of sets) byWorkout.set(s.workoutKey, [...(byWorkout.get(s.workoutKey) ?? []), s]);
    let created = 0;
    for (const [key, list] of byWorkout) {
      const first = list[0]!;
      const clientId = `csv:${format}:${key}`.slice(0, 80);
      if ((await ctx.q.query("SELECT 1 FROM workouts WHERE client_id = $1", [clientId])).rows.length) continue; // imported before
      const wid = uuidv7();
      const end = first.end ?? new Date(new Date(first.start).getTime() + 3600000).toISOString();
      await ctx.q.query("INSERT INTO workouts (id, user_id, name, status, started_at, ended_at, notes, source, client_id) VALUES ($1,$2,$3,'completed',$4,$5,$6,'import',$7)",
        [wid, ctx.userId, first.workoutName, first.start, end, first.workoutNotes, clientId]);
      const exOrder: string[] = [];
      for (const s of list) if (!exOrder.includes(s.exercise)) exOrder.push(s.exercise);
      for (const [pos, name] of exOrder.entries()) {
        const weId = uuidv7();
        const exSets = list.filter((s) => s.exercise === name);
        await ctx.q.query("INSERT INTO workout_exercises (id, user_id, workout_id, exercise_id, position, status, superset) VALUES ($1,$2,$3,$4,$5,'done',$6)",
          [weId, ctx.userId, wid, exId.get(name), pos, exSets[0]?.superset ?? null]);
        for (const [i, s] of exSets.entries())
          await ctx.q.query(
            `INSERT INTO workout_sets (id, user_id, workout_exercise_id, position, kind, weight_kg, reps, duration_s, distance_m, rpe, done, done_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11)`,
            [uuidv7(), ctx.userId, weId, i, s.kind, s.weightKg == null ? null : Math.round(s.weightKg * 100) / 100, s.reps, s.durationS, s.distanceM, s.rpe, end]);
        const note = exSets.map((s) => s.notes).find(Boolean);
        if (note) await ctx.q.query("INSERT INTO notes (id, user_id, target_type, target_id, body, workout_id) VALUES ($1,$2,'workout_exercise',$3,$4,$5)", [uuidv7(), ctx.userId, weId, note, wid]);
      }
      created++;
    }
    ctx.changed("everything");
    return { format, workouts: created };
  });
}

/** What an exercise_prefs.timed switch from an older backup stands for, as 024_exercise_tracking turned it into tracking:
 * timed for a reps exercise is time (with weight if it had weight), untimed for a timed one is reps; otherwise its own. */
async function timedTracking(q: Sql, exerciseId: unknown, timed: boolean): Promise<string | null> {
  if (typeof exerciseId !== "string" || !isUuid(exerciseId)) return null;
  const own = (await q.query<{ tracking: string }>("SELECT tracking FROM exercises WHERE id = $1", [exerciseId])).rows[0]?.tracking;
  if (timed) return own === "weight_reps" || own === "bodyweight_reps" ? "weight_duration" : own === "assisted" || own === "reps_only" ? "duration" : null;
  return own === "weight_duration" ? "weight_reps" : own === "duration" ? "reps_only" : null;
}
