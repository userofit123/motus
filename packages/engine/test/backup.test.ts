// A full backup holds every table of a person's data and restores it as it was: into an empty account on another
// server (merge), over the same account (replace), and from an older backup without the newer tables and columns.
// Health data included: the import log with its deleted marks (031/034 must not mark or block anything on the way
// back), nights, heart rate days, and the daily log's source, worn and device.
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll } from "vitest";
import { createEngine, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";

let A: Engine, B: Engine;
let U: string, V: string, W: string;
const call = async (eng: Engine, user: string, method: string, path: string, body?: unknown, query?: Record<string, string>) => {
  const r = await eng.handle({ method, path, body, query, userId: user });
  if (r.status !== 200) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};

/** A table's rows in a fixed order, so two exports compare row by row. */
const key = (r: any) => String(r.id ?? `${r.date ?? ""}:${r.kind ?? ""}:${r.key ?? ""}:${r.exercise_id ?? ""}:${r.schedule_id ?? ""}`);
const sorted = (rows: any[]) => [...rows].sort((a, b) => key(a).localeCompare(key(b)));
/** Built-in exercises have other ids on another server: both files name them by their catalog id instead. */
const byCatalog = (file: any) => {
  let s = JSON.stringify(file.tables);
  for (const [id, ref] of Object.entries(file.catalogRefs as Record<string, string>)) s = s.split(id).join(ref);
  return JSON.parse(s) as Record<string, any[]>;
};
/** Every table of one export row for row as in another. */
const same = (gotFile: any, wantFile: any) => {
  const got = byCatalog(gotFile), want = byCatalog(wantFile);
  expect(Object.keys(got).sort()).toEqual(Object.keys(want).sort());
  for (const t of Object.keys(want)) expect(sorted(got[t]!), t).toEqual(sorted(want[t]!));
};

// the tables of a person's data that are not in a backup on purpose: sign-in and sync bookkeeping, live-update events,
// and uploaded files (media rows point at files on the server's disk; a backup carries the photos themselves, see below)
const NOT_DATA = new Set(["users", "sessions", "invites", "app_meta", "sync_log", "events", "media", "user_settings", "health_record_reads", "band_link_pass", "sync_resets"]); // health_record_reads: when the phone read what, filled again by its next read; band_link_pass: how far the one linking pass got, run again after a restore; sync_resets: where the last restore left the server's log (049)

let file: any;
beforeAll(async () => {
  A = await createEngine(await pgliteDb("memory://"), { mode: "server" });
  B = await createEngine(await pgliteDb("memory://"), { mode: "server" });
  U = uuidv7(); V = uuidv7(); W = uuidv7();
  await A.db.admin.query("INSERT INTO users (id, username) VALUES ($1,'u')", [U]);
  await B.db.admin.query("INSERT INTO users (id, username) VALUES ($1,'v'), ($2,'w')", [V, W]);

  // ----- one of everything -----
  const c = (method: string, path: string, body?: unknown, query?: Record<string, string>) => call(A, U, method, path, body, query);
  const lib = await c("GET", "/exercises");
  const squat = lib.find((e: any) => e.name === "Barbell Squat").id;
  const mine = (await c("POST", "/exercises", { name: "Sled Push Thing", primaryMuscles: ["quads"], images: ["media:data:image/png;base64,AAAA"] })).id;
  await c("PUT", `/exercises/${squat}/prefs`, { restS: 150, favorite: true });
  const folder = (await c("POST", "/folders", { name: "Strength" })).id;
  const routine = (await c("POST", "/routines", { name: "Day A", folderId: folder, exercises: [
    { exerciseId: squat, sets: [{ reps: 5, weightKg: 80 }, { reps: 5, weightKg: 80 }], progression: { mode: "double", repsMin: 5, repsMax: 8 } },
    { exerciseId: mine, sets: [{ reps: 10 }] }] })).id;
  await c("PUT", `/routines/${routine}`, { name: "Day A+", folderId: folder, exercises: (await c("GET", `/routines/${routine}`)).exercises }); // a version in History
  const program = (await c("POST", "/programs", { name: "Plan", weeks: [{ days: [routine] }], startDate: "2026-10-01" })).id;
  const schedule = (await c("POST", "/schedules", { routineId: routine, rule: "weekly", days: [1, 4] })).id;
  await c("POST", `/schedules/${schedule}/exception`, { date: "2026-10-05" });
  const workout = (await c("POST", "/workouts/log", { startedAt: "2026-10-02T08:00:00Z", routineId: routine, exercises: [
    { exerciseId: squat, sets: [{ reps: 5, weightKg: 82.5 }] }, { exerciseId: mine, sets: [{ reps: 10 }] }] })).id;
  await A.db.admin.query("UPDATE workouts SET avg_hr = 121, max_hr = 160, hr = '[[1759392000, 110], [1759392060, 130]]', program_id = $2 WHERE id = $1", [workout, program]);
  await c("POST", "/activity-types", { name: "Kayak Polo", icon: "activity", hasDistance: true });
  const walk = (await c("POST", "/activities", { type: "walk", startedAt: "2026-10-03T09:00:00Z", durationS: 1800, distanceM: 2500, steps: 3100 })).id;
  await A.db.admin.query("UPDATE activities SET steps_source = 'band', steps_app = 2900, avg_hr = 101, max_hr = 120, hr = '[[1759482000, 98]]' WHERE id = $1", [walk]);
  await c("POST", "/notes", { targetType: "exercise", targetId: squat, body: "Knees out" });
  await c("POST", "/notes", { targetType: "activity", targetId: walk, body: "Windy" });
  await c("POST", "/reminders", { targetType: "exercise", targetId: squat, body: "Go deeper", scopeRoutineId: routine });
  await c("POST", "/goals", { title: "Squat more", scope: "exercise", scopeId: squat, metric: "max_weight", target: 100, period: "once" });
  await c("POST", "/body", { kind: "waist", value: 82, measuredAt: "2026-10-01T07:00:00Z" });
  await c("PUT", "/settings", { units: { system: "imperial", weight: "lb", distance: "mi", length: "in" } });
  // the band: days (steps from the phone alone: not worn), a night, heart rate through a day, a weight, a session
  await c("POST", "/health/import", {
    steps: [{ date: "2026-10-01", value: 8000 }, { date: "2026-10-02", value: 4000, worn: false }, { date: "2026-10-04", value: 7000 }, { date: "2026-10-05", value: 6000, device: "ring" }],
    sleep: [{ date: "2026-10-02", hours: 7.5 }],
    sleepNights: [{ date: "2026-10-02", start: "2026-10-01T23:00:00Z", end: "2026-10-02T07:00:00Z", asleepMin: 450, awakeMin: 30, deepMin: 80, lightMin: 270, remMin: 100, avgHr: 55 }],
    restingHr: [{ date: "2026-10-02", value: 52 }],
    hrDays: [{ date: "2026-10-02", hr: [[1759392000, 60], [1759395600, 90]] }],
    weight: [{ id: "w1", at: "2026-10-02T07:00:00Z", kg: 80.4 }],
    sessions: [{ id: "s1", type: "run", start: "2026-10-03T06:00:00Z", end: "2026-10-03T06:30:00Z", steps: 5200 }],
  });
  // and the band's records as Health Connect has them (040)
  await c("POST", "/health/records", { from: "2026-10-02T00:00:00Z", to: "2026-10-03T00:00:00Z", types: {
    heart_rate: { complete: true, records: [{ id: "hr1", s: 1759392000, e: 1759395600, z: 0, o: "gb", m: 1, p: [[1759392000, 60], [1759395600, 90]] }] },
  } });
  await c("PUT", "/daily", { date: "2026-10-01", kind: "steps", value: 8500 }); // typed over the band's
  await c("PUT", "/daily", { date: "2026-10-03", kind: "water_ml", value: 1500 });
  await c("DELETE", `/health/imports/${encodeURIComponent("steps:2026-10-04")}`); // deleted for good
  file = await c("GET", "/export");
}, 180000);

describe("a full backup", () => {
  it("holds every table of a person's data, the health ones included", async () => {
    const { rows } = await A.db.admin.query<{ table_name: string }>(
      "SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name IN ('user_id', 'owner_id')");
    const tables = rows.map((r) => r.table_name).filter((t) => !NOT_DATA.has(t)).sort();
    expect(Object.keys(file.tables).sort()).toEqual(tables);
    for (const t of tables) expect(file.tables[t].length, t).toBeGreaterThan(0);
    expect(file.settings).toMatchObject({ units: { system: "imperial" } });
    const daily = file.tables.daily_logs;
    expect(daily.find((d: any) => d.date.startsWith?.("2026-10-02") || String(d.date).includes("2026-10-02"))).toBeTruthy();
    expect(daily.some((d: any) => d.worn === false)).toBe(true);
    // the worn device's kind travels with its day (038), so a restore says "your ring" as before
    expect(daily.filter((d: any) => d.device === "ring").length).toBe(1);
    // a day typed over the band's carries both values and the choice (039)
    expect(daily.find((d: any) => String(d.date).includes("2026-10-01") && d.kind === "steps")).toMatchObject({ value: 8500, typed: 8500, synced: 8000, chosen: null });
    expect(file.tables.health_imports[0]).toHaveProperty("restored_at");
    expect(file.tables.health_imports.some((h: any) => h.deleted_at)).toBe(true);
    // the file says which schema it was written with: one per migration, so a new migration gets checked here
    expect(file.schema).toBe(fs.readdirSync(path.join(__dirname, "../src/migrations")).filter((f) => /^\d{3}_.*\.ts$/.test(f)).length);
  });

  it("restores into an empty account on another server exactly as it was", async () => {
    const told: string[][] = [];
    B.onChange((_u: string, topics: string[]) => told.push(topics));
    await call(B, V, "POST", "/import", { data: file, mode: "merge" });
    expect(told.flat()).toContain("*"); // every screen reloads
    const back = await call(B, V, "GET", "/export");
    same(back, file);
    expect(back.settings).toEqual(file.settings);
    // the band's deleted day stays deleted, the typed day stays typed, nothing came back marked deleted that wasn't
    const { rows } = await B.db.admin.query("SELECT key FROM health_imports WHERE user_id = $1 AND deleted_at IS NOT NULL", [V]);
    expect(rows.map((r: any) => r.key)).toEqual(["steps:2026-10-04"]);
    // both of the day's values came along (039): the typed one in use, the band's beside it
    expect((await call(B, V, "GET", "/health/imports", undefined, { limit: "200" })).items.find((x: any) => x.key === "steps:2026-10-01")).toMatchObject({ value: 8000, typed: 8500 });
    expect((await call(B, V, "GET", "/daily", undefined, { from: "2026-10-01", tz: "0" })).find((x: any) => x.kind === "steps" && x.date === "2026-10-01"))
      .toMatchObject({ value: 8500, typed: 8500, synced: 8000 });
    expect((await call(B, V, "POST", "/health/import", { steps: [{ date: "2026-10-04", value: 7100 }] })).steps).toBe(0);
  });

  it("replaces the same account with the backup, changes made since undone", async () => {
    const c = (method: string, path: string, body?: unknown, query?: Record<string, string>) => call(A, U, method, path, body, query);
    await c("POST", "/health/import", { steps: [{ date: "2026-10-05", value: 6000 }] });
    await c("PUT", "/daily", { date: "2026-10-02", kind: "sleep_h", value: 9 });
    await c("DELETE", `/activities/${file.tables.activities.find((a: any) => a.source === "health_connect").id}`); // marks activity:s1 deleted
    await c("POST", "/folders", { name: "Later" });
    await c("PUT", "/settings", { units: { system: "metric", weight: "kg", distance: "km", length: "cm" } });
    await c("POST", "/import", { data: file, mode: "replace" });
    const back = await c("GET", "/export");
    same(back, file);
    expect(back.settings).toEqual(file.settings);
    // a restore marks no band import deleted on the way (034 on the replaced rows)
    const { rows } = await A.db.admin.query("SELECT key FROM health_imports WHERE user_id = $1 AND deleted_at IS NOT NULL", [U]);
    expect(rows.map((r: any) => r.key)).toEqual(["steps:2026-10-04"]);
  });

  it("replaces an account on another server too", async () => {
    const C = await createEngine(await pgliteDb("memory://"), { mode: "server" });
    await C.db.admin.query("INSERT INTO users (id, username) VALUES ($1,'w')", [W]);
    await call(C, W, "POST", "/health/import", { steps: [{ date: "2026-10-01", value: 100 }], sleepNights: [{ date: "2026-10-02", start: "2026-10-01T22:00:00Z", end: "2026-10-02T06:00:00Z", asleepMin: 400, awakeMin: 80 }] });
    await call(C, W, "POST", "/import", { data: file, mode: "replace" });
    same(await call(C, W, "GET", "/export"), file);
  }, 60000);

  it("brings a server account's uploaded photos along, so they show on another server", async () => {
    const id = uuidv7();
    await A.db.admin.query("INSERT INTO media (id, user_id, mime, size, path) VALUES ($1,$2,'image/png',3,'x.png')", [id, U]);
    const withPhoto = JSON.parse(JSON.stringify(file));
    withPhoto.tables.body_metrics.push({ id: uuidv7(), kind: "photo", value: 0, note: `media:${id}`, measured_at: "2026-10-06T07:00:00Z" });
    withPhoto.media = { [id]: "data:image/png;base64,AAAA" };
    const X = uuidv7();
    await B.db.admin.query("INSERT INTO users (id, username) VALUES ($1,'x')", [X]);
    await call(B, X, "POST", "/import", { data: withPhoto, mode: "merge" });
    const photo = (await call(B, X, "GET", "/body", undefined, { kind: "photo" }))[0];
    expect(photo.note).toBe("media:data:image/png;base64,AAAA");
    // on the server that has the file, the reference stays as it was
    const Y = uuidv7();
    await A.db.admin.query("INSERT INTO users (id, username) VALUES ($1,'y')", [Y]);
    await A.db.admin.query("UPDATE media SET user_id = $1 WHERE id = $2", [Y, id]);
    await call(A, Y, "POST", "/import", { data: withPhoto, mode: "merge" });
    expect((await call(A, Y, "GET", "/body", undefined, { kind: "photo" }))[0].note).toBe(`media:${id}`);
  });
});

describe("an older backup", () => {
  it("restores without the newer tables and columns", async () => {
    const old = JSON.parse(JSON.stringify(file));
    delete old.schema;
    delete old.tables.sleep_nights; delete old.tables.hr_days; delete old.tables.health_imports;
    for (const d of old.tables.daily_logs) { delete d.source; delete d.worn; }
    for (const a of old.tables.activities) { delete a.steps_source; delete a.steps_app; delete a.max_hr; delete a.hr; }
    for (const w of old.tables.workouts) { delete w.avg_hr; delete w.max_hr; delete w.hr; }
    const Z = uuidv7();
    await B.db.admin.query("INSERT INTO users (id, username) VALUES ($1,'z')", [Z]);
    await call(B, Z, "POST", "/import", { data: old, mode: "replace" });
    const back = await call(B, Z, "GET", "/export");
    expect(back.tables.daily_logs.length).toBe(old.tables.daily_logs.length);
    expect(back.tables.daily_logs.every((d: any) => d.worn === true)).toBe(true);
    expect(back.tables.workouts.length).toBe(old.tables.workouts.length);
    expect(back.tables.activities.length).toBe(old.tables.activities.length);
  });

  it("leaves out a column that a newer Motus dropped instead of failing the whole restore", async () => {
    const old = JSON.parse(JSON.stringify(file));
    for (const s of old.tables.routine_sets) s.some_dropped_column = 1;
    const Q = uuidv7();
    await B.db.admin.query("INSERT INTO users (id, username) VALUES ($1,'q')", [Q]);
    const res = await call(B, Q, "POST", "/import", { data: old, mode: "replace" });
    expect(res.routine_sets).toBe(old.tables.routine_sets.length);
  });
});

describe("a backup from before goal names and the rep range move", () => {
  it("gets those changes on the way in, on its own rows only", async () => {
    const old = JSON.parse(JSON.stringify(file));
    delete old.schema;
    old.exportedAt = "2026-11-01T10:00:00.000Z";
    const typed = { id: uuidv7(), title: "Body weight to 75 kg", scope: "body", scope_id: "weight", metric: "body_weight", target: 75, period: "once" };
    const named = { ...typed, id: uuidv7(), title: "Summer cut" };
    old.tables.goals.push(typed, named);
    const squatEx = old.tables.routine_exercises.find((e: any) => old.tables.routine_sets.some((x: any) => x.routine_exercise_id === e.id && x.weight_kg != null));
    squatEx.progression = null;
    for (const x of old.tables.routine_sets) if (x.routine_exercise_id === squatEx.id) { x.reps = 5; x.reps_max = 8; }
    const O = uuidv7();
    await B.db.admin.query("INSERT INTO users (id, username) VALUES ($1,'old')", [O]);
    await call(B, O, "POST", "/import", { data: old, mode: "replace" });
    const goals = (await B.db.admin.query("SELECT id, title FROM goals WHERE user_id = $1", [O])).rows as any[];
    expect(goals.find((g) => g.id === typed.id).title).toBe(""); // the old automatic title
    expect(goals.find((g) => g.id === named.id).title).toBe("Summer cut");
    const re = (await B.db.admin.query("SELECT progression FROM routine_exercises WHERE id = $1", [squatEx.id])).rows[0] as any;
    expect(re.progression).toMatchObject({ repsMin: 5, repsMax: 8 });
    const sets = (await B.db.admin.query("SELECT reps, reps_max FROM routine_sets WHERE routine_exercise_id = $1", [squatEx.id])).rows;
    expect(sets.every((x: any) => x.reps === 5 && x.reps_max == null)).toBe(true);
  });

  it("a current file is taken as it is", async () => {
    const cur = JSON.parse(JSON.stringify(file));
    cur.tables.goals.push({ id: uuidv7(), title: "Body weight to 75 kg", scope: "body", scope_id: "weight", metric: "body_weight", target: 75, period: "once" });
    const N = uuidv7();
    await B.db.admin.query("INSERT INTO users (id, username) VALUES ($1,'cur')", [N]);
    await call(B, N, "POST", "/import", { data: cur, mode: "replace" });
    const titles = (await B.db.admin.query("SELECT title FROM goals WHERE user_id = $1", [N])).rows.map((g: any) => g.title);
    expect(titles).toContain("Body weight to 75 kg");
  });
});

describe("a backup from a newer Motus", () => {
  it("is refused before anything is changed, at the preview and at the restore", async () => {
    const newer = { ...file, schema: file.schema + 1 };
    const P = uuidv7();
    await B.db.admin.query("INSERT INTO users (id, username) VALUES ($1,'newer')", [P]);
    await call(B, P, "POST", "/folders", { name: "Mine" });
    for (const [path, body] of [["/import/preview", { data: newer }], ["/import", { data: newer, mode: "replace" }]] as const) {
      const r = await B.handle({ method: "POST", path, body, userId: P });
      expect(r.status).toBe(400);
      expect((r.body as any).error).toBe("This backup is from a newer version of Motus. Update the app first.");
    }
    expect((await call(B, P, "GET", "/folders")).map((f: any) => f.name)).toEqual(["Mine"]);
  });
});

describe("the preview", () => {
  it("reads the file's head alone (counts and workout times), as the app sends it", async () => {
    const head = { app: "motus", format: file.format, schema: file.schema, exportedAt: file.exportedAt, parts: file.parts, settings: {},
      tables: { ...Object.fromEntries(Object.entries(file.tables).map(([k, v]) => [k, (v as any[]).length])), workouts: file.tables.workouts.map((w: any) => ({ started_at: w.started_at })) } };
    const full = await call(B, V, "POST", "/import/preview", { data: file });
    expect(await call(B, V, "POST", "/import/preview", { data: head })).toEqual(full);
    expect(full.counts.workouts).toBe(1);
    expect(full.from).toBe(file.tables.workouts[0].started_at);
  });
});

describe("the goals the app once made, in a backup from before 026 and 033 restored into another account", () => {
  // ids from the file's account (U), not the one restoring it
  const seeded = async (user: string) => (await B.db.admin.query<{ w: string; s: string }>(
    "SELECT md5($1::text || ':weekly-target')::uuid::text w, md5($1::text || ':daily-steps')::uuid::text s", [user])).rows[0]!;
  const oldFile = async (withUserId: boolean) => {
    const old = JSON.parse(JSON.stringify(file));
    delete old.schema;
    old.exportedAt = "2026-11-01T10:00:00.000Z";
    if (!withUserId) delete old.user.id;
    const ids = await seeded(U);
    old.tables.goals.push(
      { id: ids.w, title: "Weekly target", scope: "activity", scope_id: "workout", metric: "sessions", comparator: ">=", target: 3, period: "week" },
      { id: ids.s, title: "Daily steps", scope: "activity", scope_id: null, metric: "steps_avg", comparator: ">=", target: 8000, period: "day" });
    const mine = old.tables.goals.find((g: any) => g.title === "Squat more").id;
    old.settings = { ...old.settings, home: { goals: [{ id: ids.w, streak: true }, { id: ids.s }, { id: mine }] } };
    return { old, ids, mine };
  };

  for (const withUserId of [true, false]) {
    it(`come off Home and lose their app-given names on a merge into a new account${withUserId ? "" : " (a file without the account's id)"}`, async () => {
      expect(file.user.id).toBe(U);
      const { old, ids, mine } = await oldFile(withUserId);
      const R = uuidv7();
      await B.db.admin.query("INSERT INTO users (id, username) VALUES ($1,$2)", [R, `r${withUserId ? 1 : 0}`]);
      await call(B, R, "POST", "/import", { data: old, mode: "merge" });
      const settings = (await B.db.admin.query("SELECT data FROM user_settings WHERE user_id = $1", [R])).rows[0] as any;
      expect(settings.data.home.goals).toEqual([{ id: mine }]);
      const goals = (await B.db.admin.query("SELECT id, title FROM goals WHERE user_id = $1", [R])).rows as any[];
      expect(goals.filter((g) => g.title === "Weekly target" || g.title === "Daily steps")).toEqual([]);
      expect(goals.filter((g) => g.title === "").length).toBe(2);
      expect(goals.some((g) => g.title === "Squat more")).toBe(true);
      // the first restore keeps the file's ids; the second (the same ids taken by then) gets new ones
      if (withUserId) expect(goals.map((g) => g.id)).toEqual(expect.arrayContaining([ids.w, ids.s]));
    });
  }

  it("a goal made by hand that counts the same is left alone", async () => {
    const { old, ids } = await oldFile(false);
    old.tables.goals = old.tables.goals.filter((g: any) => g.id !== ids.w);
    const own = { id: uuidv7(), title: "Weekly target", scope: "activity", scope_id: null, metric: "sessions", comparator: ">=", target: 4, period: "week" };
    old.tables.goals.push(own);
    old.settings.home.goals = [{ id: own.id }];
    const R = uuidv7();
    await B.db.admin.query("INSERT INTO users (id, username) VALUES ($1,'r2')", [R]);
    await call(B, R, "POST", "/import", { data: old, mode: "merge" });
    expect(((await B.db.admin.query("SELECT data FROM user_settings WHERE user_id = $1", [R])).rows[0] as any).data.home.goals).toEqual([{ id: own.id }]);
    expect(((await B.db.admin.query("SELECT title FROM goals WHERE id = $1", [own.id])).rows[0] as any).title).toBe("Weekly target");
  });
});

describe("a backup that says nothing of its schema", () => {
  const restore = async (f: any, name: string) => {
    const O = uuidv7();
    await B.db.admin.query("INSERT INTO users (id, username) VALUES ($1,$2)", [O, name]);
    await call(B, O, "POST", "/import", { data: f, mode: "replace" });
    return O;
  };
  const squatOf = (f: any) => f.tables.routine_exercises.find((e: any) => f.tables.routine_sets.some((x: any) => x.routine_exercise_id === e.id && x.weight_kg != null));
  const plain = () => { const f = JSON.parse(JSON.stringify(file)); delete f.schema; const re = squatOf(f); re.progression = null; return { f, re }; };
  // the account's squat (another account here may have the file's ids already, so its rows can have new ones)
  const squat = `SELECT re.id, re.progression FROM routine_exercises re WHERE re.user_id = $1
    AND EXISTS (SELECT 1 FROM routine_sets s WHERE s.routine_exercise_id = re.id AND s.weight_kg IS NOT NULL)`;
  const progression = async (user: string) => ((await B.db.admin.query(squat, [user])).rows[0] as any).progression;

  it("is dated by the release that brought each change, not by when it was written", async () => {
    // after 022 was written (2026-11-10 21:23) but before v0.1.15 had it (23:52): still the old rep ranges
    const { f, re } = plain();
    f.exportedAt = "2026-11-10T22:30:00.000Z";
    expect(re).toBeTruthy();
    expect(await progression(await restore(f, "rel1"))).toMatchObject({ repsMin: 5, repsMax: 5 });
    // after the release, and nothing in it in the old form: taken as it is
    const later = plain();
    later.f.exportedAt = "2026-11-11T08:00:00.000Z";
    expect(await progression(await restore(later.f, "rel2"))).toBeNull();
  });

  it("made after the release by an app not yet updated: the rows still in the old form are converted", async () => {
    const { f, re } = plain();
    f.exportedAt = "2026-11-14T23:30:00.000Z";
    for (const x of f.tables.routine_sets) if (x.routine_exercise_id === re.id) { x.reps = 5; x.reps_max = 8; }
    const v = f.tables.routine_versions[0];
    const ex = v.snapshot.exercises[0];
    v.snapshot.exercises[0] = { id: ex.id, exerciseId: ex.exerciseId, exercise: { name: "Barbell Squat", primaryMuscles: ["quads"] }, prefill: "target", sets: ex.sets };
    const O = await restore(f, "lagging");
    expect(await progression(O)).toMatchObject({ repsMin: 5, repsMax: 8 });
    const here = ((await B.db.admin.query(squat, [O])).rows[0] as any).id;
    const sets = (await B.db.admin.query("SELECT reps, reps_max FROM routine_sets WHERE routine_exercise_id = $1", [here])).rows;
    expect(sets.every((x: any) => x.reps === 5 && x.reps_max == null)).toBe(true);
    const snaps = (await B.db.admin.query("SELECT snapshot FROM routine_versions WHERE user_id = $1", [O])).rows.map((r: any) => r.snapshot);
    expect(snaps.flatMap((s: any) => s.exercises).some((e: any) => e.exercise)).toBe(false);
    expect(snaps.flatMap((s: any) => s.exercises)).toContainEqual(expect.objectContaining({ name: "Barbell Squat", primary: ["quads"], fixed: true }));
  });
});

describe("a backup whose schema isn't a whole number from 0 up", () => {
  it("is refused as damaged, at the preview and at the restore", async () => {
    const P = uuidv7();
    await B.db.admin.query("INSERT INTO users (id, username) VALUES ($1,'damaged')", [P]);
    await call(B, P, "POST", "/folders", { name: "Mine" });
    for (const schema of ["36", -1, 1.5, null, {}]) {
      const bad = { ...file, schema };
      for (const [path, body] of [["/import/preview", { data: bad }], ["/import", { data: bad, mode: "replace" }]] as const) {
        const r = await B.handle({ method: "POST", path, body, userId: P });
        expect(r.status, `${path} ${JSON.stringify(schema)}`).toBe(400);
        expect((r.body as any).error).toBe("This backup is damaged and can't be restored.");
      }
    }
    expect((await call(B, P, "GET", "/folders")).map((f: any) => f.name)).toEqual(["Mine"]);
  });
});
