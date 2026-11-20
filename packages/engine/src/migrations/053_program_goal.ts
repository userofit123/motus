// What a program trains for (M-291): muscle size, strength, fat loss, muscular endurance or general fitness
// (packages/shared routineCheck.ts GOALS). The Routine check's targets follow it. Programs made before this train
// for muscle size, the targets the check used until now, so their scores don't change.
export default /* sql */ `
ALTER TABLE programs ADD COLUMN goal text NOT NULL DEFAULT 'size'
  CHECK (goal IN ('size', 'strength', 'fatLoss', 'endurance', 'health'));
`;
