// A routine set with a rep range keeps the range as its goal and, apart from it, where next time starts inside it (the
// reps last done, kept at each finish). Null is the range's bottom, which is what every set started at until now, so
// existing rows need no backfill: reps stays the range's bottom.
export default /* sql */ `
ALTER TABLE routine_sets ADD COLUMN IF NOT EXISTS start_reps int;
`;
