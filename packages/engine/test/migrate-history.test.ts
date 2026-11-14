// 015_routine_now and 016_history_now against rows written the way the app wrote them before: old routine settings
// become "Keep these numbers fixed" and per-exercise Progression, and History ends with the routine as it is now.
import { describe, it, expect } from "vitest";
import { pgliteDb } from "../src/adapters/pglite";
import { migrate } from "../src/migrate";
import { createEngine } from "../src/index";
import { uuidv7 } from "../src/ids";

describe("015 and 016 on old rows", () => {
  it("converts old routine exercises and versions, and keeps every routine's current state", async () => {
    const db = await pgliteDb("memory://");
    await migrate(db, "014_reminder_body_plain");
    const q = (sql: string, p: unknown[] = []) => db.admin.query<any>(sql, p);
    const [on, off, ex, ra, rb] = [uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7()];
    await q("INSERT INTO users (id, username, display_name) VALUES ($1,'on','On'), ($2,'off','Off')", [on, off]);
    await q(`INSERT INTO user_settings (user_id, data) VALUES ($1, '{"features":{"progression":false}}')`, [off]);
    // from the shared catalog: both people's routines use it (one person's own exercise in another's routine is
    // removed by 032_own_references)
    await q("INSERT INTO exercises (id, owner_id, name, primary_muscles, instructions) VALUES ($1,NULL,'Press','{chest}','{\"long text\"}')", [ex]);
    await q("INSERT INTO routines (id, user_id, name) VALUES ($1,$2,'A'), ($3,$4,'B')", [ra, on, rb, off]);
    const re = [uuidv7(), uuidv7(), uuidv7(), uuidv7()];
    const rows: [string, string, string, string | null, unknown][] = [
      [re[0]!, on, ra, "target", null],
      [re[1]!, on, ra, "last", { kind: "double", incrementKg: 5, deloadAfter: 2 }],
      [re[2]!, on, ra, "last", "just text"],
      [re[3]!, off, rb, "last", { kind: "double", incrementKg: 5, deloadAfter: 2 }],
    ];
    for (const [i, [id, u, r, prefill, prog]] of rows.entries())
      await q("INSERT INTO routine_exercises (id, user_id, routine_id, exercise_id, position, prefill, progression) VALUES ($1,$2,$3,$4,$5,$6,$7)", [id, u, r, ex, i, prefill, prog == null ? null : JSON.stringify(prog)]);
    await q("INSERT INTO routine_sets (id, user_id, routine_exercise_id, position, kind, reps, weight_kg) VALUES ($1,$2,$3,0,'normal',8,60)", [uuidv7(), on, re[0]]);
    // an old version: the whole routine as it was before a change, exercise and all
    const oldSnap = { name: "A (old)", exercises: [{ id: re[0], exerciseId: ex, prefill: "target", exercise: { name: "Press", primaryMuscles: ["chest"], instructions: ["long text"], images: ["x.jpg"] },
      sets: [{ id: uuidv7(), kind: "normal", reps: 8, weightKg: 50, routineExerciseId: re[0] }] }] };
    const vOld = uuidv7();
    await q("INSERT INTO routine_versions (id, user_id, routine_id, snapshot, created_at) VALUES ($1,$2,$3,$4, now() - interval '1 day')", [vOld, on, ra, JSON.stringify(oldSnap)]);

    const eng = await createEngine(db, { mode: "server", seed: false });
    const got = new Map((await q("SELECT id, fixed, progression FROM routine_exercises")).rows.map((x: any) => [x.id, x]));
    expect(got.get(re[0])).toMatchObject({ fixed: true, progression: null });
    expect(got.get(re[1])).toMatchObject({ fixed: false, progression: { mode: "auto", stepKg: 5, lowerAfter: 2 } });
    expect(got.get(re[2])!.progression).toBeNull();
    expect(got.get(re[3])!.progression).toBeNull();

    const old = (await q("SELECT snapshot FROM routine_versions WHERE id = $1", [vOld])).rows[0].snapshot;
    expect(old.exercises[0]).toMatchObject({ exerciseId: ex, name: "Press", primary: ["chest"], fixed: true, sets: [{ kind: "normal", reps: 8, weightKg: 50 }] });
    expect(old.exercises[0]).not.toHaveProperty("exercise");
    expect(old.exercises[0].sets[0]).not.toHaveProperty("id");

    const call = async (user: string, method: string, path: string) => (await eng.handle({ method, path, userId: user })).body as any;
    const hist = await call(on, "GET", `/routines/${ra}/versions`);
    expect(hist.items.map((v: any) => [v.reason, v.current])).toEqual([["edit", true], ["edit", false]]);
    expect(hist.items[1].id).toBe(vOld);
    expect((await call(off, "GET", `/routines/${rb}/versions`)).items).toHaveLength(1);
    // the old version restores, rebuilt from its exerciseId
    await eng.handle({ method: "POST", path: `/routines/${ra}/versions/${vOld}/restore`, userId: on });
    const now = await call(on, "GET", `/routines/${ra}`);
    expect(now.name).toBe("A (old)");
    expect(now.exercises.map((e: any) => [e.fixed, e.sets[0].weightKg])).toEqual([[true, 50]]);
    // running again changes nothing (each migration once)
    expect(await migrate(db)).toEqual([]);
  }, 120000);
});
