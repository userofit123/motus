// The self-hosted server: sign-in and accounts, the engine behind /api, live updates over SSE,
// uploaded media, the exercise photos, update checks, and (in production) the web app itself.
import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import fstatic from "@fastify/static";
import { createEngine, uuidv7, withUser, type Db, type Engine } from "@motus/engine";
import { hashPassword, checkPassword, createSession, deviceLabel, userForToken, tooManyTries, recordFail, validUsername, passwordProblem, newInviteCode, COOKIE, SESSION_DAYS, type SessionUser } from "./auth";
import { VERSION, API_LEVEL, checkForUpdate } from "./version";

export interface Options { db: Db; dataDir: string; webDir?: string; imagesDir?: string; logger?: boolean; host?: string }

/** A local (on-device) account: one person, signed in automatically by the desktop app. Returns a session token for them. */
export async function localSession(db: Db, name = "Me"): Promise<string> {
  let u = (await db.admin.query("SELECT id FROM users ORDER BY created_at LIMIT 1")).rows[0];
  if (!u) { u = { id: uuidv7() }; await db.admin.query("INSERT INTO users (id, username, display_name, role) VALUES ($1, 'me', $2, 'admin')", [u.id, name]); }
  return createSession(db, u.id, "This computer", "desktop");
}

declare module "fastify" { interface FastifyRequest { user: SessionUser | null } }

export async function buildApp(o: Options): Promise<{ app: FastifyInstance; engine: Engine }> {
  const engine = await createEngine(o.db, { mode: "server" });
  const db = o.db;
  const app = Fastify({ logger: o.logger ?? false, bodyLimit: 30 * 1024 * 1024, trustProxy: true });
  await app.register(cookie);
  app.decorateRequest("user", null);
  for (const t of ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/heic", "image/heif", "video/mp4", "application/octet-stream"])
    app.addContentTypeParser(t, { parseAs: "buffer", bodyLimit: 30 * 1024 * 1024 }, (_r, body, done) => done(null, body));

  const meta = async (k: string, fallback: unknown) => (await db.admin.query("SELECT value FROM app_meta WHERE key = $1", [k])).rows[0]?.value ?? fallback;
  const setMeta = (k: string, v: unknown) => db.admin.query("INSERT INTO app_meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2", [k, JSON.stringify(v)]);

  // who is asking: the session cookie (browser) or "Authorization: Bearer <token>" (apps)
  app.addHook("onRequest", async (req) => {
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
    req.user = await userForToken(db, bearer ?? req.cookies[COOKIE]);
  });
  // cookie sign-ins must send the X-Motus header on changes: other sites cannot add it, so they cannot act for you
  app.addHook("preHandler", async (req, reply) => {
    if (req.method !== "GET" && req.method !== "HEAD" && req.cookies[COOKIE] && !req.headers.authorization && req.headers["x-motus"] !== "1" && req.url.startsWith("/api/"))
      return reply.code(403).send({ error: "Missing X-Motus header" });
  });
  const need = (req: FastifyRequest, reply: FastifyReply) => { if (!req.user) { reply.code(401).send({ error: "Sign in first" }); return false; } return true; };
  const needAdmin = (req: FastifyRequest, reply: FastifyReply) => { if (!need(req, reply)) return false; if (req.user!.role !== "admin") { reply.code(403).send({ error: "Admins only" }); return false; } return true; };
  const setCookie = (req: FastifyRequest, reply: FastifyReply, token: string) =>
    reply.setCookie(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: req.protocol === "https", path: "/", maxAge: SESSION_DAYS * 86400 });

  // ----- sign-in -----
  app.get("/api/auth/status", async (req) => {
    const users = Number((await db.admin.query("SELECT count(*) n FROM users")).rows[0].n);
    return { setupNeeded: users === 0, registration: await meta("registration", "invite"), user: req.user ? { id: req.user.id, username: req.user.username, role: req.user.role } : null, version: VERSION, apiLevel: API_LEVEL };
  });
  app.post("/api/auth/setup", async (req, reply) => {
    const b = req.body as any;
    if (Number((await db.admin.query("SELECT count(*) n FROM users")).rows[0].n) > 0) return reply.code(409).send({ error: "Already set up" });
    if (!validUsername(b?.username)) return reply.code(400).send({ error: "Use 2-40 letters, numbers, dots, dashes or underscores for the username" });
    const bad = passwordProblem(b?.password, b?.username); if (bad) return reply.code(400).send({ error: bad });
    const id = uuidv7();
    await db.admin.query("INSERT INTO users (id, username, password_hash, role, display_name) VALUES ($1,$2,$3,'admin',$4)", [id, b.username.toLowerCase(), await hashPassword(b.password), String(b.displayName ?? b.username).slice(0, 80)]);
    const token = await createSession(db, id, deviceLabel(b.deviceName, req.headers["user-agent"]), String(b.platform ?? "web"));
    setCookie(req, reply, token);
    return { ok: true, token: b.wantToken ? token : undefined };
  });
  app.post("/api/auth/login", async (req, reply) => {
    const b = req.body as any;
    const name = String(b?.username ?? "").toLowerCase();
    const keys = [`ip:${req.ip}`, `u:${name}`];
    if (tooManyTries(keys)) return reply.code(429).send({ error: "Too many tries. Wait 15 minutes." });
    const u = (await db.admin.query("SELECT id, password_hash, disabled_at FROM users WHERE username = $1", [name])).rows[0];
    const ok = await checkPassword(String(b?.password ?? ""), u?.password_hash ?? null);
    if (!u || !ok || u.disabled_at) { recordFail(keys); return reply.code(401).send({ error: "Wrong username or password" }); }
    const token = await createSession(db, u.id, deviceLabel(b.deviceName, req.headers["user-agent"]), String(b.platform ?? "web"));
    setCookie(req, reply, token);
    return { ok: true, token: b.wantToken ? token : undefined };
  });
  app.post("/api/auth/register", async (req, reply) => {
    const b = req.body as any;
    const mode = await meta("registration", "invite");
    if (mode === "closed") return reply.code(403).send({ error: "Ask the admin to create your account" });
    if (!validUsername(b?.username)) return reply.code(400).send({ error: "Use 2-40 letters, numbers, dots, dashes or underscores for the username" });
    const bad = passwordProblem(b?.password, b?.username); if (bad) return reply.code(400).send({ error: bad });
    if (mode === "invite") {
      const inv = (await db.admin.query("SELECT code FROM invites WHERE code = $1 AND used_by IS NULL AND expires_at > now()", [String(b.invite ?? "")])).rows[0];
      if (!inv) return reply.code(403).send({ error: "That invite code is not valid" });
    }
    if ((await db.admin.query("SELECT 1 FROM users WHERE username = $1", [b.username.toLowerCase()])).rows.length) return reply.code(409).send({ error: "That username is taken" });
    const id = uuidv7();
    await db.admin.query("INSERT INTO users (id, username, password_hash, display_name) VALUES ($1,$2,$3,$4)", [id, b.username.toLowerCase(), await hashPassword(b.password), String(b.displayName ?? b.username).slice(0, 80)]);
    if (mode === "invite") await db.admin.query("UPDATE invites SET used_by = $2 WHERE code = $1", [b.invite, id]);
    const token = await createSession(db, id, deviceLabel(b.deviceName, req.headers["user-agent"]), String(b.platform ?? "web"));
    setCookie(req, reply, token);
    return { ok: true, token: b.wantToken ? token : undefined };
  });
  app.post("/api/auth/logout", async (req, reply) => {
    if (req.user) await db.admin.query("DELETE FROM sessions WHERE id = $1", [req.user.sessionId]);
    reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });
  app.get("/api/auth/sessions", async (req, reply) => {
    if (!need(req, reply)) return;
    const { rows } = await db.admin.query("SELECT id, device_name, platform, created_at, last_seen_at FROM sessions WHERE user_id = $1 AND expires_at > now() ORDER BY last_seen_at DESC", [req.user!.id]);
    return rows.map((r: any) => ({ id: r.id, deviceName: r.device_name, platform: r.platform, createdAt: r.created_at, lastSeenAt: r.last_seen_at, current: r.id === req.user!.sessionId }));
  });
  app.delete("/api/auth/sessions/:id", async (req, reply) => {
    if (!need(req, reply)) return;
    await db.admin.query("DELETE FROM sessions WHERE id = $1 AND user_id = $2", [(req.params as any).id, req.user!.id]);
    return { ok: true };
  });
  app.post("/api/auth/logout-others", async (req, reply) => {
    if (!need(req, reply)) return;
    await db.admin.query("DELETE FROM sessions WHERE user_id = $1 AND id <> $2 AND platform <> 'api'", [req.user!.id, req.user!.sessionId]);
    return { ok: true };
  });
  // asking for the password again (changing it, deleting the account): the same check and the same wait after
  // too many tries as signing in, so a device left signed in can't be used to guess it. A wrong password is a 403,
  // not a 401: the app signs out on a 401, and a typo shouldn't do that.
  const recheck = async (req: FastifyRequest, reply: FastifyReply, password: unknown, hash: string | null) => {
    const keys = [`ip:${req.ip}`, `u:${req.user!.username}`];
    if (tooManyTries(keys)) { reply.code(429).send({ error: "Too many tries. Wait 15 minutes." }); return false; }
    if (await checkPassword(String(password ?? ""), hash)) return true;
    recordFail(keys);
    reply.code(403).send({ error: "Wrong password" });
    return false;
  };
  app.put("/api/auth/password", async (req, reply) => {
    if (!need(req, reply)) return;
    const b = req.body as any;
    const u = (await db.admin.query("SELECT password_hash FROM users WHERE id = $1", [req.user!.id])).rows[0];
    if (!(await recheck(req, reply, b?.current, u.password_hash))) return;
    const bad = passwordProblem(b?.next, req.user!.username); if (bad) return reply.code(400).send({ error: bad });
    await db.admin.query("UPDATE users SET password_hash = $2 WHERE id = $1", [req.user!.id, await hashPassword(b.next)]);
    await db.admin.query("DELETE FROM sessions WHERE user_id = $1 AND id <> $2", [req.user!.id, req.user!.sessionId]);
    return { ok: true };
  });
  app.delete("/api/auth/account", async (req, reply) => {
    if (!need(req, reply)) return;
    const b = req.body as any;
    const u = (await db.admin.query("SELECT password_hash, role FROM users WHERE id = $1", [req.user!.id])).rows[0];
    if (!(await recheck(req, reply, b?.password, u.password_hash))) return;
    // the last admin may only leave when nobody else is left without one; alone on the server, the account just goes
    // and the server is back to first-run setup
    if (u.role === "admin") {
      const n = (await db.admin.query("SELECT count(*) FILTER (WHERE role = 'admin') admins, count(*) everyone FROM users")).rows[0];
      if (Number(n.admins) === 1 && Number(n.everyone) > 1)
        return reply.code(400).send({ error: "Other people use this server and you are its only admin. Make one of them admin first." });
    }
    await db.admin.query("DELETE FROM users WHERE id = $1", [req.user!.id]);
    reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });

  // personal API tokens (Settings → Integrations): a session that never expires by use, for scripts and dashboards
  app.post("/api/auth/tokens", async (req, reply) => {
    if (!need(req, reply)) return;
    const name = String((req.body as any)?.name ?? "API token").slice(0, 60);
    const token = await createSession(db, req.user!.id, name, "api");
    await db.admin.query("UPDATE sessions SET expires_at = now() + interval '10 years' WHERE token_hash = encode(sha256($1::bytea), 'hex')", [token]);
    return { token };
  });
  // a GPX or TCX file posted as it is (e.g. FitoTrack's or OpenTracks' automatic export), with an API token
  app.addContentTypeParser(["application/gpx+xml", "application/vnd.garmin.tcx+xml", "text/xml", "application/xml"], { parseAs: "string", bodyLimit: 30 * 1024 * 1024 }, (_r, body, done) => done(null, body));
  app.post("/api/upload/track", async (req, reply) => {
    if (!need(req, reply)) return;
    const text = typeof req.body === "string" ? req.body : Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
    const res = await engine.handle({ method: "POST", path: "/activities/import", body: { files: [{ name: String((req.query as any)?.name ?? ""), text }], type: (req.query as any)?.type }, userId: req.user!.id });
    return reply.code(res.status).send(res.body);
  });
  // sending a copy of a routine to another person on this server (their own exercises are copied along)
  app.post("/api/share/routine", async (req, reply) => {
    if (!need(req, reply)) return;
    const b = req.body as any;
    const to = (await db.admin.query("SELECT id FROM users WHERE username = $1 AND disabled_at IS NULL", [String(b?.username ?? "").toLowerCase()])).rows[0];
    if (!to) return reply.code(404).send({ error: "No one with that username on this server" });
    if (to.id === req.user!.id) return reply.code(400).send({ error: "That's you" });
    const src = await engine.handle({ method: "GET", path: `/routines/${b.routineId}`, userId: req.user!.id });
    if (src.status !== 200) return reply.code(src.status).send(src.body);
    const r = src.body as any;
    const map = new Map<string, string>();
    for (const e of r.exercises) {
      if (!e.exercise?.ownerId || map.has(e.exerciseId)) continue;
      const made = await engine.handle({ method: "POST", path: "/exercises", body: { ...e.exercise, images: (e.exercise.images ?? []).filter((x: string) => !x.startsWith("media:")) }, userId: to.id });
      if (made.status === 200) map.set(e.exerciseId, (made.body as any).id);
    }
    const sender = (await db.admin.query("SELECT display_name, username FROM users WHERE id = $1", [req.user!.id])).rows[0];
    const out = await engine.handle({ method: "POST", path: "/routines", userId: to.id, body: {
      name: `${r.name} (from ${sender.display_name || sender.username})`, description: r.description,
      exercises: r.exercises.map((e: any) => ({ ...e, id: undefined, exerciseId: map.get(e.exerciseId) ?? e.exerciseId })) } });
    return reply.code(out.status).send(out.status === 200 ? { ok: true } : out.body);
  });

  // ----- admin -----
  app.get("/api/admin/users", async (req, reply) => {
    if (!needAdmin(req, reply)) return;
    const { rows } = await db.admin.query(
      `SELECT u.id, u.username, u.display_name, u.role, u.created_at, u.disabled_at, (SELECT max(last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen_at FROM users u ORDER BY u.created_at`);
    return rows.map((r: any) => ({ id: r.id, username: r.username, displayName: r.display_name, role: r.role, createdAt: r.created_at, disabled: !!r.disabled_at, lastSeenAt: r.last_seen_at }));
  });
  app.post("/api/admin/users", async (req, reply) => {
    if (!needAdmin(req, reply)) return;
    const b = req.body as any;
    if (!validUsername(b?.username)) return reply.code(400).send({ error: "Invalid username" });
    const bad = passwordProblem(b?.password, b?.username); if (bad) return reply.code(400).send({ error: bad });
    if ((await db.admin.query("SELECT 1 FROM users WHERE username = $1", [b.username.toLowerCase()])).rows.length) return reply.code(409).send({ error: "That username is taken" });
    const id = uuidv7();
    await db.admin.query("INSERT INTO users (id, username, password_hash, role, display_name) VALUES ($1,$2,$3,$4,$5)",
      [id, b.username.toLowerCase(), await hashPassword(b.password), b.role === "admin" ? "admin" : "user", String(b.displayName ?? b.username).slice(0, 80)]);
    return { id };
  });
  app.put("/api/admin/users/:id", async (req, reply) => {
    if (!needAdmin(req, reply)) return;
    const b = req.body as any, id = (req.params as any).id;
    if (id === req.user!.id && (b.role === "user" || b.disabled)) return reply.code(400).send({ error: "You can't remove your own admin access" });
    if (b.password) {
      const who = (await db.admin.query("SELECT username FROM users WHERE id = $1", [id])).rows[0];
      const bad = passwordProblem(b.password, who?.username); if (bad) return reply.code(400).send({ error: bad });
      await db.admin.query("UPDATE users SET password_hash = $2 WHERE id = $1", [id, await hashPassword(b.password)]); await db.admin.query("DELETE FROM sessions WHERE user_id = $1", [id]);
    }
    if (b.role) await db.admin.query("UPDATE users SET role = $2 WHERE id = $1", [id, b.role === "admin" ? "admin" : "user"]);
    if (typeof b.disabled === "boolean") { await db.admin.query("UPDATE users SET disabled_at = CASE WHEN $2 THEN now() ELSE NULL END WHERE id = $1", [id, b.disabled]); if (b.disabled) await db.admin.query("DELETE FROM sessions WHERE user_id = $1", [id]); }
    return { ok: true };
  });
  app.delete("/api/admin/users/:id", async (req, reply) => {
    if (!needAdmin(req, reply)) return;
    const id = (req.params as any).id;
    if (id === req.user!.id) return reply.code(400).send({ error: "Delete your own account from Settings → Account" });
    await db.admin.query("DELETE FROM users WHERE id = $1", [id]);
    return { ok: true };
  });
  app.get("/api/admin/settings", async (req, reply) => {
    if (!needAdmin(req, reply)) return;
    const invites = (await db.admin.query("SELECT code, created_at, expires_at, used_by FROM invites ORDER BY created_at DESC LIMIT 20")).rows;
    return { registration: await meta("registration", "invite"), invites: invites.map((i: any) => ({ code: i.code, createdAt: i.created_at, expiresAt: i.expires_at, used: !!i.used_by })) };
  });
  app.put("/api/admin/settings", async (req, reply) => {
    if (!needAdmin(req, reply)) return;
    const b = req.body as any;
    if (["closed", "invite", "open"].includes(b?.registration)) await setMeta("registration", b.registration);
    return { ok: true };
  });
  app.post("/api/admin/invites", async (req, reply) => {
    if (!needAdmin(req, reply)) return;
    const code = newInviteCode();
    await db.admin.query("INSERT INTO invites (code, created_by, expires_at) VALUES ($1,$2, now() + interval '14 days')", [code, req.user!.id]);
    return { code };
  });

  // ----- version and updates -----
  app.get("/api/version", async () => ({ version: VERSION, apiLevel: API_LEVEL }));
  app.get("/api/update-check", async () => checkForUpdate());

  // ----- live updates: one stream per signed-in person -----
  const streams = new Map<string, Set<FastifyReply>>();
  engine.onChange((userId, topics) => {
    for (const r of streams.get(userId) ?? []) r.raw.write(`event: change\ndata: ${JSON.stringify({ topics, at: Date.now() })}\n\n`);
  });
  app.get("/api/events", async (req, reply) => {
    if (!need(req, reply)) return;
    reply.raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
    reply.raw.write(`event: hello\ndata: {}\n\n`);
    const set = streams.get(req.user!.id) ?? new Set();
    streams.set(req.user!.id, set);
    set.add(reply);
    const ping = setInterval(() => reply.raw.write(": ping\n\n"), 25000);
    req.raw.on("close", () => { clearInterval(ping); set.delete(reply); });
    return reply;
  });

  // ----- media: photos and videos people upload (custom exercises, progress photos) -----
  const mediaDir = path.join(o.dataDir, "media");
  fs.mkdirSync(mediaDir, { recursive: true });
  app.post("/api/media", async (req, reply) => {
    if (!need(req, reply)) return;
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || !buf.length) return reply.code(400).send({ error: "Send the file as the request body" });
    const mime = String(req.headers["content-type"]);
    const id = uuidv7();
    const dir = path.join(mediaDir, req.user!.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, id), buf, { mode: 0o600 });
    await withUser(db, req.user!.id, (q) => q.query("INSERT INTO media (id, user_id, kind, mime, size, path) VALUES ($1,$2,$3,$4,$5,$6)",
      [id, req.user!.id, mime.startsWith("video") ? "video" : "image", mime, buf.length, `${req.user!.id}/${id}`]));
    return { id, url: `/api/media/${id}` };
  });
  app.get("/api/media/:id", async (req, reply) => {
    if (!need(req, reply)) return;
    const id = (req.params as any).id;
    if (!/^[0-9a-f-]{36}$/.test(id)) return reply.code(404).send();
    const m = await withUser(db, req.user!.id, async (q) => (await q.query("SELECT mime, path FROM media WHERE id = $1", [id])).rows[0]);
    if (!m) return reply.code(404).send({ error: "Not found" });
    reply.header("content-type", m.mime).header("cache-control", "private, max-age=31536000, immutable");
    return reply.send(fs.createReadStream(path.join(mediaDir, m.path)));
  });

  // ----- everything else under /api: the engine -----
  app.all("/api/*", async (req, reply) => {
    if (!need(req, reply)) return;
    const url = new URL(req.url, "http://x");
    const res = await engine.handle({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body: req.body, userId: req.user!.id });
    return reply.code(res.status).send(res.body);
  });

  // ----- the exercise library's photos, and the web app -----
  if (o.imagesDir && fs.existsSync(o.imagesDir))
    await app.register(fstatic, { root: o.imagesDir, prefix: "/exercise-images/", decorateReply: false, maxAge: "30d", immutable: true });
  if (o.webDir && fs.existsSync(o.webDir)) {
    // files are looked up on each request (a rebuild adds new ones); built files have content-hashed names, so they can be kept for good
    await app.register(fstatic, { root: o.webDir, prefix: "/", wildcard: true, decorateReply: true, cacheControl: false,
      setHeaders: (res, file) => res.setHeader("cache-control", /[\\/]assets[\\/]/.test(file) ? "public, max-age=31536000, immutable" : "no-cache") });
    app.setNotFoundHandler((req, reply) => (req.url.startsWith("/api/") ? reply.code(404).send({ error: "Not found" }) : reply.type("text/html").sendFile("index.html")));
  }
  app.setErrorHandler((err, req, reply) => {
    req.log.error(err);
    reply.code(err.statusCode && err.statusCode < 500 ? err.statusCode : 500).send({ error: err.statusCode && err.statusCode < 500 ? err.message : "Something went wrong on the server" });
  });
  return { app, engine };
}
