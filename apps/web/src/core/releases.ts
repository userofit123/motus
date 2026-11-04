// The latest GitHub release and which of its downloads fits this device (Settings → App & Versions).
// A server account asks its server (/update-check proxies GitHub and caches it, which spares GitHub's rate limit);
// a local account has no server, so it asks GitHub directly. No release yet (or a private repo: 404) is not an error.
import { api } from "../api/client";
import { native } from "./device";
import { newer } from "@motus/shared";

export { newer };

export const REPO = "userofit123/motus";
export const REPO_URL = `https://github.com/${REPO}`;

export type Asset = { name: string; url: string; size?: number };
type GhAsset = { name: string; browser_download_url: string; size?: number };
export type Release = { latest: string | null; url?: string; notes?: string; assets: Asset[]; error?: string };

async function fromGitHub(): Promise<Release> {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: "application/vnd.github+json" } });
    if (r.status === 404) return { latest: null, assets: [], error: "No releases found" };
    if (!r.ok) return { latest: null, assets: [], error: "Could not reach GitHub" };
    const j = (await r.json()) as { tag_name?: string; html_url?: string; body?: string; assets?: GhAsset[] };
    return { latest: String(j.tag_name ?? "").replace(/^v/, "") || null, url: j.html_url, notes: j.body ?? "", assets: (j.assets ?? []).map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size })) };
  } catch { return { latest: null, assets: [], error: "Could not reach GitHub" }; }
}

export async function latestRelease(): Promise<Release> {
  const r = await api.get<Release | null>("/update-check").catch(() => null);
  if (r && Array.isArray(r.assets)) return { latest: r.latest, url: r.url, notes: r.notes, assets: r.assets, error: r.error };
  return fromGitHub();
}

export type Platform = { key: "android" | "windows" | "linux" | "mac" | "ios" | "other"; name: string; app: boolean };
/** What this is running on: the Android or desktop app, or a browser on some system (from the user agent). */
export function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  const os: Platform["key"] = /Android/i.test(ua) ? "android" : /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? "ios"
    : /Windows/i.test(ua) ? "windows" : /Mac OS X|Macintosh/i.test(ua) ? "mac" : /Linux|X11/i.test(ua) ? "linux" : "other";
  const names = { android: "Android", windows: "Windows", linux: "Linux", mac: "macOS", ios: "iPhone or iPad", other: "this device" };
  if (native.android) return { key: "android", name: "Android app", app: true };
  if (native.desktop) return { key: os, name: `Desktop app (${names[os]})`, app: true };
  return { key: os, name: `${names[os]} browser`, app: false };
}

// the downloads people install, in the order they are listed; update manifests (.yml, .json, .blockmap) are left out
const KINDS: { key: Platform["key"]; test: RegExp; label: string }[] = [
  { key: "android", test: /\.apk$/i, label: "Android (APK)" },
  { key: "windows", test: /\.exe$/i, label: "Windows (installer)" },
  { key: "linux", test: /\.AppImage$/i, label: "Linux (AppImage, runs anywhere)" },
  { key: "linux", test: /\.deb$/i, label: "Linux (.deb, Debian and Ubuntu)" },
  { key: "linux", test: /\.rpm$/i, label: "Linux (.rpm, Fedora)" },
  { key: "mac", test: /\.dmg$/i, label: "macOS" },
];
export type Download = Asset & { label: string; key: Platform["key"] };
export function downloads(assets: Asset[]): Download[] {
  return KINDS.flatMap((k) => { const a = assets.find((x) => k.test.test(x.name)); return a ? [{ ...a, label: k.label, key: k.key }] : []; });
}
