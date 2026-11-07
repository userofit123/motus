// A Motus file with only some parts (routines with their folders, programs, workouts) copied into another account
// on the same server: new ids where the old ones are taken, custom exercises matched by name or made, nothing twice.
import { describe, it, expect, beforeAll } from "vitest";
import { createEngine, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";

let eng: Engine;
let A: string, B: string;
const call = async (user: string, method: string, path: string, body?: unknown, query?: Record<string, string>) => {
  const r = await eng.handle({ method, path, body, query, userId: user });
  if (r.status !== 200) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};

beforeAll(async () => {
  eng = await createEngine(await pgliteDb("memory://"), { mode: "server" });
  A = uuidv7(); B = uuidv7();
  await eng.db.admin.query("INSERT INTO users (id, username) VALUES ($1,'a'), ($2,'b')", [A, B]);
}, 120000);

describe("moving routines, programs and workouts to another account", () => {
  let file: any;
  it("exports only the parts asked for", async () => {
    const bench = (await call(A, "GET", "/exercises")).find((e: any) => e.name === "Barbell Squat").id;
    const mine = (await call(A, "POST", "/exercises", { name: "Sled Push Thing", primaryMuscles: ["quads"] })).id;
    const folder = (await call(A, "POST", "/folders", { name: "Strength" })).id;
    const r1 = (await call(A, "POST", "/routines", { name: "Day A", folderId: folder, exercises: [{ exerciseId: bench, sets: [{ reps: 5, weightKg: 80 }] }, { exerciseId: mine, sets: [{ reps: 10 }] }] })).id;
    await call(A, "POST", "/programs", { name: "Plan", weeks: [{ days: [r1] }], startDate: "2026-10-01" });
    await call(A, "POST", "/workouts/log", { startedAt: "2026-10-02T08:00:00Z", routineId: r1, exercises: [{ exerciseId: bench, sets: [{ reps: 5, weightKg: 82.5 }] }, { exerciseId: mine, sets: [{ reps: 10 }] }] });
    await call(A, "POST", "/goals", { kind: "workouts_per_week", target: 3 }).catch(() => null);

    file = await call(A, "GET", "/export", undefined, { parts: "programs,workouts" });
    expect(file.parts).toEqual(["routines", "programs", "workouts"]); // programs bring their routines
    expect(file.settings).toBeUndefined();
    expect(file.tables.goals).toBeUndefined();
    expect(file.tables.folders.length).toBe(1);
    expect(file.tables.exercises.map((e: any) => e.name)).toEqual(["Sled Push Thing"]);
  });

  it("refuses to replace an account with part of one", async () => {
    const r = await eng.handle({ method: "POST", path: "/import", body: { data: file, mode: "replace" }, userId: B });
    expect(r.status).toBe(400);
  });

  it("imports into another account with everything pointing at its own copies", async () => {
    const res = await call(B, "POST", "/import", { data: file, mode: "merge" });
    expect(res).toMatchObject({ folders: 1, routines: 1, programs: 1, workouts: 1, exercises: 1 });
    const [folder] = await call(B, "GET", "/folders");
    const [routine] = await call(B, "GET", "/routines");
    expect(routine.folderId ?? routine.folder_id).toBe(folder.id);
    const full = await call(B, "GET", `/routines/${routine.id}`);
    const lib = await call(B, "GET", "/exercises");
    const sled = lib.find((e: any) => e.name === "Sled Push Thing");
    expect(full.exercises.map((e: any) => e.exerciseId)).toEqual([lib.find((e: any) => e.name === "Barbell Squat").id, sled.id]);
    const [program] = await call(B, "GET", "/programs");
    expect(JSON.stringify(program)).toContain(routine.id);
    const [w] = await call(B, "GET", "/workouts");
    const wf = await call(B, "GET", `/workouts/${w.id}`);
    expect(wf.routineId ?? wf.routine_id).toBe(routine.id);
    expect(wf.exercises[0].sets[0].weightKg ?? wf.exercises[0].sets[0].weight_kg).toBe(82.5); // stored in kg, unchanged
    // A's things are untouched and still A's alone
    expect((await call(A, "GET", "/routines")).map((r: any) => r.id)).not.toContain(routine.id);
  });

  it("adds nothing twice when the same file is imported again", async () => {
    const res = await call(B, "POST", "/import", { data: file, mode: "merge" });
    expect(Object.values(res).every((n) => n === 0)).toBe(true);
    expect((await call(B, "GET", "/routines")).length).toBe(1);
    expect((await call(B, "GET", "/workouts")).length).toBe(1);
    expect((await call(B, "GET", "/exercises")).filter((e: any) => e.name === "Sled Push Thing").length).toBe(1);
  });

  it("uses a custom exercise of the same name rather than making a second one", async () => {
    const C = uuidv7();
    await eng.db.admin.query("INSERT INTO users (id, username) VALUES ($1,'c')", [C]);
    const own = (await call(C, "POST", "/exercises", { name: "sled push thing", primaryMuscles: ["quads"] })).id;
    const res = await call(C, "POST", "/import", { data: file, mode: "merge" });
    expect(res.exercises).toBe(0);
    const [routine] = await call(C, "GET", "/routines");
    expect((await call(C, "GET", `/routines/${routine.id}`)).exercises[1].exerciseId).toBe(own);
  });

  it("never points an imported row at another account's rows", async () => {
    const theirs = (await call(A, "GET", "/routines"))[0].id;
    const forged = { app: "motus", format: 1, parts: ["workouts"], catalogRefs: {}, tables: { workouts: [{ id: uuidv7(), routine_id: theirs, name: "Forged", status: "completed", started_at: "2026-10-03T08:00:00Z", ended_at: "2026-10-03T09:00:00Z" }] } };
    expect((await call(B, "POST", "/import", { data: forged, mode: "merge" })).workouts).toBe(1);
    const { rows } = await eng.db.admin.query("SELECT routine_id FROM workouts WHERE name = 'Forged'");
    expect((rows[0] as any).routine_id).toBe(null);
  });

  it("brings notes and reminders in an \"Everything else\" file without links to the first account's rows", async () => {
    const squat = (await call(A, "GET", "/exercises")).find((e: any) => e.name === "Barbell Squat").id;
    const routine = (await call(A, "GET", "/routines"))[0].id;
    const [workout] = await call(A, "GET", "/workouts");
    await eng.db.admin.query(
      `INSERT INTO reminders (id, user_id, target_type, target_id, body, created_workout_id, last_shown_workout_id) VALUES ($1,$2,'exercise',$3,'Go deeper',$4,$4)`,
      [uuidv7(), A, squat, workout.id]);
    await eng.db.admin.query(
      `INSERT INTO notes (id, user_id, target_type, target_id, body) VALUES ($1,$2,'exercise',$3,'Knees out'), ($4,$2,'routine',$5,'Short rests'), ($6,$2,'workout',$7,'Felt strong')`,
      [uuidv7(), A, squat, uuidv7(), routine, uuidv7(), workout.id]);
    const other = await call(A, "GET", "/export", undefined, { parts: "other" });
    expect(other.parts).toEqual(["other"]);
    expect(other.tables.workouts).toBeUndefined();
    // workout notes go with workouts, routine notes with routines; the rest with everything else
    expect(other.tables.notes.map((n: any) => n.body)).toEqual(["Knees out"]);
    expect((await call(A, "GET", "/export", undefined, { parts: "routines" })).tables.notes.map((n: any) => n.body)).toEqual(["Short rests"]);

    const D = uuidv7();
    await eng.db.admin.query("INSERT INTO users (id, username) VALUES ($1,'d')", [D]);
    const res = await call(D, "POST", "/import", { data: other, mode: "merge" });
    expect(res.reminders).toBe(1);
    expect(res.notes).toBe(1);
    const { rows } = await eng.db.admin.query("SELECT target_id, created_workout_id, last_shown_workout_id FROM reminders WHERE user_id = $1", [D]);
    expect(rows[0]).toMatchObject({ created_workout_id: null, last_shown_workout_id: null });
    expect((rows[0] as any).target_id).toBe((await call(D, "GET", "/exercises")).find((e: any) => e.name === "Barbell Squat").id);
    const notes = (await eng.db.admin.query("SELECT body FROM notes WHERE user_id = $1", [D])).rows;
    expect(notes.map((n: any) => n.body)).toEqual(["Knees out"]);
  });

  it("keeps a goal on a built-in exercise when its id differs on the other server", async () => {
    const squat = (await call(A, "GET", "/exercises")).find((e: any) => e.name === "Barbell Squat").id;
    await eng.db.admin.query("INSERT INTO goals (id, user_id, title, scope, scope_id, metric, target) VALUES ($1,$2,'Squat more','exercise',$3,'max_weight',100)", [uuidv7(), A, squat]);
    const other = await call(A, "GET", "/export", undefined, { parts: "other" });
    expect(other.catalogRefs[squat]).toBeTruthy();
    // pretend the file comes from a server where the squat has another id
    const alien = uuidv7();
    const moved = JSON.parse(JSON.stringify(other).split(squat).join(alien));
    const E = uuidv7();
    await eng.db.admin.query("INSERT INTO users (id, username) VALUES ($1,'e')", [E]);
    expect((await call(E, "POST", "/import", { data: moved, mode: "merge" })).goals).toBe(1);
    const { rows } = await eng.db.admin.query("SELECT scope_id FROM goals WHERE user_id = $1", [E]);
    expect((rows[0] as any).scope_id).toBe((await call(E, "GET", "/exercises")).find((e: any) => e.name === "Barbell Squat").id);
  });
});
