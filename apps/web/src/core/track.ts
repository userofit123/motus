// Track by: what each set of an exercise is counted by (reps, time, distance, or two of them) and whether weight goes
// with it. Every exercise has its own way (the catalog's, or your own from its editor); anyone can choose another per
// exercise, built-in ones too (a weighted plank, a ruck). Choosing converts its sets in every routine (the server does
// that), so screens holding sets apply the same rule (refitSet) until their refetch.
import { trackingLabel, type Tracking } from "@motus/shared";
import { trackSheet } from "./ui";

/** The ⋮ menu item that opens the choice, with the one in effect as its hint (hidden while the feature is off); `then` lets a
 * screen show the change before the refetch. */
export const trackItem = (exerciseId: string, tracking: Tracking, featureOn: boolean, then?: (before: Tracking, after: Tracking) => void) => ({
  label: "Track by", hint: trackingLabel(tracking), icon: "target", hidden: !featureOn,
  run: () => (trackSheet.value = { exerciseId, tracking, then }),
});
