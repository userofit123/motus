// Optional features (PLAN.md §10.0): switched on or off in Settings → Features, and absent from every screen while off.
// `on` is the default for a new account; the everyday ones start on.
export interface FeatureDef { id: string; name: string; group: string; desc: string; on: boolean; ready?: false }

export const FEATURES: FeatureDef[] = [
  // Logging
  { id: "setTypes", group: "Logging", name: "Set types", desc: "Mark sets as warm-up, drop set or to failure. Warm-ups don't count toward volume or records.", on: true },
  { id: "rpe", group: "Logging", name: "Effort per set (RPE / RIR)", desc: "Rate how hard each set was.", on: false },
  { id: "supersets", group: "Logging", name: "Supersets", desc: "Group exercises so you alternate between them, resting after each round.", on: true },
  { id: "plates", group: "Logging", name: "Plate calculator", desc: "See which plates to load for a weight.", on: true },
  { id: "warmupCalc", group: "Logging", name: "Warm-up sets", desc: "Add a ramp of warm-up sets to an exercise in one tap.", on: true },
  { id: "unilateral", group: "Logging", name: "Left / right sides", desc: "Left and right sets for exercises done one side at a time, with the weight one side moves. Switch it for any exercise from its menu.", on: true },
  { id: "timedSets", group: "Logging", name: "Set tracking", desc: "What each exercise is counted by (reps, time or distance) and its weight, such as a weighted plank or a ruck. Choose it for any exercise from its menu.", on: true },
  { id: "quickEntry", group: "Logging", name: "Quick entry", desc: 'Type "3x8 80" to fill sets.', on: false },
  { id: "voice", group: "Logging", name: "Voice cues", desc: "Hear what's next when a rest ends.", on: false },
  { id: "adaptiveRest", group: "Logging", name: "Longer rest after a missed set", desc: "Adds 30s to the rest when a set falls short of its target.", on: true },
  { id: "notifLogging", group: "Logging", name: "Log from the notification", desc: "Tick the next set from the lock-screen timer (Android).", on: true },
  // Training
  { id: "programs", group: "Training", name: "Programs", desc: "Multi-week plans made of routines, with deload weeks.", on: true },
  { id: "gyms", group: "Training", name: "Gym profiles", desc: "Equipment per gym.", on: false },
  { id: "intervalTimer", group: "Training", name: "Interval timer", desc: "Work and rest in rounds for HIIT, Tabata or circuits, with a beep at each change. Started from the + menu.", on: false },
  { id: "sharing", group: "Training", name: "Share routines", desc: "Send a copy of a routine to another person on your server.", on: false },
  // Body & activity
  { id: "measurements", group: "Body & activity", name: "Body measurements", desc: "Waist, chest, arms and more, plus body fat.", on: true },
  { id: "photos", group: "Body & activity", name: "Progress photos", desc: "Private photos, compared side by side.", on: false },
  { id: "steps", group: "Body & activity", name: "Steps", desc: "Daily steps and a step goal.", on: true },
  { id: "dailyLog", group: "Body & activity", name: "Sleep, water and mood", desc: "A quick daily log.", on: true },
  // Insights
  { id: "achievements", group: "Insights", name: "Achievements", desc: "Milestones like 100 workouts or 100 km walked.", on: true },
  { id: "reports", group: "Insights", name: "Monthly report and year in review", desc: "A summary page for each month and year.", on: true },
  { id: "standards", group: "Insights", name: "Strength standards", desc: "How your lifts compare, relative to body weight.", on: true },
  { id: "shareImage", group: "Insights", name: "Share image", desc: "Make an image of a finished workout.", on: false },
  // Integrations
  { id: "healthConnect", group: "Integrations", name: "Health Connect", desc: "Steps, sleep, weight and workouts from a band, scale or watch, such as one connected through Gadgetbridge. Android app only.", on: false },
  { id: "strava", group: "Integrations", name: "Strava", desc: "Import walks and runs.", on: false, ready: false },
  { id: "apiTokens", group: "Integrations", name: "Personal API", desc: "Tokens for scripts and dashboards, and a file-upload address for GPX/FIT.", on: false },
  { id: "mcp", group: "Integrations", name: "Ask Claude", desc: "Copy a workout as text for an AI assistant, or connect one over MCP.", on: false },
  { id: "wear", group: "Integrations", name: "Wear OS", desc: "The watch app.", on: false, ready: false },
  { id: "liveBundle", group: "Integrations", name: "Instant app updates", desc: "Small fixes arrive without installing a new app version.", on: false, ready: false },
  { id: "palette", group: "Integrations", name: "Command palette", desc: "Ctrl+K to jump anywhere (desktop).", on: false },
];
/** Features that are built and can be switched on (the others are planned and not shown yet). */
export const READY_FEATURES = FEATURES.filter((f) => f.ready !== false);
export const FEATURE_DEFAULTS: Record<string, boolean> = Object.fromEntries(FEATURES.map((f) => [f.id, f.on]));
