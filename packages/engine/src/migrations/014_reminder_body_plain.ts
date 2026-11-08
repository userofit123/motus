// "Ready for more weight" reminders made before the numbers moved into the action carried them in the body too
// ("Ready for more weight: 22.5 kg × 8"), which showed them twice and in the wrong unit after a unit switch.
export default /* sql */ `
UPDATE reminders SET body = 'Ready for more weight'
WHERE action ? 'setWeightKg' AND body LIKE 'Ready for more weight:%';
`;
