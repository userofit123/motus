// The server's side of offline use (see sync/): a device's first full copy, the changes since its last visit,
// and the changes it made while away. Last change wins, row by row.
import type { Router } from "../router";
import type { Sql } from "../db";
import { bad, HttpError } from "../errors";
import { str } from "../util";
import { SYNCED_BY_NAME } from "../sync/tables";
import { readRows, allRows, applyChanges, latestPerRow, keyOf, overrule, RULED, type Change } from "../sync/core";

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
    return { cursor, more: page.length === PAGE, catalog: await catalogStamp(q), changes };
  });

  r.post("/sync/push", async (ctx, _p, b) => {
    sameUser(ctx.userId, b.user);
    const device = str(b.device, 80);
    if (!device) throw bad("Which device is this?");
    const list: Change[] = (Array.isArray(b.changes) ? b.changes : []).slice(0, 1000).filter((c: any) =>
      c && SYNCED_BY_NAME.has(c.tbl) && (c.op === "upsert" || c.op === "delete") && c.pk && typeof c.pk === "object" && !Number.isNaN(Date.parse(c.at)));
    // last change wins: a newer change from somewhere else beats this one, and the device gets that one instead.
    // Except where overrule() decides first: a cancelled workout stays cancelled, a finished one stays finished.
    const accepted: Change[] = [], rejected: Change[] = [];
    const here = await readRows(ctx.q, list.filter((c) => RULED.has(c.tbl))); // the only rows the rules look at
    for (const c of list) {
      const last = (await ctx.q.query("SELECT at, origin, op FROM sync_log WHERE tbl = $1 AND pk = $2::jsonb ORDER BY seq DESC LIMIT 1", [c.tbl, JSON.stringify(c.pk)])).rows[0];
      const o = overrule(c, { row: here.get(keyOf(c.tbl, c.pk)) ?? null, lastOp: last?.op });
      const wins = o ?? !(last && last.origin !== device && new Date(last.at) > new Date(c.at));
      (wins ? accepted : rejected).push(c);
    }
    const { applied, failed, kept, cleared } = await applyChanges(ctx.q, ctx.userId, accepted, { origin: device });
    // the device gets back the server's version of what wasn't written as sent: a finished workout it would have
    // reopened, and a row with a reference to someone else's row cleared
    rejected.push(...kept, ...cleared);
    const now = await readRows(ctx.q, rejected);
    const back: Change[] = rejected.map((c) => {
      const row = now.get(keyOf(c.tbl, c.pk)) ?? null;
      return { tbl: c.tbl, pk: c.pk, op: row ? "upsert" : "delete", at: new Date().toISOString(), row };
    });
    if (applied) ctx.changed("everything");
    return { applied, rejected: back, failed: failed.map((f) => ({ tbl: f.change.tbl, pk: f.change.pk, error: f.error.slice(0, 200) })) };
  });
}
