// Activity types say whether steps are counted while recording one (on foot: a walk, run or hike, or a type you add),
// instead of the app keeping its own list of slugs that types you added could never join.
export default /* sql */ `
ALTER TABLE activity_types ADD COLUMN has_steps boolean NOT NULL DEFAULT false;
UPDATE activity_types SET has_steps = true WHERE slug IN ('walk', 'run', 'hike');
`;
