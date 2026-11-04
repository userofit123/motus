// A device still on the app from before 008 sends activity types without has_steps. Sync writes a row from its JSON,
// so the missing key arrived as NULL and broke NOT NULL, and an older backup restored every type as "no steps".
// Unset (NULL) now means "decide by slug" (walk, run and hike count steps), read once in the engine's list of types.
export default /* sql */ `
ALTER TABLE activity_types ALTER COLUMN has_steps DROP NOT NULL;
ALTER TABLE activity_types ALTER COLUMN has_steps DROP DEFAULT;
`;
