// A device's copy of a person's data on a server (offline use). The app works on this copy; sync() in the app sends
// what changed here and fetches what changed elsewhere. Kept in app_meta: where in the server's log this copy is,
// how much of its own log has been sent, this device's name for itself, and which catalog it has ('replica'); and the
// rows the server didn't take ('sync_hold', see Hold).
import type { Db, Sql } from "../db";
import { SYNCED } from "./tables";
import { readRows, applyChanges, latestPerRow, keyOf, overrule, perColumn, REFS, RULED, type Change } from "./core";
import { uuidv7 } from "../ids";

/**
 * v: how the copy was made. Copies older than COPY_VERSION are made again from the server (once nothing here is
 * waiting to be sent): one made before M-184 may hold rows another account's sign-in pulled into it (1); one from
 * before M-257 may hold rows the server refused, such as a restore done in the copy before restores went to the
 * server, which a later restore there gave new ids, so the copy showed them twice (2).
 */
export interface ReplicaMeta { cursor: number; pushed: number; device: string; catalog: string; ready: boolean; v: number }
export const COPY_VERSION = 2;

export const replicaMeta = (db: Db) => metaOf(db.admin);
async function metaOf(q: Sql): Promise<ReplicaMeta> {
  const r = (await q.query("SELECT value FROM app_meta WHERE key = 'replica'")).rows[0]?.value;
  return { cursor: 0, pushed: 0, device: "", catalog: "", ready: false, v: 0, ...(r ?? {}) };
}
const saveMeta = (db: Db, patch: Partial<ReplicaMeta>) => saveMetaIn(db.admin, patch);
async function saveMetaIn(q: Sql, patch: Partial<ReplicaMeta>) {
  const next = { ...(await metaOf(q)), ...patch };
  await q.query("INSERT INTO app_meta (key, value) VALUES ('replica', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [JSON.stringify(next)]);
  return next;
}
/**
 * A row the server didn't take when it was sent (modules/sync.ts push), kept in app_meta 'sync_hold' (not a synced
 * table: it is this copy's own business). The row itself stays here as it is. refused: for good (another account's
 * id, a check it breaks...): not sent again unless it changes here again, and left out when the copy is made again
 * after a restore with Replace (remakeCopy) unless it changed here since. Otherwise it failed for a passing reason
 * (a deadlock, a timeout): it still waits to be sent, and is sent again from `next` on (ms), waiting longer after each
 * try (retryWait). at: when it changed here; op: what was sent.
 */
export interface Hold { tbl: string; pk: Record<string, unknown>; at: string; op: "upsert" | "delete"; refused?: boolean; tries?: number; next?: number }
async function holdsIn(q: Sql): Promise<Record<string, Hold>> {
  return (await q.query("SELECT value FROM app_meta WHERE key = 'sync_hold'")).rows[0]?.value ?? {};
}
async function saveHolds(q: Sql, holds: Record<string, Hold>) {
  await q.query("INSERT INTO app_meta (key, value) VALUES ('sync_hold', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [JSON.stringify(holds)]);
}
export const holds = (db: Db) => holdsIn(db.admin);

/**
 * Rows gone from this device when its copy was made again (remakeCopy), kept in app_meta 'sync_removed' until the
 * person has seen the notice about them (clearRemoved), so a failed sync or a closed app doesn't lose the news. Only
 * which rows (table and key): what they held is gone with them.
 */
export interface Removed { tbl: string; pk: Record<string, unknown> }
async function removedIn(q: Sql): Promise<Removed[]> {
  return (await q.query("SELECT value FROM app_meta WHERE key = 'sync_removed'")).rows[0]?.value ?? [];
}
export const removedList = (db: Db) => removedIn(db.admin);
export async function clearRemoved(db: Db) { await db.admin.query("DELETE FROM app_meta WHERE key = 'sync_removed'"); }
/** How long a row that failed for a passing reason waits before its next try: 5 s, doubling, at most 10 minutes. */
export const retryWait = (tries: number) => Math.min(5_000 * 2 ** Math.max(0, Math.min(tries, 20) - 1), 10 * 60_000);

/** The rows changed here and not yet sent, by key (keyOf): the latest log entry of each, and those to be tried again. */
async function unsentIn(q: Sql) {
  const m = await metaOf(q);
  const out = new Map<string, { tbl: string; pk: Record<string, unknown>; at: string; op: string }>();
  for (const h of Object.values(await holdsIn(q))) if (!h.refused) out.set(keyOf(h.tbl, h.pk), h);
  for (const e of latestPerRow((await q.query("SELECT seq, tbl, pk, op, at FROM sync_log WHERE seq > $1 ORDER BY seq", [m.pushed])).rows as any[]))
    out.set(keyOf(e.tbl, e.pk), { tbl: e.tbl, pk: e.pk, op: e.op, at: new Date(e.at).toISOString() });
  return out;
}
/** Rows changed here and not yet sent (read with q, so inside a transaction it is that transaction's view). */
async function waitingIn(q: Sql) {
  return (await unsentIn(q)).size;
}

/** The shared catalog, as the server has it (the same ids, so people's rows can point at it). */
export async function loadCatalog(db: Db, stamp: string, rows: Record<string, unknown>[]) {
  await db.tx(async (q) => {
    for (let i = 0; i < rows.length; i += 200)
      await q.query(`INSERT INTO exercises SELECT * FROM jsonb_populate_recordset(NULL::exercises, $1::jsonb) ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name, aliases = EXCLUDED.aliases, category = EXCLUDED.category, equipment = EXCLUDED.equipment, tracking = EXCLUDED.tracking,
        primary_muscles = EXCLUDED.primary_muscles, secondary_muscles = EXCLUDED.secondary_muscles, instructions = EXCLUDED.instructions,
        images = EXCLUDED.images, archived = EXCLUDED.archived, updated_at = EXCLUDED.updated_at`, [JSON.stringify(rows.slice(i, i + 200))]);
  });
  await saveMeta(db, { catalog: stamp });
}

type Snapshot = { cursor: number; user: any; tables: Record<string, Record<string, unknown>[]> };
/** The first full copy: the person, then every table, parents first. Nothing of this is sent back. */
export async function loadSnapshot(db: Db, snap: Snapshot) {
  return db.tx(async (q) => { await writeSnapshot(q, snap); return snapshotLoaded(q, snap); });
}
async function writeSnapshot(q: Sql, snap: Snapshot) {
  await q.query("SELECT set_config('motus.sync_apply', '1', true)");
  const u = snap.user;
  await q.query(`INSERT INTO users (id, username, display_name, email, role) VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (id) DO UPDATE SET username = $2, display_name = $3, email = $4, role = $5`, [u.id, u.username, u.display_name ?? "", u.email ?? null, u.role ?? "user"]);
  for (const t of SYNCED) {
    const rows = snap.tables[t.name] ?? [];
    for (let i = 0; i < rows.length; i += 200)
      await q.query(`INSERT INTO ${t.name} SELECT * FROM jsonb_populate_recordset(NULL::${t.name}, $1::jsonb) ON CONFLICT DO NOTHING`, [JSON.stringify(rows.slice(i, i + 200))]);
  }
}
// in the same transaction as the rows: a change made here meanwhile is after `pushed` (sent later), never marked sent
async function snapshotLoaded(q: Sql, snap: Snapshot) {
  const pushed = Number((await q.query("SELECT coalesce(max(seq), 0) AS s FROM sync_log")).rows[0].s);
  return saveMetaIn(q, { cursor: snap.cursor, pushed, device: (await metaOf(q)).device || uuidv7(), ready: true, v: COPY_VERSION });
}

/** Whether the copy has to be made again from the server (see ReplicaMeta.v). */
export const outdated = (m: ReplicaMeta) => m.ready && m.v < COPY_VERSION;

async function clearRows(q: Sql) {
  await q.query("SELECT set_config('motus.sync_apply', '1', true)");
  for (const t of [...SYNCED].reverse()) await q.query(`DELETE FROM ${t.name}${t.name === "exercises" ? " WHERE owner_id IS NOT NULL" : ""}`);
  await q.query("DELETE FROM sync_log");
}

/**
 * The copy made again from the server's catalog and snapshot (fetched first, so a failed fetch leaves the copy as it
 * was): after a restore with Replace on the server (the pull says reset), or for an outdated copy. Done even when
 * something here waits to be sent (a workout under way writes every few seconds, so waiting for nothing to be
 * waiting could put it off for good): in one transaction, every row waiting to be sent is read as it is here, the copy
 * is emptied and filled from the snapshot, and those rows are written back over it and noted as waiting again, at the
 * time they were changed, so the next send takes them to the server (where the newest change wins, as always).
 * Nothing waiting can be lost on the way: the transaction is all or nothing, and the app's own writes wait for it.
 * Rows the server refused for good are left out (refused, Hold): after a restore with Replace the server's rows are
 * the person's data, and such a row is what showed twice (M-257). A row written back that points at a row in neither
 * the snapshot nor what waits has that reference cleared where the app can do without it; one that can't (a routine's
 * set whose routine is gone) is dropped, as the server would refuse it too. Returns the copy's new state, the rows
 * dropped and the refused rows left out (the app tells the person: they are gone from this device).
 */
export async function remakeCopy(db: Db, cat: { stamp: string; rows: Record<string, unknown>[] }, snap: Snapshot): Promise<ReplicaMeta & { dropped: Change[]; leftOut: Change[] }> {
  // the shared catalog first (the person's rows point at it); taking it in loses nothing, whatever happens next
  await loadCatalog(db, cat.stamp, cat.rows);
  // emptied and filled in one go, so a screen reading meanwhile sees the old rows or the new ones, never none
  return db.tx(async (q) => {
    const userId = String(snap.user.id);
    // a row refused for good stays out: its id is still not one the server takes. Unless it changed here after it was
    // refused (it is in the log again): that change was never sent, and waits like any other
    const held = await holdsIn(q);
    const changed = new Set(((await q.query("SELECT DISTINCT tbl, pk FROM sync_log WHERE seq > $1", [(await metaOf(q)).pushed])).rows as any[]).map((e) => keyOf(e.tbl, e.pk)));
    const out = (k: string) => !!held[k]?.refused && !changed.has(k);
    const unsent = [...(await unsentIn(q)).values()].filter((e) => !out(keyOf(e.tbl, e.pk)));
    const refused = Object.entries(held).filter(([k]) => out(k)).map(([, h]) => h);
    const rows = await readRows(q, [...unsent, ...refused]);
    const asChange = (e: { tbl: string; pk: Record<string, unknown>; at: string }): Change => {
      const row = rows.get(keyOf(e.tbl, e.pk)) ?? null;
      return { tbl: e.tbl, pk: e.pk, op: row ? "upsert" : "delete", at: e.at, row };
    };
    const kept = unsent.map(asChange);
    // only rows that are still here go: a refused deletion's row is already gone
    const leftOut = refused.map(asChange).filter((c) => c.row);
    await clearRows(q);
    await writeSnapshot(q, snap);
    // nothing is in the log now: everything noted below waits to be sent
    const meta = await snapshotLoaded(q, snap);
    await saveHolds(q, {});
    const write = async (cs: Change[]) => (await applyChanges(q, userId, cs, { apply: true })).failed.map((f) => f.change);
    // a deletion that failed here has nothing to delete
    let left = (await write(kept)).filter((c) => c.op === "upsert" && c.row);
    // a row that didn't get in: written again as long as that gets more in (its parent got in meanwhile). Then a
    // reference the app can do without (a workout's routine, a routine's folder) is cleared when the row it points at
    // is neither here nor still waiting to get in (a workout under a routine that only gets in once its folder is
    // cleared keeps its routine); and only when that clears nothing more, also when it points at a row still waiting
    // (which can't get in). Each round clears something or ends, so this comes to an end.
    for (let loose = false; left.length;) {
      let n;
      do { n = left.length; left = await write(left); } while (left.length && left.length < n);
      if (!left.length) break;
      const waiting = new Set(loose ? [] : left.map((c) => keyOf(c.tbl, c.pk)));
      let cleared = false;
      for (const c of left) {
        const row = c.row!;
        for (const ref of REFS[c.tbl] ?? []) {
          const v = row[ref.col], t = v == null || ref.required ? null : typeof ref.table === "string" ? ref.table : ref.table(row);
          if (!t || waiting.has(keyOf(t, { id: v })) || (await readRows(q, [{ tbl: t, pk: { id: v } }])).get(keyOf(t, { id: v }))) continue;
          c.row = { ...c.row, [ref.col]: null };
          cleared = true;
        }
      }
      if (!cleared) { if (loose) break; loose = true; }
    }
    // a row that failed isn't here: noting it would send its deletion
    const lost = new Set(left.map((c) => keyOf(c.tbl, c.pk)));
    for (const c of kept) {
      if (lost.has(keyOf(c.tbl, c.pk))) continue;
      await q.query("INSERT INTO sync_log (user_id, tbl, pk, op, at) VALUES ($1, $2, $3::jsonb, $4, $5)", [userId, c.tbl, JSON.stringify(c.pk), c.op, c.at]);
    }
    const dropped = kept.filter((c) => lost.has(keyOf(c.tbl, c.pk)));
    // told to the person in the same all-or-nothing step: a sync that fails right after still leaves the news (added to
    // what they haven't seen yet)
    if (dropped.length || leftOut.length) {
      const seen = new Map((await removedIn(q)).map((r) => [keyOf(r.tbl, r.pk), r]));
      for (const c of [...leftOut, ...dropped]) seen.set(keyOf(c.tbl, c.pk), { tbl: c.tbl, pk: c.pk });
      await q.query("INSERT INTO app_meta (key, value) VALUES ('sync_removed', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [JSON.stringify([...seen.values()])]);
    }
    return { ...meta, dropped, leftOut };
  });
}

/**
 * What the server answered to one send, taken in at once (one transaction, so a crash leaves either the send not
 * taken in at all, and it is simply sent again, or all of it): the log up to what was sent forgotten, each row sent
 * that the server didn't take held (Hold), or no longer held when it did, and the server's version of what it didn't
 * take as sent written here.
 */
async function sendTaken(db: Db, userId: string, out: { changes: Change[]; upTo: number }, res: any, now: number) {
  await db.tx(async (q) => {
    await q.query("DELETE FROM sync_log WHERE seq <= $1", [out.upTo]);
    await saveMetaIn(q, { pushed: out.upTo });
    const fails = new Map<string, { retry?: boolean; code?: string }>((Array.isArray(res.failed) ? res.failed : []).map((f: any) => [keyOf(f.tbl, f.pk), f]));
    const held = await holdsIn(q);
    const retry = (c: Change) => {
      const h = held[keyOf(c.tbl, c.pk)], tries = (h && !h.refused ? h.tries ?? 0 : 0) + 1;
      return { tbl: c.tbl, pk: c.pk, at: c.at, op: c.op, tries, next: now + retryWait(tries) };
    };
    const orphans: Change[] = [];
    for (const c of out.changes) {
      const k = keyOf(c.tbl, c.pk), f = fails.get(k);
      if (!f) delete held[k];
      else if (f.retry === true) held[k] = retry(c);
      else if (f.code === "23503" && c.op === "upsert" && c.row) orphans.push(c);
      else held[k] = { tbl: c.tbl, pk: c.pk, at: c.at, op: c.op, refused: true };
    }
    // refused because a row it points at isn't on the server (23503): not for good while that row still waits here to
    // be sent (held after a passing failure, in this send or an earlier one, or changed since and not sent yet). It is
    // then tried again later like a passing failure, so it gets there after its parent; otherwise it is refused. Rows
    // are matched by id; a row that waits only because the row it points at waits counts as waiting itself (a set under
    // a routine's exercise under a held routine), but never because of itself or a refused row, so this always ends.
    if (orphans.length) {
      const waiting = new Set<unknown>();
      const orphan = new Set(orphans.map((c) => keyOf(c.tbl, c.pk)));
      for (const [k, h] of Object.entries(held)) if (!h.refused && !orphan.has(k) && h.pk.id != null) waiting.add(h.pk.id);
      for (const e of (await q.query("SELECT pk FROM sync_log WHERE seq > $1", [out.upTo])).rows as any[]) if (e.pk?.id != null) waiting.add(e.pk.id);
      let left = orphans, n;
      do {
        n = left.length;
        left = left.filter((c) => {
          if (!Object.entries(c.row!).some(([col, v]) => col !== "id" && waiting.has(v))) return true;
          fails.get(keyOf(c.tbl, c.pk))!.retry = true; // the answer says so too (syncRound's refused leaves it out)
          held[keyOf(c.tbl, c.pk)] = retry(c);
          if (c.pk.id != null) waiting.add(c.pk.id);
          return false;
        });
      } while (left.length && left.length < n);
      for (const c of left) held[keyOf(c.tbl, c.pk)] = { tbl: c.tbl, pk: c.pk, at: c.at, op: c.op, refused: true };
    }
    await saveHolds(q, held);
    if (Array.isArray(res.rejected) && res.rejected.length) await applyRemoteIn(q, userId, res.rejected);
  });
}

/**
 * Sends what changed here, as the app does it, until nothing is left to send this time, and takes in each answer.
 * Returns the answers. post: sends a body to /sync/push and returns the server's answer. Every row sent is either
 * forgotten (taken, or refused for good) or held until later (retryWait), so this always comes to an end.
 */
export async function pushAll(db: Db, userId: string, post: (body: { device: string; user: string; changes: Change[] }) => Promise<any>, now = Date.now()) {
  const answers: any[] = [];
  const device = (await replicaMeta(db)).device;
  for (;;) {
    const out = await localChanges(db, 500, now);
    if (!out.changes.length) break;
    const res = await post({ device, user: userId, changes: out.changes });
    answers.push(res);
    await sendTaken(db, userId, out, res, now);
  }
  return answers;
}

/**
 * What changed here since the last send (the latest change per row), and up to where in the log that goes; with the
 * rows held for a passing failure whose time to try again has come (now, ms).
 */
export async function localChanges(db: Db, limit = 500, now = Date.now()): Promise<{ changes: Change[]; upTo: number }> {
  const m = await replicaMeta(db);
  const log = (await db.admin.query("SELECT seq, tbl, pk, op, at FROM sync_log WHERE seq > $1 ORDER BY seq LIMIT $2", [m.pushed, limit])).rows;
  const latest = latestPerRow(log as any[]).map((e: any) => ({ tbl: e.tbl, pk: e.pk, op: e.op, at: new Date(e.at).toISOString() }));
  const inLog = new Set(latest.map((e) => keyOf(e.tbl, e.pk)));
  const due = Object.values(await holdsIn(db.admin)).filter((h) => !h.refused && (h.next ?? 0) <= now && !inLog.has(keyOf(h.tbl, h.pk)));
  const all = [...latest, ...due];
  if (!all.length) return { changes: [], upTo: m.pushed };
  const rows = await readRows(db.admin, all.filter((e) => e.op === "upsert" || due.includes(e as Hold)));
  return {
    upTo: log.length ? Number(log.at(-1).seq) : m.pushed,
    changes: all.map((e) => { const row = rows.get(keyOf(e.tbl, e.pk)) ?? null; return { tbl: e.tbl, pk: e.pk, op: row ? "upsert" : "delete", at: e.at, row }; }),
  };
}
/** The server has them: forget them here. */
export async function markSent(db: Db, upTo: number) {
  await db.admin.query("DELETE FROM sync_log WHERE seq <= $1", [upTo]);
  await saveMeta(db, { pushed: upTo });
}
/** Rows not yet sent to the server, for "N changes waiting" (refused ones aren't: they won't be sent). */
export const waitingCount = (db: Db) => waitingIn(db.admin);

/**
 * Writes the server's changes into this copy. A row changed here more recently (and not yet sent, or held to be sent
 * again) keeps this device's version; it goes to the server on the next send, where the newest wins again. overrule()
 * decides first: a workout cancelled here stays cancelled, one finished here stays finished (and is sent again, so the
 * server follows), and one cancelled or finished on the server is so here too, whatever was changed here meanwhile.
 */
export async function applyRemote(db: Db, userId: string, changes: Change[], cursor?: number) {
  const res = await db.tx((q) => applyRemoteIn(q, userId, changes));
  if (cursor != null) await saveMeta(db, { cursor });
  return res;
}
async function applyRemoteIn(q: Sql, userId: string, changes: Change[]) {
  // read inside the same transaction as the writes: a change made here in between (finishing, say) is then either
  // seen here, or made after these writes; never overwritten by an older version of the row
  const m = await metaOf(q);
  const held = await holdsIn(q);
  const mine = new Map<string, { at: number; op: string }>();
  for (const [k, h] of Object.entries(held)) if (!h.refused) mine.set(k, { at: new Date(h.at).getTime(), op: h.op });
  for (const e of (await q.query("SELECT DISTINCT ON (tbl, pk) tbl, pk, op, at FROM sync_log WHERE seq > $1 ORDER BY tbl, pk, seq DESC", [m.pushed])).rows)
    mine.set(keyOf(e.tbl, e.pk), { at: new Date(e.at).getTime(), op: e.op });
  const here = await readRows(q, changes.filter((c) => RULED.has(c.tbl)));
  const keep: Change[] = [];
  // a day changed here and not yet sent, older or newer than the server's: merged per column (perColumn), the
  // server's typed value or choice coming in when newer (typed_at), this copy's synced value staying; sent again
  const own = new Set<string>();
  const take = changes.filter((c) => {
    const k = keyOf(c.tbl, c.pk), t = mine.get(k);
    const o = overrule(c, { row: here.get(k) ?? null, lastOp: t?.op ?? null });
    if (o === false) keep.push(c);
    if (o != null) return o;
    if (perColumn(c) && t?.op === "upsert") { own.add(k); keep.push(c); return true; }
    return t == null || t.at <= new Date(c.at).getTime();
  });
  // a day deleted on the server after its typed value or choice was made here, while this copy changed it since (an
  // import): this copy's row stands, but without the cleared typed value or choice (as the server's mergeDay does on
  // the send); nothing synced left, the day goes. Stamped with the deletion, so the send carries the clearing.
  for (const c of changes) {
    const t = mine.get(keyOf(c.tbl, c.pk));
    if (c.tbl !== "daily_logs" || c.op !== "delete" || t?.op !== "upsert" || take.includes(c)) continue;
    const w = "user_id = $1 AND date = $2::date AND kind = $3 AND (typed_at IS NULL OR typed_at < $4::timestamptz)";
    const a = [userId, c.pk.date, c.pk.kind, c.at];
    await q.query(`DELETE FROM daily_logs WHERE ${w} AND synced IS NULL`, a);
    await q.query(`UPDATE daily_logs SET typed = NULL, chosen = NULL, typed_at = $4::timestamptz WHERE ${w} AND (typed IS NOT NULL OR chosen IS NOT NULL)`, a);
  }
  const r = await applyChanges(q, userId, take, { apply: true, own });
  // the server's version replaced an older change made here (or a row it held back): that one need not be sent any more
  let unheld = false;
  for (const c of take) {
    await q.query("DELETE FROM sync_log WHERE seq > $1 AND tbl = $2 AND pk = $3::jsonb", [m.pushed, c.tbl, JSON.stringify(c.pk)]);
    const k = keyOf(c.tbl, c.pk);
    if (held[k]) { delete held[k]; unheld = true; }
  }
  if (unheld) await saveHolds(q, held);
  // this copy's version stands against the server's: send it (again), so the server ends up the same
  for (const c of [...keep, ...r.kept]) {
    const row = (await readRows(q, [c])).get(keyOf(c.tbl, c.pk));
    await q.query("INSERT INTO sync_log (user_id, tbl, pk, op) VALUES ($1, $2, $3::jsonb, $4)", [userId, c.tbl, JSON.stringify(c.pk), row ? "upsert" : "delete"]);
  }
  return r;
}

/** How the app reaches the server for a sync (syncRound). */
export interface SyncServer {
  push: (body: unknown) => Promise<any>;
  pull: (m: ReplicaMeta) => Promise<{ cursor: number; more: boolean; catalog: string; changes: Change[]; reset?: boolean }>;
  catalog: () => Promise<{ stamp: string; rows: Record<string, unknown>[] }>;
  snapshot: () => Promise<Snapshot>;
}

/**
 * One sync, as the app does it (apps/web api/replica.ts run): what changed here is sent (pushAll), then what changed
 * elsewhere fetched. After a restore with Replace on the server (the pull says reset) the copy is made again from a
 * snapshot (remakeCopy, whatever waits here), and what waited is sent straight away. Every step comes to an end and
 * nothing here asks for another sync at once: a row the server keeps failing on waits for its time (retryWait) and a
 * later sync, and stops nothing else being sent or fetched. wrote: called before each write here (the app saves the
 * copy to disk only after a sync that wrote). Returns whether anything here changed, the answers to the sends, whether
 * the copy was made again, the rows the server refused for good this time, and the rows gone from this copy when it
 * was made again (removed: refused ones left out, and ones that could no longer be written back; remakeCopy).
 */
export async function syncRound(db: Db, userId: string, s: SyncServer, opts: { now?: number; wrote?: () => void } = {}) {
  const wrote = opts.wrote ?? (() => {});
  const send = (body: unknown) => { wrote(); return s.push(body); };
  const answers = await pushAll(db, userId, send, opts.now);
  let changed = answers.some((a) => a.rejected?.length), remade = false;
  const removed: Change[] = [];
  const retry: Change[] = [];
  for (;;) {
    const m = await replicaMeta(db);
    const p = await s.pull(m);
    // everything was replaced on the server (a restore): the changes would leave rows only this copy had beside the
    // restored ones (M-257); the snapshot comes after the send above, so it has all this copy sent
    if (p.reset) {
      const cat = await s.catalog(), snap = await s.snapshot();
      wrote();
      const made = await remakeCopy(db, cat, snap);
      removed.push(...made.leftOut, ...made.dropped);
      remade = changed = true;
      retry.length = 0;
      answers.push(...(await pushAll(db, userId, send, opts.now)));
      break;
    }
    if (p.catalog !== m.catalog) { const cat = await s.catalog(); wrote(); await loadCatalog(db, cat.stamp, cat.rows); changed = true; }
    // an empty page only moves the cursor, which is no reason to save
    if (p.changes.length) { wrote(); changed = true; }
    const r = await applyRemote(db, userId, p.changes, p.cursor);
    retry.push(...r.failed.map((f) => f.change));
    if (!p.more) break;
  }
  // a row that arrived before the row it belongs to (they came in different pages)
  if (retry.length) { wrote(); await applyRemote(db, userId, retry); }
  const refused = answers.flatMap((a) => (Array.isArray(a.failed) ? a.failed : []).filter((f: any) => f.retry !== true));
  return { changed, answers, remade, refused, removed };
}
