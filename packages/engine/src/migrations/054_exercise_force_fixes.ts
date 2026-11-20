// Push or pull, as the built-in catalog had it wrong for a few common exercises (the Routine check counts pushing and
// pulling sets by it): Butterfly, a chest fly, was "pull"; two side lateral raises were "pull" while every other side
// raise is "push"; four had none. packages/exercise-data's copy has the same fixes, so a new catalog starts right.
// Built-in rows only (owner_id IS NULL), never an exercise someone made; updated_at moves so offline copies take it.
export default /* sql */ `
UPDATE exercises SET force = v.force, updated_at = now()
  FROM (VALUES ('Butterfly', 'push'), ('Cable_Seated_Lateral_Raise', 'push'), ('Lying_One-Arm_Lateral_Raise', 'push'),
    ('Push-Up_Wide', 'push'), ('Smith_Machine_Decline_Press', 'push'), ('Band_Assisted_Pull-Up', 'pull'),
    ('Incline_Inner_Biceps_Curl', 'pull')) AS v(source_id, force)
  WHERE exercises.owner_id IS NULL AND exercises.source = 'free-exercise-db' AND exercises.source_id = v.source_id
    AND exercises.force IS DISTINCT FROM v.force;
`;
