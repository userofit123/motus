// Goals counted day by day: every day, on workdays, or on chosen days of the week. days: null (every day),
// "workdays" (the person's work week, from settings) or [0..6] (Sunday = 0).
export default /* sql */ `
ALTER TABLE goals DROP CONSTRAINT IF EXISTS goals_period_check;
ALTER TABLE goals ADD CONSTRAINT goals_period_check CHECK (period IN ('once','day','week','month'));
ALTER TABLE goals ADD COLUMN days jsonb;
`;
