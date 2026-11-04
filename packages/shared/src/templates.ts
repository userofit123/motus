// Starter routines (our own, written for Motus). Exercises are free-exercise-db ids; sets are [sets, reps, reps max].
export interface TemplateExercise { id: string; sets: number; reps: number; repsMax?: number; durationS?: number; restS?: number; restAfterS?: number }
export interface Template { slug: string; group: string; name: string; description: string; exercises: TemplateExercise[] }

const ex = (id: string, sets: number, reps: number, repsMax?: number, restS?: number): TemplateExercise => ({ id, sets, reps, repsMax, restS });
const hold = (id: string, sets: number, durationS: number): TemplateExercise => ({ id, sets, reps: 0, durationS, restS: 30 });

export const TEMPLATES: Template[] = [
  { slug: "full-a", group: "Full body (alternate A and B)", name: "Full Body A", description: "Squat, bench and row. Alternate with Full Body B, three days a week: A, B, A, then B, A, B.", exercises: [
    ex("Barbell_Squat", 3, 5, 8, 180), ex("Barbell_Bench_Press_-_Medium_Grip", 3, 5, 8, 180), ex("Bent_Over_Barbell_Row", 3, 6, 10, 150), hold("Plank", 3, 45)] },
  { slug: "full-b", group: "Full body (alternate A and B)", name: "Full Body B", description: "Deadlift, overhead press and pull-ups. Alternate with Full Body A.", exercises: [
    ex("Barbell_Deadlift", 3, 5, 6, 180), ex("Standing_Military_Press", 3, 5, 8, 150), ex("Pullups", 3, 5, 10, 150), ex("Hanging_Leg_Raise", 3, 10, 15, 60)] },
  { slug: "push", group: "Push / Pull / Legs", name: "Push", description: "Chest, shoulders and triceps.", exercises: [
    ex("Barbell_Bench_Press_-_Medium_Grip", 4, 6, 10, 150), ex("Incline_Dumbbell_Press", 3, 8, 12, 120), ex("Dumbbell_Shoulder_Press", 3, 8, 12, 120),
    ex("Side_Lateral_Raise", 3, 12, 15, 60), ex("Triceps_Pushdown", 3, 10, 15, 60)] },
  { slug: "pull", group: "Push / Pull / Legs", name: "Pull", description: "Back, rear shoulders and biceps.", exercises: [
    ex("Pullups", 4, 6, 10, 150), ex("Bent_Over_Barbell_Row", 3, 8, 12, 120), ex("Seated_Cable_Rows", 3, 10, 12, 90), ex("Face_Pull", 3, 12, 15, 60), ex("Barbell_Curl", 3, 8, 12, 60), ex("Hammer_Curls", 2, 10, 12, 60)] },
  { slug: "legs", group: "Push / Pull / Legs", name: "Legs", description: "Quads, hamstrings, glutes and calves.", exercises: [
    ex("Barbell_Squat", 4, 6, 10, 180), ex("Romanian_Deadlift", 3, 8, 12, 150), ex("Leg_Press", 3, 10, 15, 120), ex("Lying_Leg_Curls", 3, 10, 15, 60), ex("Standing_Calf_Raises", 4, 10, 15, 60)] },
  { slug: "upper", group: "Upper / Lower", name: "Upper", description: "Everything above the waist, heavy and simple.", exercises: [
    ex("Barbell_Bench_Press_-_Medium_Grip", 4, 6, 8, 150), ex("Bent_Over_Barbell_Row", 4, 6, 8, 150), ex("Seated_Dumbbell_Press", 3, 8, 12, 120), ex("Wide-Grip_Lat_Pulldown", 3, 8, 12, 90), ex("Barbell_Curl", 2, 10, 12, 60), ex("Triceps_Pushdown", 2, 10, 12, 60)] },
  { slug: "lower", group: "Upper / Lower", name: "Lower", description: "Legs and core.", exercises: [
    ex("Barbell_Squat", 4, 6, 8, 180), ex("Romanian_Deadlift", 3, 8, 10, 150), ex("Dumbbell_Lunges", 3, 10, 12, 90), ex("Leg_Extensions", 3, 12, 15, 60), ex("Standing_Calf_Raises", 3, 12, 15, 60), ex("Hanging_Leg_Raise", 3, 10, 15, 60)] },
  { slug: "home", group: "No equipment", name: "Bodyweight at home", description: "No gym needed.", exercises: [
    ex("Pushups", 3, 10, 20, 60), ex("Bodyweight_Squat", 3, 15, 25, 60), ex("Single_Leg_Glute_Bridge", 3, 10, 15, 45), ex("Crunches", 3, 15, 25, 45), hold("Plank", 3, 45)] },
  { slug: "mobility", group: "Mobility", name: "Daily stretch", description: "Ten minutes of timed holds.", exercises: [
    hold("Childs_Pose", 1, 45), hold("Cat_Stretch", 1, 45), hold("Kneeling_Hip_Flexor", 2, 30), hold("Hamstring_Stretch", 2, 30), hold("Chest_And_Front_Of_Shoulder_Stretch", 2, 30), hold("Calf_Stretch_Hands_Against_Wall", 2, 30)] },
];
