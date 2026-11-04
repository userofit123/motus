// Downloads the free-exercise-db photos (public domain, Unlicense) into packages/exercise-data/images.
// They are not kept in git; the server image and the apps bundle them at build time. Safe to run again: existing files are skipped.
//   node scripts/fetch-exercise-images.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DATA = path.join(ROOT, "packages/exercise-data/data/exercises.json");
const OUT = path.join(ROOT, "packages/exercise-data/images");
const BASE = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/";

const list = JSON.parse(fs.readFileSync(DATA, "utf8")).flatMap((e) => e.images);
let done = 0, failed = 0;
async function one(rel) {
  const dest = path.join(OUT, rel);
  if (fs.existsSync(dest)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  for (let i = 0; i < 3; i++) {
    try {
      // a stalled download must give up: without a time limit one hung request kept a release build waiting for hours
      const r = await fetch(BASE + rel.split("/").map(encodeURIComponent).join("/"), { signal: AbortSignal.timeout(30_000) });
      if (!r.ok) throw new Error(String(r.status));
      fs.writeFileSync(dest + ".tmp", Buffer.from(await r.arrayBuffer()));
      fs.renameSync(dest + ".tmp", dest);
      return;
    } catch { await new Promise((res) => setTimeout(res, 500 * (i + 1))); }
  }
  failed++;
}
const queue = [...list];
await Promise.all(Array.from({ length: 12 }, async () => { while (queue.length) { await one(queue.shift()); if (++done % 200 === 0) console.log(`${done}/${list.length}`); } }));
console.log(`done: ${list.length - failed} images, ${failed} failed`);
