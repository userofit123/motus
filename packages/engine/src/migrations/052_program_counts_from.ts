// When a program with no start date starts counting workouts (M-288). Set when it is made without a date, when its date
// is taken away and when it starts again from week 1: it then starts with the first workout done after that moment, so
// removing a date never brings back workouts from before ("Start again from week 1", a date planned ahead). Empty on
// programs made before this: they count from when they were made (created_at), as they did.
export default /* sql */ `
ALTER TABLE programs ADD COLUMN counts_from timestamptz;
`;
