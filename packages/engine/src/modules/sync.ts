// The server's side of offline use (see sync/): a device's first full copy, the changes since its last visit,
// and the changes it made while away. Last change wins, row by row.
import type { Router } from "../router";
import type { Sql } from "../db";
import { bad, HttpError } from "../errors";
import { str } from "../util";
import { SYNCED_BY_NAME } from "../sync/tables";
import { readRows, allRows, applyChanges, latestPerRow, keyOf, overrule, perColumn, remapRefs, REFS, RULED, REKEYABLE, FOREIGN_REF, type Change, type Failure } from "../sync/core";
import { isUuid, ownCopyId } from "../ids";

const PAGE = 5000;

/** Changes when the server's copy of the shared catalog changes (a new version of the app adds exercises). */
async function catalogStamp(q: Sql) {
  return String((await q.query("SELECT count(*) || ':' || coalesce(max(updated_at)::text, '') AS s FROM exercises WHERE owner_id IS NULL")).rows[0].s);
}

/**
 * A device says whose copy it syncs. The sign-in is shared by every tab of a browser: signing in as someone else in
 * one tab must not let another tab, still on the first person's copy, pull the new person's rows into that copy or
 * send its rows to the new person's account (M-184). Older apps don't say: nothing is checked for them.
 */
function sameUser(userId: string, copyOf: unknown) {
  if (copyOf != null && copyOf !== "" && copyOf !== userId) throw new HttpError(409, "Signed in as someone else");
}

/**
 * Whether a row read back for a device is the person's own: read under row-level security already, and checked again
 * here so a device is never sent another account's row whatever the policies say. The shared catalog counts as anyone's
 * (a device has it anyway; a deletion would remove it there). A row without an owner column is a child of an owned one,
 * checked by its policy (visible(), 002).
 */
function ownedBy(userId: string, tbl: string, row: Record<string, unknown>) {
  if (tbl === "exercises") return row.owner_id == null || row.owner_id === userId;
  return !("user_id" in row) || row.user_id === userId;
}

/** SQLSTATEs a row whose id is another account's fails with: row-level security (42501), or the key taken (23505). */
const DEFINITE = new Set(["42501", "23505"]);

/** Whether a row failed because its id is another account's (only that, checked past row-level security). */
async function someoneElses(q: Sql, f: Failure) {
  const c = f.change, def = SYNCED_BY_NAME.get(c.tbl);
  if (c.op !== "upsert" || !DEFINITE.has(f.code ?? "") || !def || def.pk.join() !== "id" || !isUuid(c.pk.id)) return false;
  if (!REKEYABLE.has(c.tbl) && c.tbl !== "exercises" && c.tbl !== "schedules") return false;
  return !!(await q.query<{ f: boolean }>("SELECT motus_foreign_row($1, $2) AS f", [c.tbl, c.pk.id])).rows[0]?.f;
}

/**
 * Whether a row failed because the row it belongs to was deleted here (it no longer fits): that row is not here, not
 * someone else's, not sent in this push, and its last change here was its deletion. Then the device gets the deletion.
 * A parent only missing (never here, or failed in this same push) is no reason: the row is kept and sent again.
 */
async function parentDeleted(q: Sql, f: Failure, sent: Change[]) {
  const c = f.change;
  if (c.op !== "upsert" || f.code !== "23503" || !c.row) return false;
  // the reference the database names (its detail), or, where an adapter leaves that out, each the row has
  const m = /Key \((\w+)\)=\(([0-9a-f-]{36})\) is not present in table "(\w+)"/i.exec(f.detail ?? "");
  const refs = m ? [{ id: m[2]!, table: m[3]! }]
    : (REFS[c.tbl] ?? []).filter((r) => typeof r.table === "string" && isUuid(c.row![r.col])).map((r) => ({ id: String(c.row![r.col]), table: r.table as string }));
  for (const { id, table } of refs) {
    if (!SYNCED_BY_NAME.has(table) || sent.some((s) => s.tbl === table && s.pk.id === id)) continue;
    if ((await readRows(q, [{ tbl: table, pk: { id } }])).get(keyOf(table, { id }))) continue;
    if ((table === "exercises" || REKEYABLE.has(table) || table === "schedules")
      && (await q.query<{ f: boolean }>("SELECT motus_foreign_row($1, $2) AS f", [table, id])).rows[0]?.f) continue;
    const last = (await q.query("SELECT op FROM sync_log WHERE tbl = $1 AND pk = $2::jsonb ORDER BY seq DESC LIMIT 1", [table, JSON.stringify({ id })])).rows[0];
    if (last?.op === "delete") return true;
  }
  return false;
}

export function syncRoutes(r: Router) {
  r.get("/sync/catalog", async ({ q }) => ({
    stamp: await catalogStamp(q),
    rows: (await q.query("SELECT to_jsonb(x) AS r FROM exercises x WHERE owner_id IS NULL")).rows.map((x: any) => x.r),
  }));

  r.get("/sync/snapshot", async ({ q, userId }, _p, _b, qs) => {
    sameUser(userId, qs.user);
    // the position first: anything changed while the rows are read is simply sent again on the next pull
    const cursor = Number((await q.query("SELECT coalesce(max(seq), 0) AS s FROM sync_log")).rows[0].s);
    const user = (await q.query("SELECT id, username, display_name, email, role FROM users WHERE id = $1", [userId])).rows[0];
    return { cursor, user, catalog: await catalogStamp(q), tables: await allRows(q) };
  });

  r.get("/sync/pull", async ({ q, userId }, _p, _b, qs) => {
    sameUser(userId, qs.user);
    const since = Number(qs.since) || 0, device = str(qs.device, 80);
    const page = (await q.query("SELECT seq, tbl, pk, op, at, origin FROM sync_log WHERE seq > $1 ORDER BY seq LIMIT $2", [since, PAGE])).rows;
    const cursor = page.length ? Number(page.at(-1).seq) : since;
    // a device already has its own changes
    const latest = latestPerRow(page as any[]).filter((e: any) => e.origin !== device);
    const rows = await readRows(q, latest.filter((e: any) => e.op === "upsert"));
    const changes: Change[] = latest.map((e: any) => {
      const row = e.op === "upsert" ? rows.get(keyOf(e.tbl, e.pk)) ?? null : null;
      return { tbl: e.tbl, pk: e.pk, op: row ? "upsert" : "delete", at: e.at, row };
    });
    // everything was replaced since this copy was made or last caught up (a restore, 049): the app makes its copy again
    // from a snapshot (sync/replica.ts remakeCopy), as the changes would leave a row only the device had (M-257). The
    // changes still come, for an app from before this that applies them as before.
    // A copy made after the restore starts at or past it (the snapshot's cursor is the log's end then, and the log only
    // grows), so it is told once; a copy still at 0 (made from an empty account, or never caught up) is told too.
    const resetAt = Number((await q.query("SELECT seq FROM sync_resets WHERE user_id = $1", [userId])).rows[0]?.seq ?? 0);
    const reset = since < resetAt;
    return { cursor, more: page.length === PAGE, catalog: await catalogStamp(q), changes, ...(reset ? { reset } : {}) };
  });

  r.post("/sync/push", async (ctx, _p, b) => {
    sameUser(ctx.userId, b.user);
    const device = str(b.device, 80);
    if (!device) throw bad("Which device is this?");
    // an app that points its own rows at a moved row's new id before taking the old one off (sync/replica.ts rekey):
    // only then is a row moved; an older app would delete the old one, and with it, there, every row under it
    const rekey = b.rekey === true;
    const list: Change[] = (Array.isArray(b.changes) ? b.changes : []).slice(0, 1000).filter((c: any) =>
      c && SYNCED_BY_NAME.has(c.tbl) && (c.op === "upsert" || c.op === "delete") && c.pk && typeof c.pk === "object" && !Number.isNaN(Date.parse(c.at)));
    const lastLogged = async (c: { tbl: string; pk: Record<string, unknown> }) =>
      (await ctx.q.query("SELECT at, origin, op FROM sync_log WHERE tbl = $1 AND pk = $2::jsonb ORDER BY seq DESC LIMIT 1", [c.tbl, JSON.stringify(c.pk)])).rows[0];
    // last change wins: a newer change from somewhere else beats this one, and the device gets that one instead.
    // Except where overrule() decides first: a cancelled workout stays cancelled, a finished one stays finished.
    // A day's number from a current app is merged per column instead (perColumn), unless the newer change deleted it.
    const wins = async (cs: Change[]) => {
      const here = await readRows(ctx.q, cs.filter((c) => RULED.has(c.tbl))); // the only rows the rules look at
      const yes: Change[] = [], no: Change[] = [];
      for (const c of cs) {
        const last = await lastLogged(c);
        const o = overrule(c, { row: here.get(keyOf(c.tbl, c.pk)) ?? null, lastOp: last?.op });
        (o ?? (!(last && last.origin !== device && new Date(last.at) > new Date(c.at)) || (perColumn(c) && last.op !== "delete")) ? yes : no).push(c);
      }
      return [yes, no] as const;
    };
    const [accepted, rejected] = await wins(list);
    const kept: Change[] = [], cleared: Change[] = [], again: Change[] = [];
    // what failed, by the key the device sent it under; a row tried again (moved, or pointed at a moved row) is
    // judged by its last try
    const failedBy = new Map<string, Failure>();
    // rows whose id is another account's (a backup restored inside the device's copy, M-257): the person's own data,
    // so never dropped. They get an id of this account's own, the same one a restore here gives them (ownCopyId), and
    // the rows sent with them that point at them are pointed at it. "table:old id" → new id.
    const moves = new Map<string, string>(), moved: { tbl: string; from: string; to: string; at: string }[] = [];
    const sentAs = new Map<Change, Change>(); // a row tried again → as the device sent it
    let applied = 0, batch = accepted;
    for (let pass = 0; batch.length && pass < 8; pass++) {
      const r = await applyChanges(ctx.q, ctx.userId, batch, { origin: device });
      applied += r.applied; kept.push(...r.kept); cleared.push(...r.cleared);
      const fresh = new Map<string, string>();
      for (const c of batch) failedBy.delete(keyOf(c.tbl, (sentAs.get(c) ?? c).pk));
      for (const f of r.failed) {
        const sent = sentAs.get(f.change) ?? f.change;
        if (rekey && !moves.has(sent.tbl + ":" + String(sent.pk.id)) && (await someoneElses(ctx.q, f))) {
          const from = String(sent.pk.id), to = await ownCopyId(ctx.q, ctx.userId, from);
          fresh.set(sent.tbl + ":" + from, to);
          moved.push({ tbl: sent.tbl, from, to, at: sent.at });
        } else failedBy.set(keyOf(sent.tbl, sent.pk), { ...f, change: sent });
      }
      if (!fresh.size) break;
      for (const [k, v] of fresh) moves.set(k, v);
      // the moved rows under their new ids (where this account already has one, from a restore here: the newer wins),
      // and every row sent that points at one of them, pointed at the new id
      const next: Change[] = [];
      for (const c of accepted) {
        const k = c.tbl + ":" + String(c.pk.id);
        const { row, changed } = remapRefs(c.tbl, c.row ?? {}, moves);
        const points = c.op === "upsert" && c.row && [...fresh.keys()].some((f) => remapRefs(c.tbl, c.row!, new Map([[f, fresh.get(f)!]])).changed);
        if (!fresh.has(k) && !points) continue;
        const id = moves.get(k);
        const t: Change = { ...c, ...(id ? { pk: { id } } : {}), row: { ...row, ...(id ? { id } : {}) } };
        sentAs.set(t, c);
        if (changed && !id) again.push(t);
        next.push(t);
      }
      const [go, stay] = await wins(next.filter((t) => moves.has(t.tbl + ":" + String(sentAs.get(t)!.pk.id))));
      batch = [...go, ...next.filter((t) => !moves.has(t.tbl + ":" + String(sentAs.get(t)!.pk.id)))];
      rejected.push(...stay);
    }
    // a row the server can never take as sent goes back as the server has it: only where that is certain (the row it
    // belongs to was deleted here). Anything else (a deadlock, a timeout, a parent that failed in the same push...)
    // the device keeps and sends again (retry), or keeps unsent where sending again can't help (someone else's row
    // it points at, or its id another account's where it can't be moved): never taken off the device.
    const failed: { tbl: string; pk: Record<string, unknown>; error: string; retry: boolean }[] = [];
    for (const f of failedBy.values()) {
      if (await parentDeleted(ctx.q, f, list)) { rejected.push(f.change); continue; }
      const stuck = f.code === FOREIGN_REF || (DEFINITE.has(f.code ?? "") && (await someoneElses(ctx.q, f)));
      failed.push({ tbl: f.change.tbl, pk: f.change.pk, error: f.error.slice(0, 200), retry: !stuck });
    }
    // the device gets back the server's version of what wasn't written as sent: a change older than the server's, a
    // finished workout it would have reopened, a row with a reference to someone else's row cleared, a row pointed at
    // a moved row's new id, and a moved row: its old id deleted, its new one as written
    const repointed = new Set(again.map((t) => sentAs.get(t)!));
    const back0: Change[] = [...rejected, ...kept, ...cleared, ...repointed];
    const now = await readRows(ctx.q, [...back0, ...moved.map((m) => ({ tbl: m.tbl, pk: { id: m.to } }))]);
    // stamped with when the row was last changed here (or, never logged here, when the device changed it): a change
    // made on the device while this push was on its way is newer and stays there (sync/replica.ts applyRemote)
    const stamp = async (c: { tbl: string; pk: Record<string, unknown> }, at: string) => {
      const last = await lastLogged(c);
      return last ? new Date(last.at).toISOString() : at;
    };
    const back: Change[] = [];
    const seen = new Set<string>();
    for (const c of back0) {
      const k = keyOf(c.tbl, c.pk);
      if (seen.has(k)) continue;
      seen.add(k);
      const found = now.get(k) ?? null;
      // only this person's row (or the shared catalog's) goes back; a row of another account is a deletion
      const row = found && ownedBy(ctx.userId, c.tbl, found) ? found : null;
      // a row pointed at a moved row goes back only as written here: one not written (it failed, or was moved itself)
      // is never a deletion for the device
      if (!row && repointed.has(c) && !rejected.includes(c)) continue;
      back.push({ tbl: c.tbl, pk: c.pk, op: row ? "upsert" : "delete", at: await stamp(c, c.at), row });
    }
    // a move counts only once the row is here under its new id: one that failed there too stays on the device as it is
    const done = moved.filter((m) => { const row = now.get(keyOf(m.tbl, { id: m.to })); return !!row && ownedBy(ctx.userId, m.tbl, row); });
    for (const m of done) {
      back.push({ tbl: m.tbl, pk: { id: m.from }, op: "delete", at: m.at, row: null });
      const k = keyOf(m.tbl, { id: m.to });
      if (!seen.has(k)) { seen.add(k); back.push({ tbl: m.tbl, pk: { id: m.to }, op: "upsert", at: await stamp({ tbl: m.tbl, pk: { id: m.to } }, m.at), row: now.get(k)! }); }
    }
    if (applied) ctx.changed("everything");
    return { applied, rejected: back, failed, ...(rekey ? { moved: done.map(({ tbl, from, to }) => ({ tbl, from, to })) } : {}) };
  });
}
