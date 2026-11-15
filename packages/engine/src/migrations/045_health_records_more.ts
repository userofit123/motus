// Every kind of record a band, watch, scale or phone app can write to Health Connect (M-239), not only the 16 Motus
// read at first: total calories and basal metabolic rate, speed, power and cadence during a workout, skin, body and
// basal body temperature, blood pressure and glucose, height and the body's lean, bone and water mass, wheelchair
// pushes, mindfulness sessions and what was eaten. Kept like the others (040), without an import log key: nothing in
// the daily log comes from them yet. Left out: cycle tracking (not what Motus is for) and exercise routes (Health
// Connect asks the person about each workout's route on its own, see MotusHealthPlugin.records).
export const RECORD_TYPES = [
  "steps", "distance", "active_kcal", "floors", "elevation", "hydration", "heart_rate", "sleep", "exercise",
  "resting_hr", "spo2", "hrv", "resp_rate", "vo2max", "weight", "body_fat",
  "total_kcal", "wheelchair_pushes", "nutrition", "speed", "power", "steps_cadence", "cycling_cadence", "skin_temp",
  "mindfulness", "bmr", "body_temp", "basal_body_temp", "blood_pressure", "blood_glucose", "height", "lean_mass",
  "bone_mass", "body_water",
] as const;

export default /* sql */ `
ALTER TABLE health_records DROP CONSTRAINT health_records_type_check;
ALTER TABLE health_records ADD CONSTRAINT health_records_type_check CHECK (type IN (${RECORD_TYPES.map((t) => `'${t}'`).join(", ")}));
`;
