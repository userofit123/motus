// Copies the built web app and the exercise photos into www/ for the Android app (photos ship inside the app).
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../..");
fs.rmSync("www", { recursive: true, force: true });
fs.cpSync(path.join(root, "apps/web/dist"), "www", { recursive: true });
const img = path.join(root, "packages/exercise-data/images");
if (fs.existsSync(img)) fs.cpSync(img, "www/exercise-images", { recursive: true });
console.log("www ready");
