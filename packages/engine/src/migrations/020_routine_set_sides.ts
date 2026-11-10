// A routine set can be for one side (left or right) beside general sets, on any exercise: the exercise's "One side at a
// time" only says what new sets start as. Null, as every set so far, is both sides together, so nothing to backfill.
// The workout copies each set's side at Start (workout_sets.side, there since 001).
export default /* sql */ `
ALTER TABLE routine_sets ADD COLUMN IF NOT EXISTS side text;
`;
