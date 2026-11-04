// Rest after warm-up, drop and to-failure sets, set per exercise in a routine ({ warmup: 60, drop: 0 }).
export default /* sql */ `
ALTER TABLE routine_exercises ADD COLUMN rest_by_kind jsonb;
`;
