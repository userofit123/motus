// 054_exercise_force_fixes: a built-in Butterfly (a chest fly) saved as "pull" becomes "push", so the Routine check
// counts it as pushing; an exercise someone made with the same source id keeps what they gave it.
import { describe, it, expect } from "vitest";
import { pgliteDb } from "../src/adapters/pglite";
import { migrate } from "../src/migrate";
import { uuidv7 } from "../src/ids";

describe("054 on old catalog rows", () => {
  it("fixes push or pull on built-in exercises only", async () => {
    const db = await pgliteDb("memory://");
    await migrate(db, "053_program_goal");
    const q = (sql: string, p: unknown[] = []) => db.admin.query<any>(sql, p);
    const [u, built, own] = [uuidv7(), uuidv7(), uuidv7()];
    await q("INSERT INTO users (id, username, display_name) VALUES ($1,'a','A')", [u]);
    await q("INSERT INTO exercises (id, owner_id, source, source_id, name, force, primary_muscles) VALUES ($1,NULL,'free-exercise-db','Butterfly','Butterfly','pull','{chest}')", [built]);
    await q("INSERT INTO exercises (id, owner_id, source, source_id, name, force, primary_muscles) VALUES ($1,$2,'free-exercise-db','Butterfly','My butterfly','pull','{chest}')", [own, u]);
    await migrate(db);
    const force = new Map((await q("SELECT id, force FROM exercises")).rows.map((x: any) => [x.id, x.force]));
    expect(force.get(built)).toBe("push");
    expect(force.get(own)).toBe("pull");
  });
});
