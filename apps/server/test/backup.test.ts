// A backup from a server account carries the photos uploaded there (files beside the database), so restoring it into
// another account shows them; restoring it into the account that has them keeps pointing at the uploads.
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { pgliteDb } from "@motus/engine/pglite";
import { uuidv7, type Db } from "@motus/engine";
import { buildApp } from "../src/app";
import { hashPassword } from "../src/auth";

let app: FastifyInstance, db: Db, dir: string;
const PW = "correct horse";

async function user(name: string) {
  await db.admin.query("INSERT INTO users (id, username, password_hash, role) VALUES ($1,$2,$3,'user')", [uuidv7(), name, await hashPassword(PW)]);
  const r = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: name, password: PW, wantToken: true } });
  return { authorization: `Bearer ${r.json().token}` };
}

const idOf = async (name: string) => ((await db.admin.query("SELECT id FROM users WHERE username = $1", [name])).rows[0] as any).id as string;
const mediaRows = async (name: string) => Number(((await db.admin.query("SELECT count(*) n FROM media WHERE user_id = $1", [await idOf(name)])).rows[0] as any).n);

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "motus-server-test-"));
  db = await pgliteDb("memory://");
  ({ app } = await buildApp({ db, dataDir: dir }));
}, 120000);
afterAll(async () => { await app.close(); await db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe("photos in a backup", () => {
  it("come along in the file and show in another account", async () => {
    const a = await user("ann");
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const up = await app.inject({ method: "POST", url: "/api/media", headers: { ...a, "content-type": "image/png", "x-motus": "1" }, payload: png });
    expect(up.statusCode).toBe(200);
    const id = up.json().id;
    const photo = await app.inject({ method: "POST", url: "/api/body", headers: { ...a, "x-motus": "1" }, payload: { kind: "photo", value: 0, note: `media:${id}`, measuredAt: "2026-10-01T07:00:00Z" } });
    expect(photo.statusCode).toBe(200);

    const exp = await app.inject({ method: "GET", url: "/api/export", headers: { ...a, "x-motus": "1" } });
    expect(exp.statusCode).toBe(200);
    const file = exp.json();
    expect(file.media[id]).toBe(`data:image/png;base64,${png.toString("base64")}`);
    // a partial export goes through the same way
    expect((await app.inject({ method: "GET", url: "/api/export?parts=routines", headers: { ...a, "x-motus": "1" } })).json().parts).toEqual(["routines"]);

    const b = await user("bob");
    const imp = await app.inject({ method: "POST", url: "/api/import", headers: { ...b, "x-motus": "1" }, payload: { data: file, mode: "merge" } });
    expect(imp.statusCode).toBe(200);
    // the photo is an upload of bob's again, not data inside the row
    const bodies = (await app.inject({ method: "GET", url: "/api/body?kind=photo", headers: { ...b, "x-motus": "1" } })).json();
    const mine = /^media:([0-9a-f-]{36})$/.exec(bodies[0].note)?.[1];
    expect(mine).toBeTruthy();
    expect(mine).not.toBe(id);
    const got = await app.inject({ method: "GET", url: `/api/media/${mine}`, headers: b });
    expect(got.statusCode).toBe(200);
    expect(got.rawPayload.equals(png)).toBe(true);
    // merged again: the same upload, no second copy
    expect((await app.inject({ method: "POST", url: "/api/import", headers: { ...b, "x-motus": "1" }, payload: { data: file, mode: "merge" } })).statusCode).toBe(200);
    expect(fs.readdirSync(path.join(dir, "media", await idOf("bob")))).toEqual([mine]);

    // back into the same account: the upload is still there, so it stays a reference
    const again = await app.inject({ method: "POST", url: "/api/import", headers: { ...a, "x-motus": "1" }, payload: { data: file, mode: "replace" } });
    expect(again.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/body?kind=photo", headers: { ...a, "x-motus": "1" } })).json()[0].note).toBe(`media:${id}`);
  });
});

describe("an export larger than a restore takes", () => {
  it("leaves the large files out, videos first, says so, and restores", async () => {
    // a server whose restore takes 2 MB: room for the photo, not the video
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), "motus-server-test-"));
    const db2 = await pgliteDb("memory://");
    const { app: small } = await buildApp({ db: db2, dataDir: d2, restoreLimit: 2 * 1024 * 1024 });
    try {
      const login = async (name: string) => {
        await db2.admin.query("INSERT INTO users (id, username, password_hash, role) VALUES ($1,$2,$3,'user')", [uuidv7(), name, await hashPassword(PW)]);
        const r = await small.inject({ method: "POST", url: "/api/auth/login", payload: { username: name, password: PW, wantToken: true } });
        return { authorization: `Bearer ${r.json().token}`, "x-motus": "1" };
      };
      const a = await login("cat");
      const upload = async (type: string, bytes: Buffer) => {
        const id = (await small.inject({ method: "POST", url: "/api/media", headers: { ...a, "content-type": type }, payload: bytes })).json().id;
        await small.inject({ method: "POST", url: "/api/body", headers: a, payload: { kind: "photo", value: 0, note: `media:${id}`, measuredAt: "2026-10-01T07:00:00Z" } });
        return id;
      };
      const photo = await upload("image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
      const video = await upload("video/mp4", Buffer.alloc(1024 * 1024, 7));
      const file = (await small.inject({ method: "GET", url: "/api/export", headers: a })).json();
      expect(Object.keys(file.media)).toEqual([photo]);
      expect(file.media[video]).toBeUndefined();
      expect(file.leftOut).toEqual({ photos: 0, videos: 1 });
      const b = await login("dan");
      const imp = await small.inject({ method: "POST", url: "/api/import", headers: b, payload: { data: file, mode: "merge" } });
      expect(imp.statusCode).toBe(200);
    } finally { await small.close(); await db2.close(); fs.rmSync(d2, { recursive: true, force: true }); }
  }, 120000);

  it("a backup within the limit leaves nothing out", async () => {
    const a = await user("eve");
    expect((await app.inject({ method: "GET", url: "/api/export", headers: { ...a, "x-motus": "1" } })).json().leftOut).toBeUndefined();
  });
});

describe("photos a restore brings", () => {
  const fileWith = (media: Record<string, string>, parts = ["routines", "programs", "workouts", "other"]) => ({
    app: "motus", format: 1, schema: 36, exportedAt: new Date().toISOString(), parts, tables: {
      body_metrics: Object.keys(media).map((mid) => ({ id: uuidv7(), kind: "photo", value: 0, note: `media:${mid}`, measured_at: "2026-10-01T07:00:00Z" })),
    }, media,
  });

  it("are taken only as an upload could be (its types, its size)", async () => {
    const h = { ...(await user("fay")), "x-motus": "1" };
    const html = uuidv7(), big = uuidv7();
    const file = fileWith({ [html]: `data:text/html;base64,${Buffer.from("<b>hi</b>").toString("base64")}`, [big]: `data:image/png;base64,${Buffer.alloc(31 * 1024 * 1024).toString("base64")}` });
    expect((await app.inject({ method: "POST", url: "/api/import", headers: h, payload: { data: file, mode: "merge" } })).statusCode).toBe(200);
    expect(await mediaRows("fay")).toBe(0);
    const notes = (await app.inject({ method: "GET", url: "/api/body?kind=photo", headers: h })).json().map((r: any) => r.note);
    expect(notes.some((n: string) => n.includes("data:"))).toBe(false);
  }, 60000);

  // the id a restore gives a photo in this account (as the server makes it)
  const restoredId = (userId: string, mid: string) => { const h = crypto.createHash("md5").update(`${userId}:media:${mid}`).digest("hex"); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`; };

  it("a photo restored again keeps its file, and one whose file went missing gets it back", async () => {
    const h = { ...(await user("kim")), "x-motus": "1" };
    const uid = await idOf("kim"), mid = uuidv7(), png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9]);
    const file = fileWith({ [mid]: `data:image/png;base64,${png.toString("base64")}` });
    const id = restoredId(uid, mid), d = path.join(dir, "media", uid);
    expect((await app.inject({ method: "POST", url: "/api/import", headers: h, payload: { data: structuredClone(file), mode: "merge" } })).statusCode).toBe(200);
    // the row is there already: the second write is dropped, the kept file stays, no leftovers
    expect((await app.inject({ method: "POST", url: "/api/import", headers: h, payload: { data: structuredClone(file), mode: "merge" } })).statusCode).toBe(200);
    expect(fs.readdirSync(d)).toEqual([id]);
    expect((await app.inject({ method: "GET", url: `/api/media/${id}`, headers: h })).rawPayload.equals(png)).toBe(true);
    fs.rmSync(path.join(d, id));
    expect((await app.inject({ method: "POST", url: "/api/import", headers: h, payload: { data: structuredClone(file), mode: "merge" } })).statusCode).toBe(200);
    expect(fs.readdirSync(d)).toEqual([id]);
    expect(await mediaRows("kim")).toBe(1);
  });

  it("a failed restore removes only the photos it made, not ones it found", async () => {
    const h = { ...(await user("lea")), "x-motus": "1" };
    const uid = await idOf("lea"), old = uuidv7(), fresh = uuidv7(), png = `data:image/png;base64,${Buffer.from([1, 2, 3]).toString("base64")}`;
    expect((await app.inject({ method: "POST", url: "/api/import", headers: h, payload: { data: fileWith({ [old]: png }), mode: "merge" } })).statusCode).toBe(200);
    const r = await app.inject({ method: "POST", url: "/api/import", headers: h, payload: { data: fileWith({ [old]: png, [fresh]: png }, ["routines"]), mode: "replace" } });
    expect(r.statusCode).toBe(400);
    expect(await mediaRows("lea")).toBe(1);
    expect(fs.readdirSync(path.join(dir, "media", uid))).toEqual([restoredId(uid, old)]);
  });

  it("are removed again when the restore fails", async () => {
    const h = { ...(await user("gil")), "x-motus": "1" };
    // a file with only some parts can't replace everything: the engine refuses it after the photos were written
    const file = fileWith({ [uuidv7()]: `data:image/png;base64,${Buffer.from([1, 2, 3]).toString("base64")}` }, ["routines"]);
    const r = await app.inject({ method: "POST", url: "/api/import", headers: h, payload: { data: file, mode: "replace" } });
    expect(r.statusCode).toBe(400);
    expect(await mediaRows("gil")).toBe(0);
    const d = path.join(dir, "media", await idOf("gil"));
    expect(fs.existsSync(d) ? fs.readdirSync(d) : []).toEqual([]);
  });
});

describe("backups and restores at once", () => {
  it("one at a time per person and a few on the server; the rest are told to try again", async () => {
    const { PassThrough } = await import("node:stream");
    const [h1, h2, h3] = await Promise.all(["hal", "ida", "jon"].map(async (n) => ({ ...(await user(n)), "x-motus": "1", "content-type": "application/json" })));
    // a restore whose file is still arriving holds its place
    const slow = (h: Record<string, string>) => {
      const body = new PassThrough();
      const done = app.inject({ method: "POST", url: "/api/import", headers: { ...h, "content-type": "application/json" }, payload: body });
      return { body, done };
    };
    const a = slow(h1!);
    await new Promise((ok) => setTimeout(ok, 50));
    for (const r of [await app.inject({ method: "GET", url: "/api/export", headers: h1 }), await app.inject({ method: "POST", url: "/api/import", headers: h1, payload: "{}" })]) {
      expect(r.statusCode).toBe(429);
      expect(r.json().error).toBe("A backup or restore is already running. Try again in a moment.");
    }
    const b = slow(h2!);
    await new Promise((ok) => setTimeout(ok, 50));
    expect((await app.inject({ method: "GET", url: "/api/export", headers: h3 })).statusCode).toBe(429); // the server's two are taken
    const empty = JSON.stringify({ data: { app: "motus", format: 1, tables: {} }, mode: "merge" });
    a.body.end(empty); b.body.end(empty);
    expect((await a.done).statusCode).toBe(200);
    expect((await b.done).statusCode).toBe(200);
    // given back once answered
    expect((await app.inject({ method: "GET", url: "/api/export", headers: h1 })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/export", headers: h3 })).statusCode).toBe(200);
  });

  it("a restore keeps its place until it's done, even when its client goes away after sending the file", async () => {
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), "motus-server-test-"));
    const db2 = await pgliteDb("memory://");
    const { app: srv, engine } = await buildApp({ db: db2, dataDir: d2 });
    try {
      await db2.admin.query("INSERT INTO users (id, username, password_hash, role) VALUES ($1,$2,$3,'user')", [uuidv7(), "max", await hashPassword(PW)]);
      const h = { authorization: `Bearer ${(await srv.inject({ method: "POST", url: "/api/auth/login", payload: { username: "max", password: PW, wantToken: true } })).json().token}`, "x-motus": "1" };
      // the engine's import waits until let go, so the first restore is still working when the second comes
      const real = engine.handle.bind(engine);
      let entered!: () => void, letGo!: () => void, finished!: () => void;
      const inside = new Promise<void>((ok) => (entered = ok)), gate = new Promise<void>((ok) => (letGo = ok)), done = new Promise<void>((ok) => (finished = ok));
      (engine as any).handle = async (r: any) => {
        if (r.path !== "/import") return real(r);
        entered(); await gate;
        try { return await real(r); } finally { setTimeout(finished, 20); }
      };
      await srv.listen({ port: 0, host: "127.0.0.1" });
      const port = (srv.server.address() as any).port;
      const mid = uuidv7();
      const body = JSON.stringify({ mode: "merge", data: { app: "motus", format: 1, schema: 36, parts: ["other"], tables: { body_metrics: [{ id: uuidv7(), kind: "photo", value: 0, note: `media:${mid}`, measured_at: "2026-10-01T07:00:00Z" }] }, media: { [mid]: `data:image/png;base64,${Buffer.from([7, 7, 7]).toString("base64")}` } } });
      const first = http.request({ port, host: "127.0.0.1", method: "POST", path: "/api/import", headers: { ...h, "content-type": "application/json", "content-length": Buffer.byteLength(body) } });
      first.on("error", () => {});
      first.end(body);
      await inside;
      first.destroy(); // the client gives up after sending the whole file
      await new Promise((ok) => setTimeout(ok, 100));
      const retry = await srv.inject({ method: "POST", url: "/api/import", headers: { ...h, "content-type": "application/json" }, payload: body });
      expect(retry.statusCode).toBe(429);
      expect((await srv.inject({ method: "GET", url: "/api/export", headers: h })).statusCode).toBe(429);
      letGo(); await done;
      expect((await srv.inject({ method: "POST", url: "/api/import", headers: { ...h, "content-type": "application/json" }, payload: body })).statusCode).toBe(200);
      const uid = ((await db2.admin.query("SELECT id FROM users WHERE username = 'max'")).rows[0] as any).id;
      expect(Number(((await db2.admin.query("SELECT count(*) n FROM media")).rows[0] as any).n)).toBe(1);
      expect(fs.readdirSync(path.join(d2, "media", uid))).toHaveLength(1);
    } finally { await srv.close(); await db2.close(); fs.rmSync(d2, { recursive: true, force: true }); }
  }, 60000);

  it("asks for a sign-in before taking a restore's file", async () => {
    expect((await app.inject({ method: "POST", url: "/api/import", payload: { data: {} } })).statusCode).toBe(401);
  });
});
