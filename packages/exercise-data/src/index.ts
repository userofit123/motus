// free-exercise-db (Unlicense): the shared exercise catalog bundled with Motus.
import data from "../data/exercises.json";

export interface RawExercise {
  id: string;
  name: string;
  force: string | null;
  level: string;
  mechanic: string | null;
  equipment: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  instructions: string[];
  category: string;
  images: string[];
}
export const exercises = data as RawExercise[];
export { SOURCE, LICENSE, AUTHOR } from "./meta";
