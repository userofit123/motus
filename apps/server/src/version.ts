// The running version (from the root package.json, set by scripts/bump.mjs) and the check for a newer release on GitHub.
import fs from "node:fs";
import path from "node:path";

function readVersion(): string {
  for (const p of [path.resolve(import.meta.dirname, "../../../package.json"), path.resolve(process.cwd(), "package.json")]) {
    try { const v = JSON.parse(fs.readFileSync(p, "utf8")).version; if (v) return v; } catch { /* try the next */ }
  }
  return process.env.MOTUS_VERSION ?? "0.0.0";
}
export const VERSION = process.env.MOTUS_VERSION ?? readVersion();
/** Raised when the API changes in a way older apps cannot follow; apps compare it with the level they were built for. */
export const API_LEVEL = 1;
export const REPO = process.env.MOTUS_REPO ?? "userofit123/motus";

let cache: { at: number; value: unknown } | null = null;
/** The latest GitHub release, cached for an hour (GitHub allows 60 unauthenticated requests an hour per address). */
export async function checkForUpdate() {
  if (cache && cache.at > Date.now() - 3600000) return cache.value;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: "application/vnd.github+json", "user-agent": "motus" } });
    if (!r.ok) throw new Error(String(r.status));
    const j: any = await r.json();
    const latest = String(j.tag_name ?? "").replace(/^v/, "");
    const assets = (j.assets ?? []).map((a: any) => ({ name: a.name, url: a.browser_download_url, size: a.size }));
    const value = { current: VERSION, latest, newer: newer(latest, VERSION), notes: j.body ?? "", url: j.html_url, publishedAt: j.published_at, assets };
    cache = { at: Date.now(), value };
    return value;
  } catch (e) {
    return { current: VERSION, latest: null, newer: false, error: "Could not reach GitHub" };
  }
}
export function newer(a: string, b: string): boolean {
  const pa = a.split(/[.-]/).map((x) => parseInt(x) || 0), pb = b.split(/[.-]/).map((x) => parseInt(x) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}
