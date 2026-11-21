// Lessons behind the learn button (graduation cap) in a block's header: what a number means and the research
// behind its targets. Research-based explanations live here, never as text under a chart, so the blocks show only the data.
// A new lesson is one more entry; the sheet lays every lesson out the same way.
import { WEEKLY_SET_RANGE, MIN_NIGHTS, SLEEP_WEIGHTS, ACTIVITY_WEIGHTS, STRENGTH_WEIGHTS, WEEKLY_ACTIVE_MIN, STRENGTH_DAYS, GOOD_EFFICIENCY, MODERATE_FROM, VIGOROUS_FROM, SET_LOAD, MINUTE_LOAD, MIN_LOAD_DAYS, HR_ZONES, ZONE_WEIGHTS } from "@motus/shared";
import { GOALS, SESSION_SETS, TWICE, restText, CHECK_RESEARCH } from "@motus/shared";

/** `ref`: a source's full reference, under what it found */
export type LessonRow = { icon: string; t: string; s?: string; r?: string; ok?: boolean; ref?: string };
export type Lesson = {
  title: string;
  intro: string;
  /** an example of the block's chart, so the lesson points at what the reader sees on screen */
  example?: { label: string; bars: { label: string; value: number }[]; band?: [number, number] };
  sections: { heading: string; rows: LessonRow[] }[];
};

const [lo, hi] = WEEKLY_SET_RANGE;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const points = (n: number) => `${n} points`;
/** a Routine check's points over the goals: "20 points", or "15-30 points" where the goal changes them */
const goalPoints = (k: keyof (typeof GOALS)["size"]["weights"]) => { const v = Object.values(GOALS).map((g) => g.weights[k]); const lo = Math.min(...v), hi = Math.max(...v); return lo === hi ? points(lo) : `${lo}-${hi} points`; };
// the same source in two lessons reads the same in both
const WHO = "Bull FC, et al. WHO 2020 guidelines on physical activity and sedentary behaviour. British Journal of Sports Medicine, 2020; 54(24): 1451-1462";
const SCHOENFELD = { icon: "note", t: "Schoenfeld, Ogborn & Krieger, 2017", s: `A review of 15 studies that compared how many sets a week people did for a muscle: people who did ${lo} or more sets a week gained clearly more muscle than people who did fewer than 5`,
  ref: "Schoenfeld BJ, Ogborn D, Krieger JW. Dose-response relationship between weekly resistance training volume and increases in muscle mass: a systematic review and meta-analysis. Journal of Sports Sciences, 2017; 35(11): 1073-1082" };

// how a set counts for a muscle (muscleSetCount and muscleSets in @motus/shared): the same rows in every lesson whose
// numbers use that count (weekly sets, the Strength score, the Routine check)
const MUSCLE_SET_ROWS = [
  { icon: "target", t: "Main muscle", s: "The muscle the exercise is mainly for (bench press: chest)", r: "1 set" },
  { icon: "layers", t: "Helper", s: "A muscle that also works in it (bench press: triceps)", r: "0.5 set" },
  // "split" is the app's left-and-right icon (the "One side at a time" menu item)
  { icon: "split", t: "Left and right sets", s: "A left set and a right set of a one-arm or one-leg exercise (one-arm curl, left then right: biceps)", r: "1 set" },
];

export const LESSONS = {
  weeklySets: {
    title: "Working sets per week",
    intro: `How many working sets each muscle group gets in a week. The dashed box marks ${lo}-${hi} sets, the range where most people build the most muscle.`,
    example: { label: "Example week", bars: [{ label: `Under ${lo}`, value: 6 }, { label: `${lo}-${hi}`, value: 14 }, { label: `Over ${hi}`, value: 26 }], band: WEEKLY_SET_RANGE },
    sections: [
      { heading: "What the range means", rows: [
        { icon: "clock", t: `Under ${lo} sets`, s: "Muscles still grow, just more slowly" },
        { icon: "check", t: `${lo}-${hi} sets`, s: "Where most people build the most muscle", ok: true },
        { icon: "moon", t: `Over ${hi} sets`, s: "Little extra growth for most people, and harder to recover from" },
      ] },
      { heading: "Where the targets come from", rows: [
        SCHOENFELD,
        { icon: "note", t: "Baz-Valle et al., 2022", s: `Review of studies on trained lifters: 12-${hi} sets a week worked best for most muscles, more than ${hi} rarely added much`,
          ref: "Baz-Valle E, Balsalobre-Fernández C, Alix-Fagoaga C, Schoenfeld BJ. A systematic review of the effects of different resistance training volumes on muscle hypertrophy. Journal of Human Kinetics, 2022; 81: 199-210" },
      ] },
      { heading: "How Motus counts", rows: [
        ...MUSCLE_SET_ROWS,
        { icon: "flame", t: "Warm-up sets", r: "Not counted" },
        { icon: "calendar", t: "Last 7 days", s: "Today and the 6 days before it" },
        { icon: "stats", t: "Average per training week", s: "Weeks without a workout are left out" },
      ] },
    ],
  },
  // the health scores: what each guideline found, then how Motus turns it into points
  sleepScore: {
    title: "Sleep score",
    intro: "How your last 7 nights, as your watch or band tracked them, compare with the National Sleep Foundation's advice for adults: enough hours, little time awake and steady times. Your nights come from your watch or band; the studies below set the targets. Each part gives its points for the share of nights that met it, so 100 means every night met all three.",
    sections: [
      { heading: "Where the targets come from", rows: [
        { icon: "note", t: "National Sleep Foundation, 2015", s: "An expert panel reviewed the research on sleep and health: adults should sleep 7-9 hours a night, and 7-8 hours from 65",
          ref: "Hirshkowitz M, et al. National Sleep Foundation's sleep time duration recommendations: methodology and results summary. Sleep Health, 2015; 1(1): 40-43" },
        { icon: "note", t: "National Sleep Foundation, 2017", s: `An expert panel on sleep quality: being asleep for ${pct(GOOD_EFFICIENCY)} or more of your time in bed is a sign of good sleep at every adult age (Motus uses the time your watch or band tracked)`,
          ref: "Ohayon M, et al. National Sleep Foundation's sleep quality recommendations: first report. Sleep Health, 2017; 3(1): 6-19" },
        { icon: "note", t: "National Sleep Foundation, 2023", s: "An expert consensus: going to bed and waking up at regular times matters for health, not only how long you sleep. It sets no exact window, so Motus uses an hour",
          ref: "Sletten TL, et al. The importance of sleep regularity: a consensus statement of the National Sleep Foundation sleep timing and variability panel. Sleep Health, 2023; 9(6): 801-820" },
      ] },
      { heading: "How Motus counts", rows: [
        { icon: "device", t: "Time tracked", s: "From when your watch or band saw you fall asleep (or lie awake just before) to when you woke up. It can't tell when you got into bed, so lying awake before it starts tracking isn't counted" },
        { icon: "moon", t: "Hours asleep", s: "Nights with 7-9 hours asleep (7-8 from 65)", r: points(SLEEP_WEIGHTS.duration) },
        { icon: "bed", t: "Stayed asleep", s: `Nights asleep for ${pct(GOOD_EFFICIENCY)} or more of the time tracked. Only nights your watch or band split into asleep and awake count; with fewer than ${MIN_NIGHTS} of them, it is left out of the score`, r: points(SLEEP_WEIGHTS.efficiency) },
        { icon: "clock", t: "Regular times", s: "Nights within an hour of your usual bed and wake times", r: points(SLEEP_WEIGHTS.regularity) },
      ] },
    ],
  },
  activityScore: {
    title: "Activity score",
    intro: `How active your last 7 days were, against the World Health Organization's ${WEEKLY_ACTIVE_MIN} minutes a week and the steps a day linked with a longer life. Each part gives its points for how much of its target you reached, so 100 means you reached both.`,
    sections: [
      { heading: "Where the targets come from", rows: [
        { icon: "note", t: "World Health Organization, 2020", s: `Adults should get at least ${WEEKLY_ACTIVE_MIN} minutes of moderate activity a week, or 75 minutes of vigorous activity, or a mix of both. Any activity is better than none`, ref: WHO },
        { icon: "note", t: "American College of Sports Medicine, 2011", s: `Effort counts as moderate at ${Math.round(MODERATE_FROM * 100)}-76% of your max heart rate and vigorous at ${Math.round(VIGOROUS_FROM * 100)}-95%`,
          ref: "Garber CE, et al. Quantity and quality of exercise for developing and maintaining cardiorespiratory, musculoskeletal, and neuromotor fitness in apparently healthy adults. Medicine & Science in Sports & Exercise, 2011; 43(7): 1334-1359" },
        { icon: "note", t: "Compendium of Physical Activities, 2024", s: "Weight training and brisk walking use about 3.5-6 times the energy of sitting still, which makes them moderate activity. Stretching and yoga use less than 3 times, which makes them light",
          ref: "Herrmann SD, et al. 2024 Adult Compendium of Physical Activities: a third update of the energy costs of human activities. Journal of Sport and Health Science, 2024; 13(1): 6-12" },
        { icon: "note", t: "Paluch et al., 2022", s: "15 studies of about 47,000 adults: the more steps a day, the lower the risk of dying early, until about 8,000-10,000 steps under 60 and 6,000-8,000 from 60, where the benefit levels off",
          ref: "Paluch AE, et al. Daily steps and all-cause mortality: a meta-analysis of 15 international cohorts. The Lancet Public Health, 2022; 7(3): e219-e228" },
      ] },
      { heading: "How Motus counts", rows: [
        { icon: "bolt", t: "Active minutes", s: `Every workout and recorded activity except stretching and yoga, plus other minutes your watch or band recorded at ${pct(MODERATE_FROM)} or more of your max heart rate, against ${WEEKLY_ACTIVE_MIN} a week. A walk recorded during a workout counts its time once, and a workout longer than 4 hours doesn't count, since it was most likely left running. Minutes at ${pct(VIGOROUS_FROM)} or more count double`, r: points(ACTIVITY_WEIGHTS.minutes) },
        { icon: "steps", t: "Daily steps", s: "Your average a day, against 8,000 (6,000 from 60): where the benefit starts to level off", r: points(ACTIVITY_WEIGHTS.steps) },
        { icon: "heart", t: "Max heart rate", s: "The one you set in Body, or 220 minus your age" },
      ] },
    ],
  },
  strengthScore: {
    title: "Strength score",
    intro: "How your strength training over the last 7 days compares with the World Health Organization's advice and the weekly sets that build muscle. Each part gives its points for how much of its target you reached, so 100 means you reached both.",
    sections: [
      { heading: "Where the targets come from", rows: [
        { icon: "note", t: "World Health Organization, 2020", s: `Adults should do muscle-strengthening activities that work all major muscle groups on ${STRENGTH_DAYS} or more days a week`, ref: WHO },
        SCHOENFELD,
      ] },
      { heading: "How Motus counts", rows: [
        { icon: "calendar", t: "Strength days", s: `Days with hard sets, against ${STRENGTH_DAYS} a week`, r: points(STRENGTH_WEIGHTS.days) },
        { icon: "activity", t: `Muscle groups with ${lo}+ hard sets`, s: "Chest, back, shoulders, arms, core and legs", r: points(STRENGTH_WEIGHTS.groups) },
        ...MUSCLE_SET_ROWS,
      ] },
    ],
  },
  // the Routine check (M-273): what each source found, then each check and its points
  routineCheck: {
    title: "Routine check",
    intro: "How your programs and routines compare with what training research found works. The targets follow the program's goal. A program is checked on its page over one week, all that week's workouts together: sets per muscle, training each muscle on 2 days a week, and balance between pushing and pulling and between front and back of the thigh. A routine is checked on one workout of it: reps, sets per muscle in that workout, exercise order and rest, using the goal of the program it is in. A routine that isn't in any program is checked for muscle size. Tap any check for its numbers, the target and what to change. A check is fully met when its whole target is met; one that is only partly met still adds part of its points to the score, so 100 means every check is fully met.",
    sections: [
      { heading: "Targets for each goal", rows: Object.values(GOALS).map((g) => ({ icon: "goals", t: g.name,
        s: `${g.bigReps ? `${g.bigReps[0]}-${g.bigReps[1]} reps on big lifts, ${g.reps[0]}-${g.reps[1]} on single-muscle lifts` : g.reps[1] >= 100 ? `${g.reps[0]}+ reps` : `${g.reps[0]}-${g.reps[1]} reps`} · at least ${g.weekSets} sets a week per muscle · rest ${g.rest[1] === Infinity ? `at least ${restText(g.rest[0])}` : `${restText(g.rest[1])} or less`} between sets of big lifts` })) },
      // every finding the checks cite, worded as the checks' popups word them (shared CHECK_RESEARCH)
      { heading: "Where the targets come from", rows: Object.values(CHECK_RESEARCH).map((x) => ({ icon: "note", ...x })) },
      { heading: "How Motus counts", rows: [
        { icon: "activity", t: "Sets a week per muscle", s: "A program's week: working sets for each major muscle, against the goal's target", r: goalPoints("volume") },
        { icon: "calendar", t: `Muscles trained on ${TWICE} or more days`, s: `A program's week: is there an exercise mainly for each major muscle on at least ${TWICE} different days? A day where the muscle only helps, like the triceps in a bench press, isn't one of them`, r: goalPoints("frequency") },
        { icon: "swap", t: "Pushing and pulling sets", s: "A program's week: about as many upper-body pulling sets as pushing sets, 3-6 pulling sets for every 4 pushing sets", r: goalPoints("pushPull") },
        { icon: "split", t: "Quad and hamstring sets", s: "A program's week: the hamstrings get at least half as many sets as the quads, and at most twice as many", r: goalPoints("legs") },
        { icon: "refresh", t: "Reps per set", s: "A routine's workout: working sets with target reps in the goal's range", r: goalPoints("reps") },
        { icon: "layers", t: `Up to ${SESSION_SETS} sets per muscle`, s: "A routine's workout: working sets for each muscle in that one workout", r: goalPoints("session") },
        { icon: "arrowUp", t: "Big lifts first", s: "A routine's workout: big lifts, the ones that work several muscles (a press, a row, a squat), before single-muscle lifts that tire the same muscles. Counts most for strength", r: goalPoints("order") },
        { icon: "timer", t: "Rest between sets of big lifts", s: "A routine's workout: the planned rest between sets of each big lift, from the routine or your defaults in Settings", r: goalPoints("rest") },
        ...MUSCLE_SET_ROWS,
        { icon: "flame", t: "Warm-up sets", r: "Not counted" },
      ] },
    ],
  },
  // training load has no research source of its own to cite here: the lesson says what a point is and how it is compared
  trainingLoad: {
    title: "Training load",
    intro: "How much training your body took in, counted in load points of training effort. One load point is one minute at a very light heart rate; harder minutes count more, so a hard session adds many more load points than an easy one. Motus compares your last 7 days with your usual week.",
    sections: [
      { heading: "How Motus counts", rows: [
        ...HR_ZONES.map((z, i) => ({ icon: "heart", t: `${z.name} heart rate`, s: "Each minute", r: i === 0 ? "1 load point" : `${ZONE_WEIGHTS[i]} load points` })),
        { icon: "dumbbell", t: "Done sets", s: "Counted instead of heart rate when they give more, as heart rate drops between sets", r: `${SET_LOAD} load points each` },
        { icon: "activity", t: "Activity without heart rate", s: "Each minute", r: `${MINUTE_LOAD} load points` },
      ] },
      { heading: "Against your usual", rows: [
        { icon: "calendar", t: "Last 7 days", s: "Today and the 6 days before it" },
        { icon: "stats", t: "Your usual week", s: `The average week of the last 4, from ${MIN_LOAD_DAYS / 7} weeks after your first workout or activity` },
        { icon: "arrowDown", t: "Less than usual", s: "More than 20% below your usual week: raises your readiness" },
        { icon: "check", t: "About your usual", s: "From 20% below to 30% above your usual week" },
        { icon: "arrowUp", t: "More than usual", s: "30-50% above your usual week: lowers your readiness" },
        { icon: "arrowUp", t: "Much more than usual", s: "More than 50% above your usual week: lowers your readiness more" },
      ] },
    ],
  },
} satisfies Record<string, Lesson>;

export type LessonId = keyof typeof LESSONS;
