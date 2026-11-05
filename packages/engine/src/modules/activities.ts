// Activities (walks, runs, rides…), body measurements and the daily log (steps, sleep, water, mood).
import { haversine, routeStats, type ActivityType } from "@motus/shared";
import type { Router, Ctx } from "../router";
import { camel, id, str, intOrNull, numOrNull, bool, isoTime, dateStr } from "../util";
import { uuidv7 } from "../ids";
import { notFound, bad } from "../errors";

export const DEFAULT_TYPES: ActivityType[] = [
  { slug: "walk", name: "Walk", icon: "walk", hasDistance: true, hasGps: true, hasSteps: true },
  { slug: "run", name: "Run", icon: "run", hasDistance: true, hasGps: true, hasSteps: true },
  { slug: "hike", name: "Hike", icon: "hike", hasDistance: true, hasGps: true, hasSteps: true },
  { slug: "cycle", name: "Cycle", icon: "cycle", hasDistance: true, hasGps: true },
  { slug: "swim", name: "Swim", icon: "swim", hasDistance: true, hasGps: false },
  { slug: "yoga", name: "Yoga", icon: "yoga", hasDistance: false, hasGps: false },
  { slug: "stretching", name: "Stretching", icon: "stretch", hasDistance: false, hasGps: false },
  { slug: "sport", name: "Sport", icon: "sport", hasDistance: false, hasGps: false },
  { slug: "rowing", name: "Rowing", icon: "row", hasDistance: true, hasGps: false },
  { slug: "elliptical", name: "Elliptical", icon: "activity", hasDistance: true, hasGps: false },
  { slug: "other", name: "Other", icon: "activity", hasDistance: false, hasGps: false },
];

export function parseTrack(text: string): { name: string; type: string; route: number[][] } {
  const route: number[][] = [];
  const name = /<name>([^<]*)<\/name>/.exec(text)?.[1]?.trim() ?? "";
  const gpxType = /<type>([^<]*)<\/type>/.exec(text)?.[1]?.toLowerCase() ?? "";
  if (/<gpx[\s>]/i.test(text)) {
    const re = /<trkpt[^>]*?lat="([-\d.]+)"[^>]*?lon="([-\d.]+)"[^>]*?(?:\/>|>([\s\S]*?)<\/trkpt>)/g;
    const re2 = /<trkpt[^>]*?lon="([-\d.]+)"[^>]*?lat="([-\d.]+)"[^>]*?(?:\/>|>([\s\S]*?)<\/trkpt>)/g;
    let m: RegExpExecArray | null;
    const push = (lat: string, lon: string, inner = "") => {
      const t = /<time>([^<]+)<\/time>/.exec(inner)?.[1];
      const ele = /<ele>([^<]+)<\/ele>/.exec(inner)?.[1];
      route.push([+lat, +lon, t ? Math.round(new Date(t).getTime() / 1000) : 0, ele != null ? +ele : (undefined as any)]);
    };
    while ((m = re.exec(text))) push(m[1]!, m[2]!, m[3]);
    if (!route.length) while ((m = re2.exec(text))) push(m[2]!, m[1]!, m[3]);
  } else if (/<TrainingCenterDatabase/i.test(text)) {
    const re = /<Trackpoint>([\s\S]*?)<\/Trackpoint>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const inner = m[1]!;
      const lat = /<LatitudeDegrees>([^<]+)</.exec(inner)?.[1], lon = /<LongitudeDegrees>([^<]+)</.exec(inner)?.[1];
      const t = /<Time>([^<]+)</.exec(inner)?.[1], alt = /<AltitudeMeters>([^<]+)</.exec(inner)?.[1];
      if (lat && lon) route.push([+lat, +lon, t ? Math.round(new Date(t).getTime() / 1000) : 0, alt != null ? +alt : (undefined as any)]);
    }
  } else throw bad("Not a GPX or TCX file");
  const sport = /Sport="(\w+)"/.exec(text)?.[1]?.toLowerCase() ?? gpxType;
  const type = /run/.test(sport) ? "run" : /bik|cycl/.test(sport) ? "cycle" : /hik/.test(sport) ? "hike" : "walk";
  return { name, type, route };
}

async function ensureTypes(ctx: Ctx) {
  const n = Number((await ctx.q.query("SELECT count(*) n FROM activity_types")).rows[0].n);
  if (n) return;
  for (const t of DEFAULT_TYPES)
    await ctx.q.query("INSERT INTO activity_types (id, user_id, slug, name, icon, has_distance, has_gps, has_steps) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING",
      [uuidv7(), ctx.userId, t.slug, t.name, t.icon, t.hasDistance, t.hasGps, !!t.hasSteps]);
}

export async function saveActivity(ctx: Ctx, b: any, aid = uuidv7(), isNew = true) {
  const route = Array.isArray(b.route) ? b.route.slice(0, 50000).filter((p: any) => Array.isArray(p) && p.length >= 2)
    // a point without an altitude (often from a browser) comes as null: kept as "no altitude", not 0 m, or the climb jumps
    .map((p: any[]) => (p[3] == null ? p.slice(0, 3) : p.slice(0, 4)).map(Number)) : null;
  const rs = route && route.length > 1 ? routeStats(route) : null;
  const startedAt = isoTime(b.startedAt);
  const durationS = intOrNull(b.durationS, 0, 864000) ?? (b.endedAt ? Math.round((new Date(b.endedAt).getTime() - new Date(startedAt).getTime()) / 1000) : 0);
  const vals = [aid, ctx.userId, str(b.type, 40) || "walk", str(b.name, 120), startedAt, b.endedAt ? isoTime(b.endedAt) : new Date(new Date(startedAt).getTime() + durationS * 1000).toISOString(),
    durationS, intOrNull(b.movingS, 0, 864000) ?? rs?.movingS ?? null, numOrNull(b.distanceM, 0, 1e7) ?? rs?.distanceM ?? null, intOrNull(b.steps, 0, 1e7),
    numOrNull(b.elevationM, 0, 1e5) ?? rs?.elevationM ?? null, intOrNull(b.avgHr, 20, 250), intOrNull(b.calories, 0, 1e5), route ? JSON.stringify(route) : null,
    str(b.notes, 10000), str(b.source, 20) || "manual", b.clientId ? str(b.clientId, 80) : null];
  if (isNew) {
    const { rows } = await ctx.q.query(
      `INSERT INTO activities (id, user_id, type, name, started_at, ended_at, duration_s, moving_s, distance_m, steps, elevation_m, avg_hr, calories, route, notes, source, client_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT (user_id, client_id) WHERE client_id IS NOT NULL DO NOTHING RETURNING id`, vals);
    // sent twice (a double tap or a retry): it's already saved, so point at that one
    if (!rows.length && b.clientId) return (await ctx.q.query("SELECT id FROM activities WHERE client_id = $1", [str(b.clientId, 80)])).rows[0]?.id ?? aid;
  } else {
    const { rows } = await ctx.q.query(
      `UPDATE activities SET type=$3, name=$4, started_at=$5, ended_at=$6, duration_s=$7, moving_s=$8, distance_m=$9, steps=$10, elevation_m=$11, avg_hr=$12, calories=$13,
         route=coalesce($14, route), notes=$15 WHERE id=$1 AND user_id=$2 RETURNING id`, vals.slice(0, 15));
    if (!rows.length) throw notFound("Activity not found");
  }
  return aid;
}

export function activityRoutes(r: Router) {
  r.get("/activity-types", async (ctx) => {
    await ensureTypes(ctx);
    // has_steps is unset on a type written by an app from before it existed (sync or an older backup): decide by slug
    return (await ctx.q.query(`SELECT id, slug, name, icon, has_distance, has_gps, coalesce(has_steps, slug IN ('walk', 'run', 'hike')) AS has_steps
      FROM activity_types ORDER BY slug = 'other', name`)).rows.map((x: any) => camel(x));
  });
  r.post("/activity-types", async (ctx, _p, b) => {
    await ensureTypes(ctx);
    const name = str(b.name, 40).trim();
    if (!name) throw bad("Give it a name");
    let slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || uuidv7().slice(0, 8);
    if (slug === "workout") slug = "workout-activity"; // "workout" means gym workouts in goals
    if ((await ctx.q.query("SELECT 1 FROM activity_types WHERE slug = $1", [slug])).rows.length) throw bad(`You already have ${name}`);
    await ctx.q.query("INSERT INTO activity_types (id, user_id, slug, name, icon, has_distance, has_gps, has_steps) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [uuidv7(), ctx.userId, slug, name, str(b.icon, 20) || "activity", bool(b.hasDistance, true), bool(b.hasGps), bool(b.hasSteps)]);
    ctx.changed("activity");
    return { slug };
  });
  // renaming keeps the slug, so activities already logged as this type stay with it
  r.put("/activity-types/:slug", async (ctx, p, b) => {
    const name = b.name != null ? str(b.name, 40).trim() : null;
    if (name === "") throw bad("Give it a name");
    const { rows } = await ctx.q.query(`UPDATE activity_types SET name = coalesce($2, name), icon = coalesce($3, icon), has_distance = coalesce($4, has_distance), has_gps = coalesce($5, has_gps),
      has_steps = coalesce($6, has_steps) WHERE slug = $1 RETURNING slug`, [p.slug, name, b.icon ? str(b.icon, 20) : null, b.hasDistance == null ? null : bool(b.hasDistance), b.hasGps == null ? null : bool(b.hasGps),
      b.hasSteps == null ? null : bool(b.hasSteps)]);
    if (!rows.length) throw notFound("Activity type not found");
    ctx.changed("activity");
    return { ok: true };
  });
  r.del("/activity-types/:slug", async (ctx, p) => {
    await ctx.q.query("DELETE FROM activity_types WHERE slug = $1", [p.slug]);
    ctx.changed("activity");
    return { ok: true };
  });

  r.get("/activities", async ({ q }, _p, _b, qs) => {
    const conds: string[] = [], params: unknown[] = [];
    if (qs.from) { params.push(qs.from); conds.push(`started_at >= $${params.length}`); }
    if (qs.to) { params.push(qs.to); conds.push(`started_at < $${params.length}`); }
    if (qs.type) { params.push(qs.type); conds.push(`type = $${params.length}`); }
    const { rows } = await q.query(
      `SELECT id, type, name, started_at, ended_at, duration_s, moving_s, distance_m, steps, elevation_m, avg_hr, calories, notes, source, route IS NOT NULL AS has_route
       FROM activities ${conds.length ? "WHERE " + conds.join(" AND ") : ""} ORDER BY started_at DESC LIMIT ${Math.min(1000, Number(qs.limit) || 200)}`, params);
    return rows.map((x: any) => camel(x));
  });
  r.get("/activities/:id", async ({ q }, p) => {
    const a = (await q.query("SELECT * FROM activities WHERE id = $1", [id(p.id)])).rows[0];
    if (!a) throw notFound("Activity not found");
    const x = camel<any>(a);
    delete x.userId;
    // splits per km from the route
    const splits: { km: number; s: number }[] = [];
    if (Array.isArray(a.route) && a.route.length > 1) {
      let d = 0, lastT = a.route[0][2], k = 1;
      for (let i = 1; i < a.route.length; i++) {
        d += haversine(a.route[i - 1], a.route[i]);
        if (d >= k * 1000) { splits.push({ km: k, s: a.route[i][2] - lastT }); lastT = a.route[i][2]; k++; }
      }
    }
    return { ...x, splits };
  });
  r.post("/activities", async (ctx, _p, b) => {
    const aid = await saveActivity(ctx, b);
    ctx.changed("activity");
    return { id: aid };
  });
  r.put("/activities/:id", async (ctx, p, b) => {
    await saveActivity(ctx, b, id(p.id), false);
    ctx.changed("activity");
    return { ok: true };
  });
  r.del("/activities/:id", async (ctx, p) => {
    await ctx.q.query("DELETE FROM activities WHERE id = $1", [id(p.id)]);
    ctx.changed("activity");
    return { ok: true };
  });
  // a GPX or TCX file's text
  r.post("/activities/import", async (ctx, _p, b) => {
    const files: { name?: string; text: string }[] = Array.isArray(b.files) ? b.files : [{ text: b.text }];
    const ids: string[] = [];
    for (const f of files.slice(0, 200)) {
      if (typeof f.text !== "string") continue;
      const t = parseTrack(f.text);
      if (t.route.length < 2) continue;
      const start = t.route[0]![2] ? new Date(t.route[0]![2]! * 1000).toISOString() : ctx.now().toISOString();
      const end = t.route.at(-1)![2] ? new Date(t.route.at(-1)![2]! * 1000).toISOString() : start;
      ids.push(await saveActivity(ctx, { type: b.type || t.type, name: t.name || f.name?.replace(/\.(gpx|tcx)$/i, "") || "", startedAt: start, endedAt: end, route: t.route, source: "import", clientId: `import:${start}` }));
    }
    ctx.changed("activity");
    return { ids, count: ids.length };
  });

  // body
  r.get("/body", async ({ q }, _p, _b, qs) => {
    const { rows } = await q.query(`SELECT id, kind, value, measured_at, note FROM body_metrics ${qs.kind ? "WHERE kind = $1" : ""} ORDER BY measured_at DESC LIMIT 2000`, qs.kind ? [qs.kind] : []);
    return rows.map((x: any) => camel(x));
  });
  // one entry, or { entries: [...] } for a whole tape session saved together (all or nothing)
  r.post("/body", async (ctx, _p, b) => {
    const list = Array.isArray(b.entries) ? b.entries.slice(0, 100) : [b];
    if (!list.length) throw bad("Enter a value");
    const ids: string[] = [];
    for (const e of list) {
      const v = numOrNull(e?.value, 0, 10000);
      if (v == null) throw bad("Enter a value");
      const bid = uuidv7();
      await ctx.q.query("INSERT INTO body_metrics (id, user_id, kind, value, measured_at, note) VALUES ($1,$2,$3,$4,$5,$6)",
        [bid, ctx.userId, str(e.kind, 40) || "weight", v, isoTime(e.measuredAt ?? b.measuredAt, ctx.now().toISOString()), str(e.note, e.kind === "photo" ? 4_000_000 : 500)]); // a photo's note is its picture
      ids.push(bid);
    }
    ctx.changed("body");
    return Array.isArray(b.entries) ? { ids } : { id: ids[0] };
  });
  r.del("/body/:id", async (ctx, p) => {
    await ctx.q.query("DELETE FROM body_metrics WHERE id = $1", [id(p.id)]);
    ctx.changed("body");
    return { ok: true };
  });

  // daily log: steps, sleep (h), water (ml), mood (1-5)
  r.get("/daily", async ({ q }, _p, _b, qs) => {
    const { rows } = await q.query(`SELECT date, kind, value, source FROM daily_logs WHERE date >= $1::date ORDER BY date DESC`, [dateStr(qs.from) ?? "1970-01-01"]);
    return rows;
  });
  r.put("/daily", async (ctx, _p, b) => {
    const entries = Array.isArray(b.entries) ? b.entries : [b];
    for (const e of entries.slice(0, 1000)) {
      const d = dateStr(e.date), k = str(e.kind, 20);
      if (!d || !k) continue;
      if (e.value == null) await ctx.q.query("DELETE FROM daily_logs WHERE date = $1 AND kind = $2", [d, k]);
      else await ctx.q.query(
        `INSERT INTO daily_logs (user_id, date, kind, value, source) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_id, date, kind) DO UPDATE SET value = $4, source = $5`,
        [ctx.userId, d, k, numOrNull(e.value, 0, 1e7), str(e.source, 20) || "manual"]);
    }
    // the daily log is not a body measurement: it touches activity, stats, goals and home, not the body log
    ctx.changed("activity");
    return { ok: true };
  });
}
