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
export const SOURCE = "free-exercise-db";
export const LICENSE = "Unlicense (public domain)";
export const AUTHOR = "free-exercise-db by yuhonas";
