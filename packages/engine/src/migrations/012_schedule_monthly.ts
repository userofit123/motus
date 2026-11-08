// Plans can repeat every month on the start date's day, so the rule's allowed values gain 'monthly'.
export default /* sql */ `
ALTER TABLE schedules DROP CONSTRAINT IF EXISTS schedules_rule_check;
ALTER TABLE schedules ADD CONSTRAINT schedules_rule_check CHECK (rule IN ('once','weekly','interval','monthly'));
`;
