// A device's copy of a person's data on a server (offline use). The app works on this copy; sync() in the app sends
// what changed here and fetches what changed elsewhere. Kept in app_meta: where in the server's log this copy is,
// how much of its own log has been sent, this device's name for itself, and which catalog it has.
import type { Db, Sql } from "../db";
import { SYNCED, SYNCED_BY_NAME } from "./tables";
import { readRows, applyChanges, latestPerRow, keyOf, overrule, perColumn, remapRefs, REFS, RULED, type Change } from "./core";
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
/** Rows changed here and not yet sent (read with q, so inside a transaction it is that transaction's view). */
async function waitingIn(q: Sql) {
  const m = await metaOf(q);
  return Number((await q.query("SELECT count(DISTINCT (tbl, pk)) AS n FROM sync_log WHERE seq > $1", [m.pushed])).rows[0].n);
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
// in the same transaction as the rows: a change made here meanwhile is after `pushed` (sent later), never marked sent.
// rename: the copy takes a new name for itself (remakeCopy)
async function snapshotLoaded(q: Sql, snap: Snapshot, rename = false) {
  const pushed = Number((await q.query("SELECT coalesce(max(seq), 0) AS s FROM sync_log")).rows[0].s);
  return saveMetaIn(q, { cursor: snap.cursor, pushed, device: (!rename && (await metaOf(q)).device) || uuidv7(), ready: true, v: COPY_VERSION });
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
 * was): after a restore with Replace on the server (the pull says reset), or for an outdated copy. Returns null and
 * leaves the copy as it is when something here is waiting to be sent: the fetch can take minutes, and a change made
 * meanwhile would be erased with the copy and never sent. The app then sends it and tries again with the same snapshot,
 * so a copy is made even while something keeps changing here (a workout under way). That snapshot is from before what
 * was just sent: the copy takes a new name for itself, so the server no longer takes those changes for this copy's
 * own and the next fetch brings them back in (the server sends a device everything after the snapshot's cursor but
 * what that device itself sent).
 */
export async function remakeCopy(db: Db, cat: { stamp: string; rows: Record<string, unknown>[] }, snap: Snapshot): Promise<ReplicaMeta | null> {
  // the shared catalog first (the person's rows point at it); taking it in loses nothing, whatever happens next
  await loadCatalog(db, cat.stamp, cat.rows);
  // emptied and filled in one go, so a screen reading meanwhile sees the old rows or the new ones, never none; the
  // check for waiting changes in the same transaction, so none can land between it and the emptying
  return db.tx(async (q) => {
    if (await waitingIn(q)) return null;
    await clearRows(q);
    await writeSnapshot(q, snap);
    return snapshotLoaded(q, snap, true);
  });
}

/**
 * Rows the server gave a new id, as their own was another account's (modules/sync.ts push; M-257): each is copied
 * under its new id, every row here pointing at it is pointed at the new one (and sent, so the server follows), and only
 * then is the old one taken off, so nothing under it goes with it. A row changed here since it was sent is sent again
 * under its new id. Returns the keys (keyOf) of the moves that could not be made here: their old row stays, and the
 * caller leaves its deletion out.
 */
export async function rekey(db: Db, moves: { tbl: string; from: string; to: string }[]): Promise<Set<string>> {
  const failed = new Set<string>();
  const ok = moves.filter((m) => SYNCED_BY_NAME.get(m.tbl)?.pk.join() === "id" && /^[0-9a-f-]{36}$/i.test(m.from) && /^[0-9a-f-]{36}$/i.test(m.to));
  for (const m of moves) if (!ok.includes(m)) failed.add(keyOf(m.tbl, { id: m.from }));
  if (!ok.length) return failed;
  // parents first: a moved row may point at another moved row
  ok.sort((a, b) => SYNCED_BY_NAME.get(a.tbl)!.order - SYNCED_BY_NAME.get(b.tbl)!.order);
  await db.tx(async (q) => {
    const pushed = (await metaOf(q)).pushed;
    const apply = (on: boolean) => q.query("SELECT set_config('motus.sync_apply', $1, true)", [on ? "1" : ""]);
    for (const m of ok) {
      const t = m.tbl, map = new Map([[t + ":" + m.from, m.to]]);
      await q.query("SAVEPOINT motus_move");
      try {
        const unsent = (await q.query("SELECT 1 FROM sync_log WHERE seq > $1 AND tbl = $2 AND pk = $3::jsonb LIMIT 1", [pushed, t, JSON.stringify({ id: m.from })])).rows.length > 0;
        await apply(!unsent);
        await q.query(`INSERT INTO ${t} SELECT (jsonb_populate_record(NULL::${t}, to_jsonb(x) || jsonb_build_object('id', $2::uuid))).* FROM ${t} x WHERE x.id = $1
          ON CONFLICT (id) DO NOTHING`, [m.from, m.to]);
        await apply(false);
        for (const [tbl, refs] of Object.entries(REFS)) {
          for (const ref of refs) {
            if (typeof ref.table === "string" && ref.table !== t) continue;
            for (const { r } of (await q.query(`SELECT to_jsonb(x) AS r FROM ${tbl} x WHERE x.${ref.col} = $1`, [m.from])).rows as { r: Record<string, unknown> }[]) {
              const { row, changed } = remapRefs(tbl, r, map);
              if (changed && row[ref.col] === m.to) await q.query(`UPDATE ${tbl} SET ${ref.col} = $1 WHERE id = $2`, [m.to, r.id]);
            }
          }
        }
        if (t === "routines")
          for (const { r } of (await q.query("SELECT to_jsonb(x) AS r FROM programs x WHERE x.weeks::text LIKE $1", ["%" + m.from + "%"])).rows as { r: Record<string, unknown> }[]) {
            const { row, changed } = remapRefs("programs", r, map);
            if (changed) await q.query("UPDATE programs SET weeks = $1::jsonb WHERE id = $2", [JSON.stringify(row.weeks), r.id]);
          }
        await apply(true);
        await q.query(`DELETE FROM ${t} WHERE id = $1`, [m.from]);
        await q.query("DELETE FROM sync_log WHERE seq > $1 AND tbl = $2 AND pk = $3::jsonb", [pushed, t, JSON.stringify({ id: m.from })]);
        await apply(false);
        await q.query("RELEASE SAVEPOINT motus_move");
      } catch {
        await q.query("ROLLBACK TO SAVEPOINT motus_move");
        failed.add(keyOf(t, { id: m.from }));
      }
    }
    await apply(false);
  });
  return failed;
}

/**
 * Rows the server could not write this time (a deadlock, a timeout, a row it belongs to that failed in the same send):
 * noted again as changed, so a later send tries them again, at the time they were changed. One changed here again
 * since is sent with that change anyway.
 */
export async function resend(db: Db, userId: string, sent: Change[]) {
  if (!sent.length) return;
  await db.tx(async (q) => {
    const pushed = (await metaOf(q)).pushed;
    for (const c of sent) {
      if ((await q.query("SELECT 1 FROM sync_log WHERE seq > $1 AND tbl = $2 AND pk = $3::jsonb LIMIT 1", [pushed, c.tbl, JSON.stringify(c.pk)])).rows.length) continue;
      const row = (await readRows(q, [c])).get(keyOf(c.tbl, c.pk));
      await q.query("INSERT INTO sync_log (user_id, tbl, pk, op, at) VALUES ($1, $2, $3::jsonb, $4, $5)", [userId, c.tbl, JSON.stringify(c.pk), row ? "upsert" : "delete", c.at]);
    }
  });
}

/**
 * One send of what changed here, as the app does it: the server's answer taken in (rows it moved, then its version of
 * what it didn't take as sent), and what it couldn't write this time noted to be sent again. Returns the answers.
 * post: sends a body to /sync/push and returns the server's answer.
 */
export async function pushAll(db: Db, userId: string, post: (body: { device: string; user: string; rekey: true; changes: Change[] }) => Promise<any>) {
  const answers: any[] = [], retry: Change[] = [];
  const device = (await replicaMeta(db)).device;
  for (;;) {
    const out = await localChanges(db);
    if (!out.changes.length) break;
    const res = await post({ device, user: userId, rekey: true, changes: out.changes });
    answers.push(res);
    await markSent(db, out.upTo);
    const stays = await rekey(db, Array.isArray(res.moved) ? res.moved : []);
    const back: Change[] = (res.rejected ?? []).filter((c: Change) => !(c.op === "delete" && stays.has(keyOf(c.tbl, c.pk))));
    if (back.length) await applyRemote(db, userId, back);
    // sent again after this send is over, not within it: one the server keeps failing on waits for the next sync
    const again = new Set((res.failed ?? []).filter((f: any) => f.retry).map((f: any) => keyOf(f.tbl, f.pk)));
    retry.push(...out.changes.filter((c) => again.has(keyOf(c.tbl, c.pk))));
  }
  await resend(db, userId, retry);
  return answers;
}

/** What changed here since the last send (the latest change per row), and up to where in the log that goes. */
export async function localChanges(db: Db, limit = 500): Promise<{ changes: Change[]; upTo: number }> {
  const m = await replicaMeta(db);
  const log = (await db.admin.query("SELECT seq, tbl, pk, op, at FROM sync_log WHERE seq > $1 ORDER BY seq LIMIT $2", [m.pushed, limit])).rows;
  if (!log.length) return { changes: [], upTo: m.pushed };
  const latest = latestPerRow(log as any[]);
  const rows = await readRows(db.admin, latest.filter((e: any) => e.op === "upsert"));
  return {
    upTo: Number(log.at(-1).seq),
    changes: latest.map((e: any) => { const row = e.op === "upsert" ? rows.get(keyOf(e.tbl, e.pk)) ?? null : null; return { tbl: e.tbl, pk: e.pk, op: row ? "upsert" : "delete", at: new Date(e.at).toISOString(), row }; }),
  };
}
/** The server has them: forget them here. */
export async function markSent(db: Db, upTo: number) {
  await db.admin.query("DELETE FROM sync_log WHERE seq <= $1", [upTo]);
  await saveMeta(db, { pushed: upTo });
}
/** Rows not yet sent to the server, for "N changes waiting". */
export const waitingCount = (db: Db) => waitingIn(db.admin);

/**
 * Writes the server's changes into this copy. A row changed here more recently (and not yet sent) keeps this
 * device's version; it goes to the server on the next send, where the newest wins again. overrule() decides first:
 * a workout cancelled here stays cancelled, one finished here stays finished (and is sent again, so the server
 * follows), and one cancelled or finished on the server is so here too, whatever was changed here meanwhile.
 */
export async function applyRemote(db: Db, userId: string, changes: Change[], cursor?: number) {
  const res = await db.tx(async (q) => {
    // read inside the same transaction as the writes: a change made here in between (finishing, say) is then either
    // seen here, or made after these writes; never overwritten by an older version of the row
    const m = await metaOf(q);
    const mine = new Map<string, { at: number; op: string }>();
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
    // the server's version replaced an older change made here: that one need not be sent any more
    for (const c of take) await q.query("DELETE FROM sync_log WHERE seq > $1 AND tbl = $2 AND pk = $3::jsonb", [m.pushed, c.tbl, JSON.stringify(c.pk)]);
    // this copy's version stands against the server's: send it (again), so the server ends up the same
    for (const c of [...keep, ...r.kept]) {
      const row = (await readRows(q, [c])).get(keyOf(c.tbl, c.pk));
      await q.query("INSERT INTO sync_log (user_id, tbl, pk, op) VALUES ($1, $2, $3::jsonb, $4)", [userId, c.tbl, JSON.stringify(c.pk), row ? "upsert" : "delete"]);
    }
    return r;
  });
  if (cursor != null) await saveMeta(db, { cursor });
  return res;
}
