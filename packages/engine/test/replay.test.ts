// A set added on the phone whose answer never arrived (timed out after the server had saved it) is sent again from
// the outbox with the same id: the second send must succeed without a second set or a moved set.
import { describe, it, expect, beforeAll } from "vitest";
import { createEngine, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";

let eng: Engine, U: string, V: string;
const as = (userId: string) => async (method: string, path: string, body?: unknown) => eng.handle({ method, path, body, userId });
const call = async (method: string, path: string, body?: unknown) => {
  const r = await as(U)(method, path, body);
  if (r.status !== 200) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
let weId = "";
beforeAll(async () => {
  eng = await createEngine(await pgliteDb("memory://"));
  U = uuidv7(); V = uuidv7();
  await eng.db.admin.query("INSERT INTO users (id, username) VALUES ($1, 'u'), ($2, 'v')", [U, V]);
  const ex = (await call("GET", "/exercises"))[0].id;
  const w = await call("POST", "/workouts/start", { exercises: [{ exerciseId: ex, sets: [{ reps: 5 }, { reps: 5 }] }] });
  weId = w.exercises[0].id;
}, 120000);

const sets = async () => (await call("GET", "/workouts/active")).exercises[0].sets as any[];

describe("replaying a set sent from the outbox", () => {
  it("adds the set once when the same change arrives twice", async () => {
    const id = uuidv7();
    const body = { id, kind: "normal", weightKg: 50, reps: 8 };
    await call("POST", `/workout-exercises/${weId}/sets`, body);
    await call("POST", `/workout-exercises/${weId}/sets`, body);
    const list = await sets();
    expect(list.filter((s) => s.id === id)).toHaveLength(1);
    expect(list.map((s) => s.position)).toEqual([0, 1, 2]);
  });

  it("doesn't move sets when a drop set is replayed", async () => {
    const before = await sets();
    const id = uuidv7();
    const body = { id, afterId: before[0].id, kind: "drop", reps: 6 };
    await call("POST", `/workout-exercises/${weId}/sets`, body);
    await call("POST", `/workout-exercises/${weId}/sets`, body);
    const list = await sets();
    expect(list.map((s) => s.id)).toEqual([before[0].id, id, before[1].id, before[2].id]);
  });

  it("refuses an id that belongs to someone else's set", async () => {
    const taken = (await sets())[0].id;
    const ex = (await as(V)("GET", "/exercises")).body as any[];
    const w = (await as(V)("POST", "/workouts/start", { exercises: [{ exerciseId: ex[0].id, sets: [] }] })).body as any;
    const r = await as(V)("POST", `/workout-exercises/${w.exercises[0].id}/sets`, { id: taken, kind: "normal", reps: 1 });
    expect([r.status, (r.body as any)?.error]).toEqual([400, "That set id is already in use"]);
  });
});
