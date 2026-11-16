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
    // last change wins: a newer change from somewhere else beats this one, and the device gets that one instead.
    // Except where overrule() decides first: a cancelled workout stays cancelled, a finished one stays finished.
    // A day's number from a current app is merged per column instead (perColumn), unless the newer change deleted it.
    const accepted: Change[] = [], rejected: Change[] = [];
    const here = await readRows(ctx.q, list.filter((c) => RULED.has(c.tbl))); // the only rows the rules look at
    for (const c of list) {
      const last = (await ctx.q.query("SELECT at, origin, op FROM sync_log WHERE tbl = $1 AND pk = $2::jsonb ORDER BY seq DESC LIMIT 1", [c.tbl, JSON.stringify(c.pk)])).rows[0];
      const o = overrule(c, { row: here.get(keyOf(c.tbl, c.pk)) ?? null, lastOp: last?.op });
      const wins = o ?? (!(last && last.origin !== device && new Date(last.at) > new Date(c.at)) || (perColumn(c) && last.op !== "delete"));
      (wins ? accepted : rejected).push(c);
    }
    const { applied, failed, kept, cleared } = await applyChanges(ctx.q, ctx.userId, accepted, { origin: device });
    // the device gets back the server's version of what wasn't written as sent: a finished workout it would have
    // reopened, a row with a reference to someone else's row cleared, and a row the server refused (it no longer fits
    // here, or its id is another account's): otherwise the device keeps that row for good, beside the server's, and a
    // later restore that gives it a new id here shows it twice there (M-257)
    rejected.push(...kept, ...cleared, ...failed.map((f) => f.change));
    const now = await readRows(ctx.q, rejected);
    const back: Change[] = rejected.map((c) => {
      const found = now.get(keyOf(c.tbl, c.pk)) ?? null;
      // only this person's row (or the shared catalog's) goes back; a row of another account is a deletion
      const row = found && ownedBy(ctx.userId, c.tbl, found) ? found : null;
      return { tbl: c.tbl, pk: c.pk, op: row ? "upsert" : "delete", at: new Date().toISOString(), row };
    });
    if (applied) ctx.changed("everything");
    return { applied, rejected: back, failed: failed.map((f) => ({ tbl: f.change.tbl, pk: f.change.pk, error: f.error.slice(0, 200) })) };
  });
}
