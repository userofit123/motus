// Deleting your own account asks for the password again: a wrong one is refused without signing you out,
// too many wrong ones wait like sign-in does, and the right one deletes everything.
// The only admin can always delete their account; the longest-standing person left then becomes admin.
// Also here: no way of choosing a password (first setup, invite sign-up, own change, admin) accepts the username.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { pgliteDb } from "@motus/engine/pglite";
import { uuidv7, type Db } from "@motus/engine";
import { buildApp } from "../src/app";
import { hashPassword, createSession } from "../src/auth";

let app: FastifyInstance, db: Db, dir: string;
const PW = "correct horse";

async function user(name: string, role = "user") {
  await db.admin.query("INSERT INTO users (id, username, password_hash, role) VALUES ($1,$2,$3,$4)", [uuidv7(), name, await hashPassword(PW), role]);
  const r = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: name, password: PW, wantToken: true } });
  return { authorization: `Bearer ${r.json().token}` };
}
const del = (headers: Record<string, string>, password?: string) =>
  app.inject({ method: "DELETE", url: "/api/auth/account", headers, payload: password === undefined ? {} : { password } });
const signedIn = async (headers: Record<string, string>) => (await app.inject({ method: "GET", url: "/api/auth/sessions", headers })).statusCode === 200;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "motus-server-test-"));
  db = await pgliteDb("memory://");
  ({ app } = await buildApp({ db, dataDir: dir }));
  await user("boss", "admin");
}, 120000);
afterAll(async () => { await app.close(); await db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe("deleting your own account", () => {
  it("needs the right password and keeps you signed in when it is wrong", async () => {
    const h = await user("ann");
    expect((await del(h)).statusCode).toBe(403);
    const wrong = await del(h, "not it");
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().error).toBe("Wrong password");
    expect(await signedIn(h)).toBe(true);
    expect((await db.admin.query("SELECT 1 FROM users WHERE username = 'ann'")).rows.length).toBe(1);

    expect((await del(h, PW)).statusCode).toBe(200);
    expect((await db.admin.query("SELECT 1 FROM users WHERE username = 'ann'")).rows.length).toBe(0);
    expect(await signedIn(h)).toBe(false);
  });

  it("waits after too many wrong passwords, like signing in", async () => {
    const h = await user("bob");
    // the wrong tries above count too (same address), so the wait may start before the fifth here
    for (let i = 0; i < 5; i++) expect([403, 429]).toContain((await del(h, "guess " + i)).statusCode);
    expect((await del(h, PW)).statusCode).toBe(429);
    expect((await db.admin.query("SELECT 1 FROM users WHERE username = 'bob'")).rows.length).toBe(1);
  });
});

describe("the only admin deleting their account", () => {
  it("goes through while other people use the server, and the longest-standing one becomes admin", async () => {
    // sessions made directly and a fresh address: the wrong passwords above have put the default address on the wait
    const id = uuidv7();
    await db.admin.query("INSERT INTO users (id, username, password_hash, role) VALUES ($1,'solo',$2,'admin')", [id, await hashPassword(PW)]);
    const h = { authorization: `Bearer ${await createSession(db, id, "Browser", "web")}` };
    await db.admin.query("UPDATE users SET role = 'user' WHERE username = 'boss'");
    try {
      const r = await app.inject({ method: "DELETE", url: "/api/auth/account", headers: h, payload: { password: PW }, remoteAddress: "10.1.2.3" });
      expect(r.statusCode).toBe(200);
      expect((await db.admin.query("SELECT 1 FROM users WHERE username = 'solo'")).rows.length).toBe(0);
      expect((await db.admin.query("SELECT role FROM users WHERE username = 'boss'")).rows[0].role).toBe("admin");
    } finally { await db.admin.query("UPDATE users SET role = 'admin' WHERE username = 'boss'"); }
  });

  it("goes through when they are the only person, and the server is back to first-run setup", async () => {
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), "motus-server-test-"));
    const db2 = await pgliteDb("memory://");
    const { app: a2 } = await buildApp({ db: db2, dataDir: d2 });
    try {
      const id = uuidv7();
      await db2.admin.query("INSERT INTO users (id, username, password_hash, role) VALUES ($1,'only',$2,'admin')", [id, await hashPassword(PW)]);
      const t = await createSession(db2, id, "Browser", "web");
      const r = await a2.inject({ method: "DELETE", url: "/api/auth/account", headers: { authorization: `Bearer ${t}` }, payload: { password: PW }, remoteAddress: "10.1.2.4" });
      expect(r.statusCode).toBe(200);
      expect((await a2.inject({ method: "GET", url: "/api/auth/status" })).json().setupNeeded).toBe(true);
    } finally { await a2.close(); await db2.close(); fs.rmSync(d2, { recursive: true, force: true }); }
  }, 120000);
});

describe("signing out the other devices", () => {
  it("leaves API tokens alone", async () => {
    // a session made directly: the earlier wrong passwords here have put this address on the sign-in wait
    const id = uuidv7();
    await db.admin.query("INSERT INTO users (id, username, password_hash) VALUES ($1,$2,$3)", [id, "cy", await hashPassword(PW)]);
    const h = { authorization: `Bearer ${await createSession(db, id, "Browser", "web")}` };
    const api = { authorization: `Bearer ${await createSession(db, id, "script", "api")}` };
    expect((await app.inject({ method: "POST", url: "/api/auth/logout-others", headers: h })).statusCode).toBe(200);
    expect(await signedIn(api)).toBe(true);
    expect(await signedIn(h)).toBe(true);
  });
});

describe("a password the same as the username", () => {
  it("is refused when an account is made or its password reset", async () => {
    // a session made directly: the earlier wrong passwords here have put this address on the sign-in wait
    const id = uuidv7();
    await db.admin.query("INSERT INTO users (id, username, password_hash, role) VALUES ($1,$2,$3,'admin')", [id, "dee", await hashPassword(PW)]);
    const h = { authorization: `Bearer ${await createSession(db, id, "Browser", "web")}` };
    const made = await app.inject({ method: "POST", url: "/api/admin/users", headers: h, payload: { username: "qwerty123", password: "Qwerty123" } });
    expect(made.statusCode).toBe(400);
    expect(made.json().error).toBe("The password can't be the same as the username");
    const ok = await app.inject({ method: "POST", url: "/api/admin/users", headers: h, payload: { username: "robinhood", password: PW } });
    expect(ok.statusCode).toBe(200);
    const reset = await app.inject({ method: "PUT", url: `/api/admin/users/${ok.json().id}`, headers: h, payload: { password: "RobinHood" } });
    expect(reset.statusCode).toBe(400);
    expect(reset.json().error).toBe("The password can't be the same as the username");
  });
});

describe("a password the same as the username, on the other ways in", () => {
  const SAME = "The password can't be the same as the username";

  it("is refused when changing your own password", async () => {
    const id = uuidv7();
    await db.admin.query("INSERT INTO users (id, username, password_hash) VALUES ($1,$2,$3)", [id, "gustavo1", await hashPassword(PW)]);
    const h = { authorization: `Bearer ${await createSession(db, id, "Browser", "web")}` };
    // another address: the wrong passwords above have put the test address on the wait
    const r = await app.inject({ method: "PUT", url: "/api/auth/password", headers: h, remoteAddress: "10.9.8.7", payload: { current: PW, next: "Gustavo1" } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe(SAME);
  });

  it("is refused when signing up with an invite", async () => {
    await db.admin.query("INSERT INTO invites (code, created_by, expires_at) VALUES ('same-pw', (SELECT id FROM users WHERE username = 'boss'), now() + interval '1 day')");
    const r = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "hal900000", password: "HAL900000", invite: "same-pw" } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe(SAME);
    expect((await db.admin.query("SELECT 1 FROM users WHERE username = 'hal900000'")).rows.length).toBe(0);
  });

  it("is refused when creating the first account", async () => {
    // setup only works on a server with no users, so this one is its own
    const db2 = await pgliteDb("memory://");
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "motus-server-test-"));
    const { app: app2 } = await buildApp({ db: db2, dataDir: dir2 });
    try {
      const r = await app2.inject({ method: "POST", url: "/api/auth/setup", payload: { username: "owner9999", password: "Owner9999" } });
      expect(r.statusCode).toBe(400);
      expect(r.json().error).toBe(SAME);
      expect((await db2.admin.query("SELECT 1 FROM users")).rows.length).toBe(0);
    } finally { await app2.close(); await db2.close(); fs.rmSync(dir2, { recursive: true, force: true }); }
  }, 120000);
});
