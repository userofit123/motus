// History (routine_versions) as 015 means it: each version is the routine as a change left it, and the newest is the
// routine as it is now. Versions from before were saved before each change, so:
// - every routine gets its current state kept now, as an edit (a fixed id per routine, so a device running this too
//   makes the same row and sync doesn't double it);
// - every version is cut down to what History shows and Restore needs (see RoutineSnapshot in @motus/shared): an
//   exercise keeps its id, name, muscles and tracking, its settings and its sets' numbers, never the whole exercise
//   (instructions, images, aliases...). "Always start with these numbers" (prefill 'target') becomes fixed.
const slimSet = /* sql */ `jsonb_build_object('kind', coalesce(s->'kind', '"normal"'), 'reps', s->'reps', 'repsMax', s->'repsMax', 'weightKg', s->'weightKg',
  'durationS', s->'durationS', 'distanceM', s->'distanceM', 'rpe', s->'rpe', 'restS', s->'restS')`;
const arr = (x: string) => `CASE WHEN jsonb_typeof(${x}) = 'array' THEN ${x} ELSE '[]'::jsonb END`;

export default /* sql */ `
UPDATE routine_versions v SET snapshot = jsonb_build_object(
  'name', coalesce(v.snapshot->'name', '""'), 'description', coalesce(v.snapshot->'description', '""'),
  'exercises', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', e->'id', 'exerciseId', e->'exerciseId',
      'name', coalesce(e->'name', e->'exercise'->'name', '""'),
      'primary', coalesce(e->'primary', e->'exercise'->'primaryMuscles', '[]'),
      'secondary', coalesce(e->'secondary', e->'exercise'->'secondaryMuscles', '[]'),
      'tracking', coalesce(e->'tracking', e->'exercise'->'tracking', '"weight_reps"'),
      'superset', e->'superset', 'restS', e->'restS', 'restAfterS', e->'restAfterS', 'repRestS', e->'repRestS', 'restByKind', e->'restByKind',
      'fixed', to_jsonb(coalesce(e->>'fixed' = 'true', false) OR coalesce(e->>'prefill' = 'target', false)),
      'progression', e->'progression', 'note', coalesce(e->'note', '""'),
      'sets', coalesce((SELECT jsonb_agg(${slimSet} ORDER BY i) FROM jsonb_array_elements(${arr("e->'sets'")}) WITH ORDINALITY AS x(s, i)), '[]'::jsonb)
    ) ORDER BY n) FROM jsonb_array_elements(${arr("v.snapshot->'exercises'")}) WITH ORDINALITY AS y(e, n)), '[]'::jsonb));

INSERT INTO routine_versions (id, user_id, routine_id, snapshot, reason, created_at)
SELECT md5(r.id::text || ':016_history_now')::uuid, r.user_id, r.id, jsonb_build_object(
  'name', r.name, 'description', coalesce(r.description, ''),
  'exercises', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', re.id, 'exerciseId', re.exercise_id, 'name', e.name, 'primary', to_jsonb(e.primary_muscles), 'secondary', to_jsonb(e.secondary_muscles),
      'tracking', e.tracking, 'superset', re.superset, 'restS', re.rest_s, 'restAfterS', re.rest_after_s, 'repRestS', re.rep_rest_s,
      'restByKind', re.rest_by_kind, 'fixed', re.fixed, 'progression', re.progression, 'note', coalesce(re.note, ''),
      'sets', coalesce((SELECT jsonb_agg(jsonb_build_object('kind', s.kind, 'reps', s.reps, 'repsMax', s.reps_max, 'weightKg', s.weight_kg,
          'durationS', s.duration_s, 'distanceM', s.distance_m, 'rpe', s.rpe, 'restS', s.rest_s) ORDER BY s.position)
        FROM routine_sets s WHERE s.routine_exercise_id = re.id), '[]'::jsonb)
    ) ORDER BY re.position) FROM routine_exercises re JOIN exercises e ON e.id = re.exercise_id WHERE re.routine_id = r.id), '[]'::jsonb)),
  'edit', now()
FROM routines r WHERE r.deleted_at IS NULL
ON CONFLICT (id) DO NOTHING;
`;
