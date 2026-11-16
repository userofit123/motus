// The server's side of offline use (see sync/): a device's first full copy, the changes since its last visit,
// and the changes it made while away. Last change wins, row by row.
import type { Router } from "../router";
import type { Sql } from "../db";
import { bad, HttpError } from "../errors";
import { str } from "../util";
import { SYNCED_BY_NAME } from "../sync/tables";
import { readRows, allRows, applyChanges, latestPerRow, keyOf, overrule, perColumn, RULED, type Change } from "../sync/core";

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

/**
 * Failures that say nothing about the row itself and may well pass on a later try: a serialization failure (40001), a
 * deadlock (40P01), a lock not available (55P03), a cancelled or timed-out statement (57014), the server short of
 * resources (class 53) or a lost connection (class 08). The device keeps such a row and sends it again later. Anything
 * else (another account's id, a check the row breaks, a reference to someone else's row...) fails the same way every
 * time: the device keeps the row but doesn't send it again unless it changes there.
 */
const PASSING = new Set(["40001", "40P01", "55P03", "57014"]);
const passing = (code?: string) => !!code && (PASSING.has(code) || code.startsWith("53") || code.startsWith("08"));

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
    const list: Change[] = (Array.isArray(b.changes) ? b.changes : []).slice(0, 1000).filter((c: any) =>
      c && SYNCED_BY_NAME.has(c.tbl) && (c.op === "upsert" || c.op === "delete") && c.pk && typeof c.pk === "object" && !Number.isNaN(Date.parse(c.at)));
    const lastLogged = async (c: { tbl: string; pk: Record<string, unknown> }) =>
      (await ctx.q.query("SELECT at, origin, op FROM sync_log WHERE tbl = $1 AND pk = $2::jsonb ORDER BY seq DESC LIMIT 1", [c.tbl, JSON.stringify(c.pk)])).rows[0];
    // last change wins: a newer change from somewhere else beats this one, and the device gets that one instead.
    // Except where overrule() decides first: a cancelled workout stays cancelled, a finished one stays finished.
    // A day's number from a current app is merged per column instead (perColumn), unless the newer change deleted it.
    const accepted: Change[] = [], rejected: Change[] = [];
    const here = await readRows(ctx.q, list.filter((c) => RULED.has(c.tbl))); // the only rows the rules look at
    for (const c of list) {
      const last = await lastLogged(c);
      const o = overrule(c, { row: here.get(keyOf(c.tbl, c.pk)) ?? null, lastOp: last?.op });
      const wins = o ?? (!(last && last.origin !== device && new Date(last.at) > new Date(c.at)) || (perColumn(c) && last.op !== "delete"));
      (wins ? accepted : rejected).push(c);
    }
    const { applied, failed: fails, kept, cleared } = await applyChanges(ctx.q, ctx.userId, accepted, { origin: device });
    // a row that failed because a row it points at isn't here (23503) may belong to one that failed for a passing reason
    // in this same send (a routine's exercises under a routine hit by a deadlock): tried again too, never kept back
    const anyPassing = fails.some((f) => passing(f.code));
    const failed: { tbl: string; pk: Record<string, unknown>; error: string; retry: boolean }[] = [];
    for (const f of fails) {
      // a deletion refused because something here still points at the row (a custom exercise another device used in a
      // workout): the device gets the row back as it is here, rather than keeping a deletion the server never takes
      if (f.change.op === "delete" && f.code === "23503") { rejected.push(f.change); continue; }
      const retry = passing(f.code) || (anyPassing && f.code === "23503" && f.change.op === "upsert");
      failed.push({ tbl: f.change.tbl, pk: f.change.pk, error: f.error.slice(0, 200), retry });
    }
    // the device gets back the server's version of what wasn't written as sent: a change older than the server's, a
    // finished workout it would have reopened, a row with a reference to someone else's row cleared, a refused deletion
    rejected.push(...kept, ...cleared);
    const now = await readRows(ctx.q, rejected);
    const back: Change[] = [];
    const seen = new Set<string>();
    for (const c of rejected) {
      const k = keyOf(c.tbl, c.pk);
      if (seen.has(k)) continue;
      seen.add(k);
      const found = now.get(k) ?? null;
      // only this person's row (or the shared catalog's) goes back; a row of another account is a deletion
      const row = found && ownedBy(ctx.userId, c.tbl, found) ? found : null;
      // stamped with when the row was last changed here (or, never logged here, when the device changed it): a change
      // made on the device while this push was on its way is newer and stays there (sync/replica.ts applyRemote)
      const last = await lastLogged(c);
      back.push({ tbl: c.tbl, pk: c.pk, op: row ? "upsert" : "delete", at: last ? new Date(last.at).toISOString() : c.at, row });
    }
    if (applied) ctx.changed("everything");
    return { applied, rejected: back, failed };
  });
}
