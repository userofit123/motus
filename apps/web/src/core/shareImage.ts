// A picture of a finished workout (optional feature): name, date, totals and the exercises, in the current look.
// Shared through the phone's share sheet when possible, otherwise saved like any other file (saveFile).
import type { Fmt } from "./format";
import { saveFile } from "./saveFile";

export async function shareWorkoutImage(w: any, fmt: Fmt) {
  const css = getComputedStyle(document.documentElement);
  const v = (n: string) => css.getPropertyValue(n).trim();
  const W = 1080, H = 1350, c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  const bg = g.createRadialGradient(150, -100, 50, 150, -100, 1100);
  bg.addColorStop(0, v("--accc")); bg.addColorStop(1, v("--bg"));
  g.fillStyle = v("--bg"); g.fillRect(0, 0, W, H);
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const font = (size: number, weight = 600) => `${weight} ${size}px Inter, system-ui, sans-serif`;
  g.fillStyle = v("--tx2"); g.font = font(34, 500); g.fillText(fmt.dateLong(w.startedAt), 80, 140);
  g.fillStyle = v("--tx"); g.font = font(84); g.fillText(w.name, 80, 240, W - 160);
  const t = w.report.totals;
  const stats: [string, string][] = [["Duration", fmt.dur(t.durationS, true)], ["Volume", fmt.vol(t.volumeKg)], ["Sets", String(t.workingSets)], ["Records", String(t.records)]];
  stats.forEach(([l, val], i) => {
    const x = 80 + (i % 2) * 470, y = 330 + Math.floor(i / 2) * 170;
    g.fillStyle = v("--s1"); roundRect(g, x, y, 450, 150, 32); g.fill();
    g.fillStyle = v("--tx2"); g.font = font(30, 500); g.fillText(l, x + 36, y + 56);
    g.fillStyle = v("--tx"); g.font = font(56); g.fillText(val, x + 36, y + 120);
  });
  let y = 720;
  g.font = font(34, 500);
  for (const e of w.exercises.filter((x: any) => x.status !== "skipped").slice(0, 9)) {
    const sets = e.sets.filter((s: any) => s.done && s.kind !== "warmup");
    const best = sets.reduce((b: any, s: any) => ((s.weightKg ?? 0) * (s.reps ?? 0) > (b?.weightKg ?? 0) * (b?.reps ?? 0) ? s : b), null);
    g.fillStyle = v("--tx"); g.fillText(e.exercise.name, 80, y, 640);
    g.fillStyle = v("--tx2"); g.textAlign = "right";
    g.fillText(`${sets.length} × ${best?.weightKg != null ? fmt.w(best.weightKg) + " " + fmt.wu + " × " : ""}${best?.reps ?? ""}`, W - 80, y);
    g.textAlign = "left"; y += 62;
  }
  drawLogo(g, 80, H - 140, 64, v("--acc"));
  g.fillStyle = v("--tx"); g.font = font(40); g.fillText("Motus", 164, H - 94);
  const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/png"));
  const file = new File([blob], `${w.name}-${w.startedAt.slice(0, 10)}.png`, { type: "image/png" });
  if ((navigator as any).canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: w.name }).catch(() => {}); return; }
  await saveFile(blob, file.name);
}
// The app mark as in shell/Logo.vue (layout.css .logo): accent tile with the dumbbell of public/icon.svg, drawn as shapes
// rather than an <img>, so nothing has to load first and the canvas never gets tainted (toBlob keeps working in the WebView).
function drawLogo(g: CanvasRenderingContext2D, x: number, y: number, size: number, acc: string) {
  g.fillStyle = acc; const a = hexRgb(g.fillStyle as string);
  const mix = (o: number[], p: number, al = 1) => `rgba(${a.map((c, i) => Math.round(c * p + o[i]! * (1 - p))).join(",")},${al})`;
  const white = [255, 255, 255], black = [0, 0, 0];
  g.save();
  g.shadowColor = mix(black, .7, .5); g.shadowBlur = size * .3; g.shadowOffsetY = size * .1;
  const tile = g.createLinearGradient(x, y, x + size, y + size); tile.addColorStop(0, mix(white, .38)); tile.addColorStop(1, acc);
  g.fillStyle = tile; roundRect(g, x, y, size, size, size * 15 / 44); g.fill();
  g.restore(); g.save();
  const k = size / 512;
  g.translate(x + 256 * k, y + 250 * k); g.rotate(-Math.PI / 4); g.scale(.98 * k, .98 * k);
  g.shadowColor = mix(black, .25, .5); g.shadowBlur = 2 * size / 44; g.shadowOffsetY = 2 * size / 44;
  g.fillStyle = mix(black, .16);
  for (const [rx, ry, w, h, r] of <[number, number, number, number, number][]>[[-184, -19, 368, 38, 19], [-128, -108, 56, 216, 18], [72, -108, 56, 216, 18], [-170, -74, 50, 148, 16], [120, -74, 50, 148, 16]]) { roundRect(g, rx, ry, w, h, r); g.fill(); }
  g.shadowColor = "transparent"; g.globalAlpha = .6; g.fillStyle = mix(white, .15);
  for (const rx of [-116, 84]) { roundRect(g, rx, -88, 10, 72, 5); g.fill(); }
  g.restore();
}
// The canvas normalises any opaque colour to #rrggbb (rgba(...) when translucent).
function hexRgb(c: string) {
  if (c.startsWith("#")) return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  return (c.match(/[\d.]+/g) ?? ["0", "0", "0"]).slice(0, 3).map(Number);
}
function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
