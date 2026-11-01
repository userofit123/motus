// A picture of a finished workout (optional feature): name, date, totals and the exercises, in the current look.
// Shared through the phone's share sheet when possible, otherwise downloaded.
import type { Fmt } from "./format";

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
  const grad = g.createLinearGradient(80, 0, 200, 0); grad.addColorStop(0, v("--acc")); grad.addColorStop(1, v("--acc2"));
  g.fillStyle = grad; roundRect(g, 80, H - 140, 64, 64, 20); g.fill();
  g.fillStyle = v("--tx"); g.font = font(40); g.fillText("Motus", 164, H - 94);
  const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/png"));
  const file = new File([blob], `${w.name}-${w.startedAt.slice(0, 10)}.png`, { type: "image/png" });
  if ((navigator as any).canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: w.name }).catch(() => {}); return; }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
}
function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
