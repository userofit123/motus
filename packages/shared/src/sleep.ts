// What counts as a night's sleep. A record under 3 hours is a nap or a partial record (a band that slipped off, a night
// cut short by a dead battery), not a night: it is still shown, marked as short, but every average and count of nights
// (Stats → Sleep, Reports, Readiness, the average-sleep goal) leaves it out, so one stray half hour doesn't pull a
// month's average down by half an hour.

/** The fewest hours asleep that count as a night */
export const MIN_NIGHT_H = 3;
/** The same in minutes, for the app's nights (kept in minutes asleep) */
export const MIN_NIGHT_MIN = MIN_NIGHT_H * 60;
/** Whether hours asleep make a night (rather than a nap or a partial record) */
export const isNight = (hours: number) => hours >= MIN_NIGHT_H;
/** Whether minutes asleep make a night */
export const isNightMin = (min: number) => min >= MIN_NIGHT_MIN;
