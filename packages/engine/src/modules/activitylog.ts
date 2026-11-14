// The activity log (Settings → Activity log): what changed in your data, and when. It is read from sync_log
// (migration 004), which the database writes for every change to a person's rows, so nothing has to remember to log.
// Row changes become plain entries ("Finished Push day", "Logged 18 sets in Push day"): rows belong to a thing
// (a set to its workout, a routine's sets to the routine), and a burst of changes to one thing is one entry.
import type { Goal } from "@motus/shared";
import type { Router } from "../router";
import { camel, intOrNull, str } from "../util";
import { getSettings } from "./settings";
import { withTitles } from "./goals";

type LogKind = "workout" | "routine" | "exercise" | "goal" | "body" | "note" | "reminder" | "schedule" | "folder" | "program" | "activity" | "activity_type" | "settings" | "daily";
interface LogEntry {
  kind: LogKind; action: "created" | "changed" | "deleted" | "started" | "finished" | "logged" | "achieved" | "done";
  text: string; detail: string; name: string | null; at: string; from: string; changes: number;
  /** where to open it, while it still exists */
  open: { kind: string; id: string; live?: boolean } | null;
  /** the device whose offline copy made the change ("" = made on the server or in this app directly) */
  origin: string;
}
interface Raw { seq: number; tbl: string; pk: any; op: "upsert" | "delete"; at: string; atText: string; origin: string }
interface Group { kind: LogKind; id: string | null; first: number; last: number; rows: Raw[] }

// the thing each table's rows are; children are found through their parent below
const OWN: Record<string, LogKind> = {
  workouts: "workout", routines: "routine", exercises: "exercise", goals: "goal", body_metrics: "body", notes: "note", reminders: "reminder",
  schedules: "schedule", folders: "folder", programs: "program", activities: "activity", activity_types: "activity_type", user_settings: "settings", daily_logs: "daily",
};
const CHILD: Record<string, LogKind> = { workout_exercises: "workout", workout_sets: "workout", routine_exercises: "routine", routine_sets: "routine", routine_versions: "routine", schedule_exceptions: "schedule", exercise_prefs: "exercise" };
const TABLE = Object.fromEntries(Object.entries(OWN).map(([t, k]) => [k, t])) as Record<LogKind, string>;
// the current state of each thing, for its name and whether it was finished, reached, ticked off…
const NOW: Partial<Record<LogKind, string>> = {
  workout: "SELECT id, name, status, started_at, ended_at FROM workouts WHERE id = ANY($1::uuid[])",
  routine: "SELECT id, name, deleted_at FROM routines WHERE id = ANY($1::uuid[])",
  exercise: "SELECT id, name FROM exercises WHERE id = ANY($1::uuid[])",
  // a goal's name is worked out below (withTitles): the stored title is only a name the person gave it
  goal: "SELECT * FROM goals WHERE id = ANY($1::uuid[])",
  body: "SELECT id, kind FROM body_metrics WHERE id = ANY($1::uuid[])",
  note: "SELECT id, body AS name, target_type, target_id, workout_id FROM notes WHERE id = ANY($1::uuid[])",
  reminder: "SELECT id, body AS name, status, done_at, target_type, target_id FROM reminders WHERE id = ANY($1::uuid[])",
  schedule: "SELECT s.id, coalesce(r.name, s.activity_type) AS name, s.routine_id IS NULL AS act FROM schedules s LEFT JOIN routines r ON r.id = s.routine_id WHERE s.id = ANY($1::uuid[])",
  folder: "SELECT id, name FROM folders WHERE id = ANY($1::uuid[])",
  program: "SELECT id, name FROM programs WHERE id = ANY($1::uuid[])",
  activity: "SELECT a.id, coalesce(nullif(a.name, ''), t.name, a.type) AS name, a.type FROM activities a LEFT JOIN activity_types t ON t.slug = a.type WHERE a.id = ANY($1::uuid[])",
  activity_type: "SELECT id, name FROM activity_types WHERE id = ANY($1::uuid[])",
};
// [noun, said when added, said when deleted]
const WORDS: Record<LogKind, [string, string, string]> = {
  workout: ["workout", "Started", "Deleted a workout"], routine: ["routine", "Created routine", "Deleted a routine"], exercise: ["exercise", "Added exercise", "Deleted an exercise"],
  goal: ["goal", "Set the goal", "Deleted a goal"], body: ["body entry", "Logged", "Deleted a body entry"], note: ["note", "Added a note", "Deleted a note"],
  reminder: ["reminder", "Added a reminder", "Deleted a reminder"], schedule: ["plan", "Planned", "Removed a plan"], folder: ["folder", "Created folder", "Deleted a folder"],
  program: ["program", "Created program", "Deleted a program"], activity: ["activity", "Logged", "Deleted an activity"], activity_type: ["activity type", "Added activity type", "Removed an activity type"],
  settings: ["settings", "Changed settings", "Changed settings"], daily: ["daily log", "Logged", "Removed"],
};
const PAGE = 1500;
const BURST = 3 * 3600_000; // changes to one thing this close together are one entry (a whole workout's sets)
const NEAR = 10 * 60_000; // a deleted child row can't be traced to its parent: it joins whatever of its kind changed with it
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const snip = (s: string | null | undefined) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t ? (t.length > 60 ? t.slice(0, 57) + "…" : t) : null; };
// a daily log kind's plain name (its id carries the unit: sleep_h, distance_m)
const NAMES: Record<string, string> = {
  weight: "body weight", sleep_h: "sleep", water_ml: "water", distance_m: "distance", active_kcal: "active calories",
  resting_hr: "resting heart rate", spo2: "blood oxygen", hrv: "HRV", vo2max: "VO2 max", body_fat: "body fat",
};
const label = (k: string) => NAMES[k] ?? k.replace(/_/g, " ");

export function activityLogRoutes(r: Router) {
  r.get("/activity-log", async ({ q, userId }, _p, _b, qs) => {
    const limit = intOrNull(qs.limit, 1, 100) ?? 40;
    // the cursor is the last row shown: its exact time (as the database wrote it) and its number
    const [cAt, cSeq] = str(qs.before, 80).split("|");
    const after = cAt && cSeq && Number.isFinite(Number(cSeq)) && !Number.isNaN(Date.parse(cAt));
    const raw: Raw[] = (await q.query(
      `SELECT seq, tbl, pk, op, at, at::text AS at_text, origin FROM sync_log ${after ? "WHERE (at, seq) < ($1::timestamptz, $2::bigint)" : ""}
       ORDER BY at DESC, seq DESC LIMIT ${PAGE}`, after ? [cAt, Number(cSeq)] : [])).rows.map((x: any) => ({ ...x, seq: Number(x.seq), atText: x.at_text }));
    if (!raw.length) return { entries: [], cursor: null };

    // children → the thing they belong to (while they exist)
    const parent = new Map<string, string>(), doneSets = new Set<string>();
    const idsOf = (t: string) => [...new Set(raw.filter((x) => x.tbl === t && x.op === "upsert").map((x) => String(x.pk.id)))];
    const look = async (t: string, sql: string) => { const list = idsOf(t); return list.length ? (await q.query(sql, [list])).rows : []; };
    for (const x of await look("workout_exercises", "SELECT id, workout_id AS p FROM workout_exercises WHERE id = ANY($1::uuid[])")) parent.set(x.id, x.p);
    for (const x of await look("workout_sets", "SELECT s.id, we.workout_id AS p, s.done FROM workout_sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id WHERE s.id = ANY($1::uuid[])")) { parent.set(x.id, x.p); if (x.done) doneSets.add(x.id); }
    for (const x of await look("routine_exercises", "SELECT id, routine_id AS p FROM routine_exercises WHERE id = ANY($1::uuid[])")) parent.set(x.id, x.p);
    for (const x of await look("routine_sets", "SELECT s.id, re.routine_id AS p FROM routine_sets s JOIN routine_exercises re ON re.id = s.routine_exercise_id WHERE s.id = ANY($1::uuid[])")) parent.set(x.id, x.p);
    for (const x of await look("routine_versions", "SELECT id, routine_id AS p FROM routine_versions WHERE id = ANY($1::uuid[])")) parent.set(x.id, x.p);
    const subject = (x: Raw): [LogKind, string | null] | null => {
      if (OWN[x.tbl]) return [OWN[x.tbl]!, x.tbl === "user_settings" ? "me" : x.tbl === "daily_logs" ? String(x.pk.kind) : String(x.pk.id)];
      if (!CHILD[x.tbl]) return null;
      return [CHILD[x.tbl]!, x.tbl === "schedule_exceptions" ? String(x.pk.schedule_id) : x.tbl === "exercise_prefs" ? String(x.pk.exercise_id) : parent.get(String(x.pk.id)) ?? null];
    };

    // newest first: each row joins the latest entry for the same thing that is close enough in time
    const groups: Group[] = [];
    raw.forEach((x, i) => {
      const s = subject(x); if (!s) return;
      const [kind, sid] = s, t = Date.parse(x.at);
      const g = groups.find((g) => {
        const gap = Date.parse(g.rows.at(-1)!.at) - t;
        return g.kind === kind && (sid != null && g.id === sid ? gap <= BURST : (g.id == null || sid == null) && gap <= NEAR);
      });
      if (g) { g.rows.push(x); g.last = i; g.id ??= sid; } else groups.push({ kind, id: sid, first: i, last: i, rows: [x] });
    });
    if (!groups.length) return { entries: [], cursor: null };

    // a page ends between entries: the oldest one may carry on in the next rows, so it waits for the next page,
    // and every entry with a row newer than the cut is kept so that none is split or skipped
    const more = raw.length === PAGE;
    let keep = groups.slice().sort((a, b) => a.first - b.first);
    if (more && keep.length > 1) keep = keep.filter((g) => g.last !== raw.length - 1);
    keep = keep.slice(0, limit);
    for (;;) {
      const floor = Math.max(...keep.map((g) => g.last));
      const add = groups.filter((g) => !keep.includes(g) && g.first < floor);
      if (!add.length) break;
      keep.push(...add);
    }
    keep.sort((a, b) => a.first - b.first);
    const floor = Math.max(...keep.map((g) => g.last));
    const cursor = more || keep.length < groups.length ? `${raw[floor]!.atText}|${raw[floor]!.seq}` : null;

    // what each thing is now, and whether this entry is where it was first written
    const cur = new Map<string, any>(), firstSeq = new Map<string, number>();
    for (const [k, sql] of Object.entries(NOW) as [LogKind, string][]) {
      const list = [...new Set(keep.filter((g) => g.kind === k && g.id).map((g) => g.id!))];
      if (!list.length) continue;
      let rows = (await q.query<{ id: string; [col: string]: unknown }>(sql, [list])).rows;
      if (k === "goal") rows = (await withTitles(q, await getSettings(q, userId), rows.map((x) => camel<Goal>(x))))
        .map((g) => ({ id: g.id, name: g.title, status: g.status, achieved_at: g.achievedAt }));
      for (const x of rows) cur.set(k + ":" + x.id, x);
      for (const x of (await q.query(`SELECT pk->>'id' AS id, min(seq) AS s FROM sync_log WHERE tbl = $1 AND pk = ANY($2::text[]::jsonb[]) GROUP BY 1`,
        [TABLE[k], list.map((id) => JSON.stringify({ id }))])).rows) firstSeq.set(k + ":" + x.id, Number(x.s));
    }
    // a daily value that Health Connect brought in is said so; one typed in is just logged
    const imported = new Set<Group>();
    const dailyRows = keep.filter((g) => g.kind === "daily").flatMap((g) => g.rows.filter((x) => x.op === "upsert" && x.pk.date).map((x) => ({ g, kind: String(x.pk.kind), date: String(x.pk.date).slice(0, 10) })));
    if (dailyRows.length) {
      const src = new Map((await q.query("SELECT kind, to_char(date, 'YYYY-MM-DD') AS d, source FROM daily_logs WHERE kind = ANY($1::text[]) AND date = ANY($2::date[])",
        [[...new Set(dailyRows.map((x) => x.kind))], [...new Set(dailyRows.map((x) => x.date))]])).rows.map((x: any) => [`${x.kind}|${x.d}`, x.source as string]));
      for (const g of new Set(dailyRows.map((x) => x.g))) if (dailyRows.filter((x) => x.g === g).every((x) => src.get(`${x.kind}|${x.date}`) === "health_connect")) imported.add(g);
    }
    const entries = keep.map((g) => describe(g, g.id ? cur.get(g.kind + ":" + g.id) : null, g.id ? firstSeq.get(g.kind + ":" + g.id) : undefined, doneSets, imported.has(g)));
    return { entries, cursor };
  });
}

function describe(g: Group, now: any, firstSeq: number | undefined, doneSets: Set<string>, fromHealth = false): LogEntry {
  const main = g.rows.filter((x) => x.tbl === TABLE[g.kind]);
  const created = main.some((x) => x.op === "upsert" && x.seq === firstSeq);
  const deleted = !!NOW[g.kind] && main.some((x) => x.op === "delete") && !now;
  const to = g.rows[0]!.at, from = g.rows.at(-1)!.at;
  const within = (iso: string | null | undefined) => !!iso && Date.parse(iso) >= Date.parse(from) - 120_000 && Date.parse(iso) <= Date.parse(to) + 120_000;
  const name: string | null = g.kind === "settings" ? null : g.kind === "daily" ? label(String(g.id)) : snip(now?.name);
  const [noun, added, gone] = WORDS[g.kind];
  const e: LogEntry = { kind: g.kind, action: "changed", text: "", detail: "", name, at: to, from, changes: g.rows.length, open: null, origin: g.rows[0]!.origin };
  const say = (action: LogEntry["action"], text: string, detail = "") => Object.assign(e, { action, text, detail });
  const n = name ?? `a ${noun}`;
  if (deleted) say("deleted", gone);
  else if (g.kind === "workout") {
    const sets = new Set(g.rows.filter((x) => x.tbl === "workout_sets" && doneSets.has(String(x.pk.id))).map((x) => x.pk.id)).size;
    const detail = sets ? plural(sets, "set") : "";
    if (created && now?.status === "completed" && Date.parse(now.started_at) < Date.parse(from) - NEAR) say("logged", `Logged a past workout: ${n}`, detail);
    else if (now?.status === "completed" && within(now.ended_at)) say("finished", `Finished ${n}`, detail);
    else if (created) say("started", `Started ${n}`, detail);
    else if (sets) say("logged", `Logged ${plural(sets, "set")} in ${n}`);
    else say("changed", `Changed ${n}`);
  } else if (g.kind === "routine" && now?.deleted_at) say("deleted", `Deleted routine ${n}`);
  else if (g.kind === "goal" && now?.status === "achieved" && within(now.achieved_at)) say("achieved", `Reached goal: ${n}`);
  else if (g.kind === "reminder" && now?.status !== "pending" && within(now?.done_at)) say("done", now.status === "done" ? "Ticked off a reminder" : "Dismissed a reminder", n);
  else if (g.kind === "body") {
    const count = new Set(g.rows.map((x) => x.pk.id)).size;
    say(created ? "logged" : "changed", count > 1 ? `${created ? "Logged" : "Changed"} ${count} body entries` : `${created ? "Logged" : "Changed"} ${label(String(now?.kind ?? "body entry"))}`);
  } else if (g.kind === "daily") {
    const removed = main.every((x) => x.op === "delete");
    say(main.some((x) => x.op === "delete") ? "deleted" : "logged", removed ? `${gone} ${n} data` : fromHealth ? `Imported ${n} from Health Connect` : `${added} ${n}`);
  }
  else if (g.kind === "settings") say("changed", "Changed settings");
  else if (g.kind === "exercise" && !main.length) say("changed", `Changed settings for ${n}`);
  else if (g.kind === "note" || g.kind === "reminder") say(created ? "created" : "changed", created ? added : `Changed a ${noun}`, name ?? "");
  else if (g.kind === "schedule") say(created ? "created" : "changed", !name ? (created ? "Planned a workout" : "Changed a plan (deleted since)") : created ? (now?.act ? `Planned a ${name.toLowerCase()} session` : `${added} ${name}`) : `Changed the plan for ${name}`);
  else if (g.kind === "goal") say(created ? "created" : "changed", created ? (name ? `${added} ${name}` : "Set a goal") : `Changed goal: ${n}`);
  // a thing with no name left was deleted since: "a routine" would read as "Changed routine a routine"
  else if (!name) say(created ? (g.kind === "activity" ? "logged" : "created") : "changed", `${created ? (g.kind === "activity" ? "Logged" : g.kind === "exercise" || g.kind === "activity_type" ? "Added" : "Created") : "Changed"} ${/^[aeiou]/.test(noun) ? "an" : "a"} ${noun} (deleted since)`);
  else say(created ? (g.kind === "activity" ? "logged" : "created") : "changed", created ? `${added} ${n}` : `Changed ${g.kind === "activity" ? n : `${noun} ${n}`}`);

  // where it can be opened
  if (now && !now.deleted_at) {
    const t = g.kind === "note" || g.kind === "reminder" ? (now.target_type === "workout_exercise" || now.target_type === "routine_exercise" ? (now.workout_id ? ["workout", now.workout_id] : null) : [now.target_type, now.target_id]) : [g.kind, g.id];
    if (t && t[1]) e.open = { kind: t[0], id: String(t[1]), ...(g.kind === "workout" && now.status === "in_progress" ? { live: true } : {}) };
  } else if (g.kind === "settings" || g.kind === "daily") e.open = { kind: g.kind, id: String(g.id) };
  return e;
}
