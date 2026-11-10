// The shared exercise catalog: free-exercise-db, added once (and topped up when a new version of the app has more).
import type { RawExercise } from "@motus/exercise-data";
import { SOURCE, LICENSE, AUTHOR } from "@motus/exercise-data/meta";
import type { Tracking } from "@motus/shared";
import type { Db } from "./db";
import { uuidv7 } from "./ids";

// exercises done one side at a time by default (left and right sets); anyone can change it per exercise.
// Migration 019 applies the same names to catalogs added before.
const ONE_SIDE = /\b(one[- ]arm(ed)?|single[- ]arm(ed)?|one[- ]leg(ged)?|single[- ]leg(ged)?|one[- ]handed|single[- ]handed|alternat(e|ing)|unilateral|split squats?|lunges?|step[- ]?ups?|pistol|bulgarian)\b/i;

function trackingOf(e: RawExercise): Tracking {
  if (e.category === "stretching") return "duration";
  if (e.category === "cardio") return /walk|run|jog|bike|bicycl|row|elliptical|stair|step/i.test(e.name) ? "distance_duration" : "duration";
  if (e.force === "static" && !/hold|carry|walk/i.test(e.name)) return "duration";
  if (/plank|hold|wall sit/i.test(e.name)) return "duration";
  if (/carry|farmer/i.test(e.name)) return "weight_duration";
  if (/assisted/i.test(e.name)) return "assisted";
  if (e.equipment === "body only" || e.equipment == null) return /pull-?up|chin-?up|dip|push-?up|lunge|squat|crunch|sit-?up|raise/i.test(e.name) ? "bodyweight_reps" : "reps_only";
  return "weight_reps";
}

export async function seedCatalog(db: Db): Promise<number> {
  const have = new Set((await db.admin.query<{ source_id: string }>("SELECT source_id FROM exercises WHERE owner_id IS NULL AND source = $1", [SOURCE])).rows.map((r) => r.source_id));
  // loaded only here: the data is large, and the web app's copy of a server account takes the server's catalog instead
  const { exercises } = await import("@motus/exercise-data");
  const missing = exercises.filter((e) => !have.has(e.id));
  if (!missing.length) return 0;
  await db.tx(async (q) => {
    for (let i = 0; i < missing.length; i += 100) {
      const chunk = missing.slice(i, i + 100);
      const vals: unknown[] = [];
      const rows = chunk.map((e, j) => {
        const b = j * 16;
        vals.push(uuidv7(), SOURCE, e.id, e.name, e.category, e.equipment, e.mechanic, e.force, e.level, trackingOf(e), ONE_SIDE.test(e.name),
          e.primaryMuscles, e.secondaryMuscles, e.instructions, e.images.map((p) => "lib:" + p), LICENSE);
        return `($${b + 1},NULL,$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12},$${b + 13},$${b + 14},$${b + 15},$${b + 16},'${AUTHOR}')`;
      });
      await q.query(
        `INSERT INTO exercises (id, owner_id, source, source_id, name, category, equipment, mechanic, force, level, tracking, unilateral,
          primary_muscles, secondary_muscles, instructions, images, license, author) VALUES ${rows.join(",")} ON CONFLICT DO NOTHING`,
        vals,
      );
    }
  });
  return missing.length;
}
