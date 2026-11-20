---
name: writer
description: Motus writing check. Use before finishing ANY text a person will read - UI labels, hints, scores' one-line explanations, empty states, settings text, voice cues, errors, task notes, commit messages, changelog. Makes every sentence clear, in context and sensible.
---

# Writer: every sentence clear, in context, and sensible

The developer reads the app as a user who has never seen the code. Text that is technically true but
makes them stop and ask "what does this mean?" is a bug. Run this check on every string you add or change,
and on the strings next to it on the same screen.

## 1. Say what time it covers
Every number or verdict names its period unless the block's header already says it once for everything in it.
- "Sleep -1h" → "Last night: 1h less than usual".
- "Resting heart rate 57" → "Resting heart rate this morning" / "Average, last 7 days".
- "A heavy week of training" → "You trained a lot in the last 7 days" (past, and which days).
If two lines in one block cover different periods, each says its own.

## 2. Say it the way a person would
Read it aloud as if telling a friend. If you would not say it, rewrite it.
- Positive framing, plain counts: "3 of 7 nights outside 7-9 hours asleep" → "4 of 7 nights you slept 7-9 hours"
  or "You slept less than 7 hours on 3 of the last 7 nights".
- No double negatives, no "outside/within range" maths for the reader to do.
- Name the thing the user knows (a muscle, a set, last night), not the internal concept (load, delta, window).

## 3. Cause, then advice
A verdict says why and what to do, in that order, in one short sentence:
"You slept 1h less than usual and trained hard this week: keep today light."
Never advice alone ("take it easier") and never a cause without the effect on the user.

## 4. One meaning per word
- Use the same word for the same thing everywhere in the app (grep the existing UI text before naming
  something). Don't call it "rest" here and "recovery" there.
- Don't reuse a word for a different thing on the same screen.

## 5. Short and concrete
- One idea per sentence; cut words that add nothing ("in order to", "currently", "please note").
- Numbers with units ("8 hours", "57 bpm", "80 kg"); ranges "7-9"; empty value "-".
- Plain dashes only; dot separators " · " with single spaces (CLAUDE.md).

## 6. Research claims say who found what
A sentence that rests on research says so in the sentence itself: who was studied, what was compared, what
was measured, and the source, in plain words. Never a bare result like "2 days built more muscle than 1".
- "Training a muscle on 2 days built more muscle than on 1" → "In a 2016 review of 10 studies (Schoenfeld and
  others), people who trained a muscle on 2 days a week gained more muscle than people who trained it on 1 day."
- Say how sure it is when it matters: "a review of studies", "one study of 34 trained men", "common practice,
  not tested in studies".
- Later or conflicting findings get the same treatment: who, what, and what it means for the reader.

## 7. Context check before you finish
For each string, answer from the screen alone (no code):
1. Which period/thing does it refer to?
2. Would a new user know what to do or think after reading it?
3. Does it agree with the numbers shown next to it?
4. Does it read the same way as its siblings on this screen?
Any "no" → rewrite. In your final report, list each string you wrote or changed as before → after.

## Notes and messages to the developer
Plain language for a non-engineer, no file or code names, one concrete example, what changed and why it
matters. Answer every question they asked, in the order they asked it.
