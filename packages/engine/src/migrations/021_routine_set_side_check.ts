// A routine set's side is only ever "L", "R" or null (both together): a check, since a data import writes routine_sets
// directly. Its own migration because a database that already ran 020 would never see a change to it; dropping first
// keeps it safe to run again.
export default /* sql */ `
UPDATE routine_sets SET side = NULL WHERE side IS NOT NULL AND side NOT IN ('L','R');
ALTER TABLE routine_sets DROP CONSTRAINT IF EXISTS routine_sets_side_check;
ALTER TABLE routine_sets ADD CONSTRAINT routine_sets_side_check CHECK (side IN ('L','R'));
`;
