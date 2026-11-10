// One side at a time (left and right sets, the weight one side moves): each person can now say so for any exercise,
// built-in ones too, so it is a per-person setting beside rest and favourite. Null keeps the exercise's own default.
// The catalog's default also caught too few by name ("One-Legged", lunges, split squats and step-ups were missed); the
// same names as catalog.ts's ONE_SIDE_NAME (minus NOT_ONE_SIDE), and updated_at moves so offline copies take the corrected catalog.
export default /* sql */ `
ALTER TABLE exercise_prefs ADD COLUMN IF NOT EXISTS unilateral boolean;
UPDATE exercises SET unilateral = true, updated_at = now()
  WHERE owner_id IS NULL AND source = 'free-exercise-db' AND NOT unilateral
    AND name ~* '\\y(one[- ]arm(ed)?|single[- ]arm(ed)?|one[- ]leg(ged)?|single[- ]leg(ged)?|one[- ]handed|single[- ]handed|alternat(e|ing)|unilateral|split squats?|lunges?|step[- ]?ups?|pistol|bulgarian)\\y'
    AND name !~* '\\y(heel touchers?|leg diagonal bound|lunge sprint)\\y';
`;
