// Lessons behind the learn button (graduation cap) in a block's header: what a number means and the research it comes
// from. Research-based explanations live here, never as text under a chart, so the blocks show only the data.
// A new lesson is one more entry; the sheet lays every lesson out the same way.
import { WEEKLY_SET_RANGE } from "@motus/shared";

export type LessonRow = { icon: string; t: string; s?: string; r?: string; ok?: boolean };
export type Lesson = {
  title: string;
  intro: string;
  /** an example of the block's chart, so the lesson points at what the reader sees on screen */
  example?: { label: string; bars: { label: string; value: number }[]; band?: [number, number] };
  sections: { heading: string; rows: LessonRow[] }[];
};

const [lo, hi] = WEEKLY_SET_RANGE;

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
      { heading: "Where the numbers come from", rows: [
        { icon: "note", t: "Schoenfeld, Ogborn & Krieger, 2017", s: `Review of 15 studies: ${lo} or more sets a week per muscle built clearly more muscle than fewer than 5` },
        { icon: "note", t: "Baz-Valle et al., 2022", s: `Review of studies on trained lifters: 12-${hi} sets a week worked best for most muscles, more than ${hi} rarely added much` },
      ] },
      { heading: "How Motus counts", rows: [
        { icon: "target", t: "Main muscle", s: "The muscle the exercise is for", r: "1 set" },
        { icon: "layers", t: "Helping muscle", s: "A muscle that also works in it", r: "0.5 set" },
        { icon: "flame", t: "Warm-up sets", r: "Not counted" },
        { icon: "calendar", t: "This week", s: "Starts on your first day of the week" },
        { icon: "stats", t: "Average per training week", s: "Weeks without a workout are left out" },
      ] },
    ],
  },
} satisfies Record<string, Lesson>;

export type LessonId = keyof typeof LESSONS;
