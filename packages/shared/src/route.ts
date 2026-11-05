// A recorded route of [lat, lon, unix s, altitude] points: its distance, moving time and climb. Shared so the recording
// screen shows the same distance that is saved.

const R = 6371000;
export function haversine(a: [number, number] | number[], b: [number, number] | number[]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0]! - a[0]!), dLon = toRad(b[1]! - a[1]!);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0]!)) * Math.cos(toRad(b[0]!)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Distance, moving time and climb from a route of [lat, lon, unix s, altitude] points. `breaks` are the indexes of
 *  points that start a new stretch (the first point after a pause): the way from the point before is not counted,
 *  since you may have walked on while paused. */
export function routeStats(route: number[][], breaks: number[] = []) {
  let dist = 0, moving = 0, climb = 0;
  const skip = new Set(breaks);
  // a phone's GPS altitude wobbles a few metres from point to point; adding up every small rise would turn a flat walk
  // into a hill, so a climb counts once it's 5 m above the lowest point since the last one counted
  let low: number | null = null;
  for (let i = 0; i < route.length; i++) {
    const b = route[i]!, alt = b[3];
    if (skip.has(i)) low = null; // what was climbed while paused doesn't count
    if (alt != null && Number.isFinite(alt)) {
      if (low == null || alt < low) low = alt;
      else if (alt - low >= 5) { climb += alt - low; low = alt; }
    }
    if (!i || skip.has(i)) continue;
    const a = route[i - 1]!;
    const d = haversine(a, b);
    dist += d;
    const dt = (b[2] ?? 0) - (a[2] ?? 0);
    if (dt > 0 && dt < 120 && d / dt > 0.3) moving += dt; // faster than ~1 km/h counts as moving
  }
  // no altitude anywhere on the route: the climb is unknown, not 0 m
  return { distanceM: Math.round(dist), movingS: Math.round(moving), elevationM: low == null ? null : Math.round(climb) };
}
