# Changelog

The top entry's version is the one the release workflow publishes. Add a new `## [x.y.z]` section to release.

## [0.1.46] - 2026-11-20

- Every routine and program check line says plainly what it means, with your own numbers and exercises, e.g. "Chest gets 19 sets in this workout. After about 11 the chest is too tired for more sets to build much: move the other 8 to another day of the week."
- Tips name your own routines and exercises, and never suggest an exercise you already do.
- Butterfly, Cable Seated Lateral Raise and Lying One-Arm Lateral Raise count as pushing exercises, and a few exercises without a push or pull label now have one, so the push and pull balance is right.
- Both weekly checks on a program count the same 10 muscles. A muscle with no sets shows as trained on 0 days.
- With the strength goal, the reps check is titled "1-6 reps on big lifts, 5-30 on single-muscle lifts", so the title matches the count under it. Lifts the check can't sort say "Not checked", and the popup says why.
- With the general fitness goal, the reps tip gives that goal's own reason.

## [0.1.45] - 2026-11-20

- Every routine check target is a full sentence you can act on, e.g. "Train each muscle on at least 2 different days of the week" instead of "Each trained muscle on 2 or more days a week", and "For every pushing set, do 0.75-1.5 pulling sets".

## [0.1.44] - 2026-11-20

- In a routine check's popup, The target gives the target and a short reason in plain words, e.g. "At least 1:30 between sets of a big lift. A longer rest lets you do more reps in the next set, which builds a little more muscle." The study detail moved to the section below it, which reads "Where the targets come from" when a check has two targets.
- A few research summaries were corrected to say only what the studies found, e.g. the 2016 rest study found more muscle in the thighs only.

## [0.1.43] - 2026-11-20

- Programs have a goal: Muscle size, Strength, Fat loss, Muscular endurance or General fitness (Edit in ⋮). Routine check's targets follow it, e.g. for strength 1-6 reps and at least 3 minutes' rest on big lifts, for muscle size 5-30 reps and 10 or more sets a week per muscle. A routine uses the goal of the program it is in, and muscle size when it is in none.
- Every routine check line names its muscles and exercises in full instead of "and 2 more", and tapping it opens a popup: your numbers per muscle or exercise, the target and why, what to change, and the research behind it.
- The explanations say which study found what, in whom, and how sure it is, e.g. "In a 2016 review of 10 studies (Schoenfeld and others), people who trained a muscle on 2 days a week gained more muscle than people who trained it on 1 day." Terms like working sets and big lifts are explained where they first appear.
- A routine is also checked for sets per muscle in one workout (past about 11, extra sets add little) and for rest on big lifts. Single-muscle lifts like cable rotations no longer count as big lifts, and more than 20 sets a week is no longer marked down.
- After an app update adds a new setting, such as a program's goal, each device fills it in from the server once instead of showing the default. Every device downloads its copy of your data once on its next sync.

## [0.1.42] - 2026-11-20

- A routine shows only checks about its own workout: big lifts first, and reps per set, whether or not it is in a program. A program's checks (sets per muscle, each muscle twice a week, balance) show only on the program, over one week.
- A routine in a program lists it on its page under "Part of a program" (or "Part of 2 programs"), with how far along each program is. Tap one to open it.
- The planner only offers today or later, so a workout can no longer be planned for a day that has passed. To link a past workout to a program day, use "Choose the workout" in that day's ⋮ menu.
- Undo after removing a missed plan in the Calendar works again.

## [0.1.41] - 2026-11-20

- A program's start can be "No date": it then starts with its first workout. Removing a date or choosing "Start again from week 1" never counts workouts done before.
- A program shows when it ends, worked out from its weeks, e.g. "Week 2 of 8 · ends Sun 17 Jan 2027". The year shows when it isn't this year.
- Programs count each finished workout for the earliest week still missing its routine, so doing a week's routines in another order no longer fills the wrong weeks.
- Each day in a program has a ⋮ menu: choose the workout that counts for it, mark it skipped, or schedule it. A planned day shows its date, e.g. "Up next · planned Tue 24 Nov".
- Routine check scores a program over a whole week (sets per muscle, each muscle twice a week, balance), and a routine in a program on its own workout (big lifts first, reps). The routine shows a row that opens its program instead of repeating the weekly checks.
- A running workout shows your band's heart rate from the first reading on. A reading over 10 minutes old is a shade lighter with its age, e.g. "78 bpm, 25 min ago", the same in the workout, the recording screen and the minimised bar. Motus checks Health Connect again 30 seconds after you come back to it.
- The minimised bar shows your heart rate in place of "Workout in progress", "Paused" under its clock, and "Resting" for every rest.

## [0.1.40] - 2026-11-19

- Minimising a workout takes you back to the page you were on, e.g. Stats → Sleep, instead of Home.
- Finishing a workout always ends on its "Well done" page. Before, it sometimes jumped to Home.
- A left or right set marked "No rest" never starts a rest. "Longer rest after a missed set" now only lengthens a rest that's already planned, and empty reps don't count as a miss.
- The set you're on in a workout has an accent ring around it, so it stands out.

## [0.1.39] - 2026-11-19

- Routine check is titled for the routine or program you're looking at, and every value says what it counts, e.g. "15 push" over "4 pull" or "1 of 3 muscles". Its rows use the same colours as Stats → Scores, and the line under the score says when checks earn part of their points.
- The body weight chart's line goes through your weigh-ins. The smoothed trend appears as a second line once there are 7 weigh-ins over 2 weeks, and the Change tile works for short periods and names its period.
- Home's Last night ring is the same size as the other Home rings, with the percent in the line under it, and Edit home's up and down arrows are back next to the Reorder blocks list.
- Stats and the Calendar day use one spacing system: a header sits close to its own chart, and sections inside a card are clearly further apart.
- A night's sleep score looks like the weekly one, says "This night", and explains why it can differ from the 7-night score.
- Scores say "target" instead of "aim", e.g. "Where the targets come from" and "target 7-9 hours".
- Settings → Weights calls the - and + amount "Weight step", and the amount added when progressing is now "Increase by", in Settings and the routine editor.

## [0.1.38] - 2026-11-19

- Home says what each comparison covers: This week reads "Vs Mon-Thu last week" (this week so far against the same days last week), and Readiness and Heart read "Vs your 28-day usual".
- Home's Last night ring shows the share of the night you were asleep, with the percent inside and "Asleep for 88% of the 7h 30m tracked" under it. Stats → Sleep's night page uses the same ring.
- Home's blocks reorder by dragging: ⋮ → Reorder blocks, on Home or in Edit home.
- Sleep says "tracked" instead of "in bed", because the band can't tell when you got into bed. Nights where the band didn't record any time awake no longer show 100% asleep and are left out of the score's "Stayed asleep" part (the old "Asleep in bed"), which now says what it counts.
- Score sources are called "Where the aims come from": your numbers come from your watch or band, and the studies set the aims.
- Each night in Stats → Sleep has its own sleep score, as a ring in the Nights list and with its parts on the night's page, and each block on Stats → Scores shows its own score.
- The Activity score counts your workouts and recorded activities (all but stretching and yoga) as active minutes, not only minutes at a brisk heart rate. A workout over 4 hours doesn't count, since it was most likely left running.
- Load points say what they are: 1 for each minute at a very light heart rate, more when harder.
- New optional Routine check (Settings → Features → Insights): a score out of 100 for each routine and program, with one tip per check for sets per muscle, how often each muscle is trained, push and pull balance, quads and hamstrings, exercise order and reps.
- Change an activity's start and end times afterwards (⋮ → Change times), and finish a forgotten recording at the time it really ended (⋮ → Finish at an earlier time). The route and heart rate outside the new times are cut. Workouts' Change times uses the same date and time pickers.
- A note added from an exercise's own page during a workout shows under that exercise, with the same choices as its Note button.
- The Goals page shows each goal like Home's pinned goal: progress beside its streak.
- The body weight chart shows each weigh-in as a dot beside the smoothed trend, so today's weigh-in is on the chart.
- Heart rate zones show where each zone starts (e.g. "Moderate 130+") and how long you were in any zone, and short spikes show as under a minute instead of vanishing.
- Rows of three tiles no longer cut off their labels or values, and chart headers sit right above their charts.
- Settings → Weights calls the stepper setting "Weight buttons change by", and Stats → Achievements no longer shows a period choice that changed nothing.

## [0.1.37] - 2026-11-16

- 

## [0.1.37] - 2026-11-16

- Voice cues keep using your phone's speech: one failed cue no longer switches it off for the rest of the workout. Motus tries again soon, then your phone's other speech engines, before its own voice speaks instead.
- Settings → Workout defaults shows, under Voice cues, which voice speaks on this device and whether it works. A problem stays shown until it's fixed, with what to do. Speaks with picks the speech engine or Motus's own voice, and English voice picks the voice, each with a play button. On the phone, the ⋮ menu opens the phone's speech settings.

## [0.1.36] - 2026-11-16

- 

## [0.1.36] - 2026-11-16

- Every chart over time can be zoomed: pinch it on a phone, or use Ctrl + scroll wheel or a trackpad pinch on a computer, and scroll left and right through it. Day by hour has zoom in and zoom out buttons instead of full screen, and the Sleep night's charts zoom together so they stay lined up.
- Tapping a chart shows its tooltip and never leaves the page. When the item can open (a workout, day, week, night or session), the tooltip ends with › and tapping the tooltip opens it.
- Home's Today at a glance block lets you choose its rings in Edit home, and Readiness opens Stats → Scores, where it is shown in full, even with Health scores switched off.
- Home's "Today's calendar" block is now called "Your day".
- Scores with an aim to reach show your number with the aim beside it, e.g. "5 days · aim for 2 days or more", instead of "5 of 2".

## [0.1.35] - 2026-11-16

- Voice cues work everywhere: when a rest ends you hear the rest over sound, then the next set spoken, e.g. "Rest over. Bench press, set 3, 8 reps at 80 kilos". If your browser, the desktop app or the phone has no English voice, Motus speaks in its own built-in voice, so nothing needs installing. Turning Voice cues on in Features switches everything it needs on and plays an example; if the phone can't speak, a message says why and where to fix it.
- Readiness and the health scores say when each number is from ("last night", "today", "in the last 7 days"), give the reason then the advice in two lines, e.g. "You slept less last night and your resting heart rate looks tired: train lightly today.", and the sleep score reads "You slept less than 7 hours on 3 of 7 nights: aim for 7-9 hours."
- Training load is counted in load points ("705 load points in the last 7 days · usual 219 points a week"), with a short lesson on the Heart tab explaining what a point is.
- Scores that are based on studies have a "Where the numbers come from" row that opens a short lesson on what the studies found and how Motus counts the score.
- The Calendar's day view is easier to read: straight lines between the tiles, a sleep chart with one row per stage, workouts and activities as striped bands with their own header, and Day by hour can be made wider to scroll through the hours or opened full screen in landscape.
- The More page has an Appearance button in its top right corner, and buttons side by side in a page header no longer touch on phones.
- No more duplicated goals, routines or other items after restoring a backup with replace: every device rebuilds its copy from the server once, keeping changes it hasn't sent yet. Changes the server can't save for a moment are retried later, and if anything has to be removed from a device a notice says so until you close it.
- Updating adds a few database changes on first start, and backups made with this version need it to be restored.

## [0.1.34] - 2026-11-16

- Home suggestions name specific muscles your routines miss, even inside a group you train, e.g. "Add an exercise for your lower back (along your lower spine)", with one plain reason. Dismissing one hides only that muscle for a week.

## [0.1.33] - 2026-11-16

- Voice cues work: when a rest ends Motus says the next set (e.g. "Bench press, set 3, 8 reps at 80 kilos") and "10 seconds" before it, also with the screen locked; music gets quieter while it speaks. Needs Play sounds on.
- Home suggestions: a suggestion goes away once you plan or start it, dismissing one keeps that routine and muscle away for a week, each says plainly what and why, and All shows every suggestion.
- Every setting does what it says: Rest timer on the lock screen, Keep the screen on and Planned workout reminders now follow their switches; settings that never did anything are gone.
- Nothing from your band is counted twice: hourly steps add up to the day, heart rate from two apps counts once, the same workout from two apps is one activity, and your band's copy of a workout or walk you recorded is matched to it (Imported data shows it, with Unlink). Old duplicates are cleaned up once after updating.
- A finished workout shows your band's heart rate with each set and rest marked, time in each zone, calories and recovery; activities also show speed and cadence.
- A Calendar day shows the whole day by hour: last night's sleep, steps, heart rate and your sessions on one timeline.
- Readiness says in one line why it is what it is; an optional Training load (Settings → Features) compares your last 7 days with your usual.
- Optional Health scores (Settings → Features) for sleep, activity and strength, each scored against published guidelines and naming its source, in Stats → Scores and as Home blocks.
- Steps shows what stands out: active minutes against 150 a week, your current streak and your usual busiest hour.
- Motus also saves total calories, speed, power, cadence, workout laps, temperature, blood pressure, blood sugar, body composition and nutrition from Health Connect, asking only for the new kinds in one prompt.
- Updating adds a few database changes on first start.

## [0.1.32] - 2026-11-15

- Motus saves every record from your watch or band with its time and source (each step count, heart rate reading, sleep stage and more), back as far as Health Connect holds. Daily steps, sleep, resting heart rate and an activity's steps and heart rate are worked out from them.
- Stats → Sleep shows each night: a timeline of your stages, when you fell asleep and woke, heart rate, blood oxygen and breathing through the night, how it compares with your usual and what you did before. Week, month and year show best and worst nights, sleep debt and sleep after workout days.
- A new Stats → Steps tab shows each day's steps by hour with your walks and workouts marked, and week, month and year summaries with your best and worst days and streaks.
- Stats → Heart shows each day: your heart rate through the day with workouts shaded on it, time in each zone, resting heart rate, HRV and blood oxygen. Set your own max heart rate in Body → About you.
- Sleep, Steps and Heart share one day picker and one look; the Calendar's and Home's tiles open them on the right day.
- One icon for each health value across the app.
- Updating adds a few database changes on first start, and the first sync after updating saves your band's past records, which can take a while.

## [0.1.31] - 2026-11-15

- The end of rest sound plays every time: with the app open, minimised, with the screen locked, on vibrate, and after Motus was swiped away. All rest sounds (10 seconds, 3-2-1, end) now play in every one of those cases, once each.
- A running workout's summary shows your band's heart rate, updating every minute (as fresh as Gadgetbridge's last sync). Finished workouts and activities get their heart rate from the very start too.
- The rest bar in a workout is much smaller: Pause sits above -15 and a fast-forward Skip rest above +15, next to the timer. When the rest is over the timer turns blue, +15 still adds time, and one button says Next set or Next exercise.
- A walk's notification counts steps from the first step instead of showing 0 until 50.
- Every note and reminder shows when it was written ("Sun 15 Nov · 14:05"), including Home's Reminders card.
- Tile values fit on phones: a distance keeps its number and unit on one line, volume and distance show the unit small, and the workout summary reads "3 exercises" with a space.

## [0.1.30] - 2026-11-15

- Nothing from your watch or band is skipped: every day's steps, sleep and other values are imported even when you typed your own, and every day shows in Imported data.
- The daily log shows each value with where it came from (your watch, typed, walks in Motus) and lets you choose which one the day uses; your other numbers stay, so you can switch back. A typed value stays in use until you choose otherwise.
- Imported data has a Deleted group: Restore brings a deleted import back on the next read.
- Updating adds a small database change on first start.

## [0.1.29] - 2026-11-15

- Daily steps match Gadgetbridge: Motus adds up your watch or band's own step records, as Gadgetbridge and Health Connect show them (Health Connect's own per-app total dropped some minutes). Past days are read again and corrected.
- Walks and other activities take your watch's steps whenever its step records reach past the activity on both sides; a stretch with no steps counts as 0, not as missing. The activity's ⋮ → Step sources shows each count and why the watch's was or wasn't used.
- Heart rate on every activity: Motus reads Health Connect right after you finish an activity or workout and keeps checking for half an hour, takes any heart rate your watch recorded in that time, and keeps filling it in for a few days as more arrives. The average shows in History, the Calendar, Home and Today.

## [0.1.28] - 2026-11-15

- Steps match your watch or band: Motus no longer mixes in your phone's own step counting from Health Connect. On a day a watch, band or ring counted, the day is that device's total (the number Gadgetbridge and Health Connect show), and a walk only takes steps the device counted. Past days and the last 30 days of walks are read again and corrected; values you typed stay. Imported data → ⋮ on a steps day → Step sources shows where a day's steps came from.
- Activities show only what their type tracks: a Time only activity shows its time, not distance, climb or pace, here and in lists, Stats and goals. What your watch or band measured during an activity (steps, distance, climb, floors, active calories, heart rate) shows on it, marked as from your device.
- Screens say which device the data came from: your watch, ring or band, or "Health Connect" for data from a phone app. Works with any device that writes to Health Connect.
- Settings → Integrations → Health Connect has "How often": read every minute, every 10 or 30 minutes, every hour, or only when you pull down to refresh, while Motus is open. Climb and floors can be allowed there too.
- Body is one page: trend, change, weigh-ins and a chart for any measurement, with a period picker. The Body tab in Stats is gone.
- A week, month or year still running is compared with the same stretch of the one before, so Home no longer says "-100%" on the first day of the week; Reports says which days it compares with.
- Backups and exports include your photos, a server account's backup and restore go to the server, older backups are brought up to date, and a backup from a newer version is refused instead of losing data.
- The shared workout image shows the real Motus icon.
- Band data imports on Android 9-13 phones too.
- Updating adds a small database change on first start.

## [0.1.27] - 2026-11-14

- Daily steps match your band and Health Connect: on days the phone also counted steps, Motus counted the phone's steps in the minutes between the band's and showed 1,000+ too many. It now takes the band's count wherever the band was on, and the phone's only while the band was off. After updating, the last 90 days are read again and corrected (a value you typed stays).
- The daily log shows where each value came from: grey "From your band" values, and a value you typed over the band's says "Typed in · Use band value" to bring the band's back. Sleep is typed in hours and minutes, and mood says which end is good.
- Band data on Android 9-13 phones imports again (the read failed there).
- The Readiness block shows while it learns your usual values, with how many days until your score.
- Home: Steps today shows progress toward your steps goal, and the Heart block shows resting heart rate, HRV, blood oxygen and today's range. The Calendar's month view has a steps bar under each day.
- Every screen counts sets and records the same way: working sets without warm-ups, and one record per exercise. An exercise counts as done once its working sets are, whatever its warm-ups.
- Sleep under 3 hours counts as a nap or partial record and is left out of sleep averages.
- Body and Stats → Body show the same trend and change, and trends only show once there are at least 3 entries over a week.
- Clearer wording everywhere: one name for the same thing on every screen (Resting heart rate, Estimated 1RM, Duration and Training time, Daily log, Heart rate in workouts...), sleep as "7h 48m", volume as "18k kg", and dot-separated lines that never start or end on a dot.
- Goals keep the name you give them; the automatic title shows under it.
- The Heart tab lists every workout with heart rate, and workouts from the last 30 days pick up band data that synced late.
- Fixes: a routine that no longer exists shows "Routine not found" instead of a blank page; the + button no longer covers cards on desktop; charts of things that can't be negative start at 0; Calendar's List view no longer signs you out; Imported data can be reached from Settings on any device; Reports never show the same numbers twice.
- Band data you delete stays deleted on every device, and an offline copy can no longer mix one account's routines into another.
- Updating adds a small database change on first start.

## [0.1.26] - 2026-11-14

- Home has four new blocks that appear once your band's data comes in: Readiness (a score from last night's sleep, resting heart rate and HRV against your usual), Last night (time asleep, bed and wake time, stages), Heart (resting heart rate, HRV and today's heart rate) and Steps today (steps, distance and active calories).
- During a workout or a recorded activity, the band's latest heart rate shows on the screen and in the bar at the bottom, read every minute (Gadgetbridge passes it on when it syncs with the band, so it can be a few minutes behind).
- Finished workouts show heart rate per exercise, routines show heart rate per session with a chart, and an exercise's history shows the heart rate of each session.
- The Calendar shows a day's sleep, resting heart rate and steps, and workouts list their average heart rate. Monthly reports and the year in review show sleep and heart rate. More has Sleep and Heart when there's data.
- New goal: average sleep per night.
- Health Connect also brings in body fat, water (into the daily log), VO2 max and your heart rate through the day.
- A finished workout's set rows keep the weight and reps on one line on phones; a set with several records shows one "N PRs" badge.
- Updating adds a small database change on first start.

## [0.1.25] - 2026-11-14

- Stats has a Sleep tab when your band sends sleep: last night with its stages (deep, light, REM, awake), heart rate, blood oxygen and breathing, averages for bedtime, wake time and time asleep, how regular your sleep is, short insights, and every night with its own detail.
- Stats has a Heart tab when there's heart data: resting heart rate, blood oxygen, HRV and the heart rate of your workouts and activities. These charts moved there from Body.
- Daily distance and active calories from your band show in Stats → Activities and in Imported data.
- On phones, pull down at the top of a page to sync: it reads Health Connect, syncs with your server and reloads the page.
- Health Connect: if Motus can read more than you allowed at first, Settings → Integrations shows "More to read" with an Allow button, and then reads the last 30 days. Change opens Health Connect's data and access screen; it did nothing before.
- Updating adds a small database change on first start.

## [0.1.24] - 2026-11-14

- Walks and other activities you record in Motus take your band's step count for exactly that time, when the band's data covers the whole activity (Health Connect). If the band was off or its count doesn't fit the phone's, the phone's count stays. A count you type yourself always stays.
- Heart rate from your band shows on activities and workouts: a graph over the session with the average and highest. Resting heart rate, blood oxygen and HRV come in too, with charts in Stats → Body. Each appears only when there's data for it.
- Import past data with "Everything" works: it no longer asks Health Connect for years with no data, which made the whole read fail.
- On phones the update notice sits at the bottom above the running-workout bar and the tabs, instead of as a tall column on the left.
- Integrations is under Your data in Settings.
- Updating adds a small database change on first start.

## [0.1.23] - 2026-11-14

- Health Connect: Settings → Integrations → Imported data lists everything Motus brought in from Health Connect, day by day: steps, sleep, weight and activities. Tap an entry to correct it, or delete it from its ⋮ menu. A corrected or deleted entry stays that way on later syncs, and so does one you deleted anywhere else in the app.
- Import past data reads further back than the first 30 days: the last 90 days, the last year or everything, on phones whose Health Connect allows reading older data (Motus asks for that permission when you choose it).
- Updating adds a small database change on first start.

## [0.1.22] - 2026-11-14

- Health Connect (Android app): switch it on in Settings → Features, then allow it in Settings → Integrations. Motus then reads daily steps, sleep, weight and workouts that other apps wrote to Health Connect, such as a band connected through Gadgetbridge (its Settings → External integrations → Health Connect). It reads when you open the app, at most every 15 minutes, or when you tap Sync now. Steps and sleep you typed in yourself stay as they are, each weight reading is added once, and each workout becomes an activity once, with its heart rate, distance, steps and calories. Gym sessions are left out, since those are logged in Motus.

## [0.1.21] - 2026-11-14

- Workout sounds come from one library of 12 short sounds, the same list everywhere: the Rest over sound, the Countdown sound and every part of the interval timer. Eight are clean recorded sounds (Hover, Step, Check, Ping, Checkpoint, Alert, Success, Level up) and four are the old single notes remade to match them (Round, Marimba, Bell, High). Each sound plays once, sounds the same wherever you pick it, and works as a countdown beep in the app and on Android in the background. Sounds you picked before switch to the closest new one. The rest over sound is now Success by default, and the interval timer starts work with Ping and ends with Level up.
- The 3-2-1 before a rest ends is three equal beeps in the app and on Android in the background, the interval timer's last-second ticks play whenever sounds are on, and the sound settings say when each sound plays.
- Pages open much faster the first time and earlier days on Home load at once: the copy of your data on the device no longer waits for the browser's storage after every read. A change counts as saved only once it is stored on the device, so closing the app right after saving loses nothing.
- Calendar: each day lists its workouts and activities in the order they happened, the header is just the title and the Calendar/List tabs at the same height as other pages, the month and its arrows sit in the middle, and the month's workouts, time, activities and active days are tiles at the bottom.
- Logging a past workout opens a popup like the other Log items, from Settings, the + button, a day in the calendar or "Log it" on a planned workout. Closing it with changes asks first. Pulling any popup down and then keeping it slides it back smoothly.
- Home no longer has the body weight block, and a half-width block left alone in its row fills the row.
- Settings → Activity types shows each type with its icon and what it tracks, edits it from the ⋮ menu, and adds types with a New activity type button.
- The Add exercise search bar has the popup's colour and covers its full width while the list scrolls.

## [0.1.20] - 2026-11-13

- Home shows only goals you created and pinned. The app no longer makes or pins goals by itself; the "Weekly target" and "Daily steps" goals it made before come off Home but stay in Goals. Every pinned goal is one wide block: the current value with the target under it on the left, its streak, days left or done date on the right, and its history as dots or a trend line. A device still on an older version can pin those goals back through sync until it updates.
- The Streak and Steps blocks are gone from Home, since pinned goals show the same. Today shows one clear state ("Nothing planned for today", or "Done for today" with today's sessions and "Nothing else planned for today" once plans are done), This week shows each stat as a tile with its change from last week, Muscles this week lists every group with when you last worked it, and Last workout fits its title, workout and day on one row.
- Suggested on Home also points out muscle groups no routine works, muscles with no exercise of their own and muscles you trained much less than the others, each with a + to start a new routine. The Home editor's switches fit every block.
- Goal rings and their check use your accent colours, gradient included. Correcting or deleting the entry that achieved a one-off goal reopens it, and achieved goals stay achieved after merging an exercise or removing a routine.
- Weeks start on the day chosen in Settings everywhere: calendar, Home, goals, streaks, schedules and Stats. Stats adds Today, This week, Last week, Last 7 days, This month and Last month, and "Last year" is now "Last 12 months".
- The exercise picker and the Exercises page can filter by tapping the body figure, with the muscle buttons in step. On phones the figure is large with wide tap areas, folds away behind a small figure next to the chevron, and the list scrolls into view after a pick.
- Stats: tap a muscle or Main / Helped / A little to highlight it, a learn button explains the 10-20 working sets target, chart dates no longer overlap, and every achievement has a progress bar. Reports label every month, and each month and the year get stat tiles with the change from before plus records, top routine and top muscle group.
- A step count you type for a day replaces the steps from recorded walks instead of being ignored when it is lower.
- The calendar names the month its totals cover, and the selected day is clearly visible and slides to the day you tap. The daily log's inputs line up and its 7-day table has column headings and fits on a phone. Filter blocks and notes use the normal card look, and tab rows scroll the open tab into view.
- The desktop and Android apps show a notice when an update is out, with Download update, View and close, and with automatic updates on it shows the download already running. It never shows during a workout.
- Updating adds a small database change on first start.

## [0.1.19] - 2026-11-13

- Workout sounds have their own section under Rest timer in Settings → Workout defaults (and in a workout's own settings). "Play sounds" turns every workout sound on or off. Below it: the 10-second warning and 3-2-1 switches, a Rest over sound and a Countdown sound to pick from twelve sounds (including Hand bell, Ship's bell, Tubular bell, Temple bell, Singing bowl and Deep gong, each with a play button), and a Sound level. The interval timer offers the same sounds under the same names.
- On Android, the 10-second warning and 3-2-1 play on time with the app in the background or the screen off, and Vibrate uses the phone's own vibration, so it works on phones that mute touch vibration. The desktop app keeps rest timers on time in the background. A cue whose moment has passed is skipped instead of beeping late when you come back.
- The recording notification on Android keeps counting steps and distance with the screen off and shows the time, the distance and steps for every activity.
- An activity's splits show pace per km or mile from moving time, with the fastest one highlighted, and the line under its title says "recorded with GPS" or "imported from a file". The map's enlarge button no longer shows over menus.
- Reminders look and work the same everywhere. In a workout, routine and exercise reminders both offer Done, Next time and Dismiss, and Next time now really keeps the reminder for your next workout. New notes and reminders on an exercise in a routine are for that routine by default.
- Routines made from a template follow your progression defaults, and the routine editor's progression choices show their default values.
- Every search box shares one design, and the magnifier stays sharp with the Glass look. With Glass, the workout's bottom controls are nearly solid on a phone.
- A finished workout opens its routine from the ⋮ menu. Set ranges like "1-3" stay on one line, and a few links got their missing space.
- Updating adds a small database change on first start.

## [0.1.18] - 2026-11-13

- Track by: any exercise can be tracked by reps, time, distance, distance and time, or reps and time, each with or without weight, from "Track by" in its ⋮ menu (exercise page, routine editor and workout). A plank with plates on your back is Time with Weight, a ruck is Distance + time with Weight, kettlebell swings in a minute are Reps + time with Weight. Switching converts the sets in your routines and the sets still to do in a running workout; sets already done stay as logged. Your own exercises use the same two choices. It replaces Timed sets and can be switched off in Settings → Features → Set tracking.
- Only reps with weight count toward lifted volume and one-rep max, so a weight left on an exercise that no longer tracks weight no longer shows up in totals or records. Sets with reps or distance and a time read "15 reps in 1:00" and "2.5 km in 12:00".
- Stretches rest 10 seconds between sets and 15 before the next exercise by default, set in Settings → Rest for stretches. Planks and other effort holds keep your normal rest, and any rest set on a routine, exercise or set still comes first. The Daily stretch template follows these defaults.
- In the routine editor, using an exercise's ⋮ menu (Track by, One side at a time) keeps that exercise open.
- Home: picking a past day shows the workouts and activities done that day and any missed plans. Planned items end with the same Start and ⋮ menu, can be skipped for a day or removed, and planned walks start recording with Start. Recent activity shows the same stats column as History, with steps for walks.
- Workout: finishing a set starts the rest and moves on at once, notes added during a workout scroll into view and can be edited, starting a workout no longer flashes "No workout in progress", and a running workout stays quick with a long history.
- Changing a rest in a workout offers to keep it in one wording, for any kind of set, and adding or deleting sets re-plans the rests.
- Workout countdown sounds (10 seconds, 3 2 1, rest over) are short bright beeps, clearly louder on phone speakers.
- Exercises can be filtered by category and to one side at a time when picking or browsing them.
- A new routine from a template or based on another is only saved when you press Save.
- Notes and reminders are spaced the same everywhere, and finished workouts let you edit notes too.
- Updating adds a small database change on first start. Backups made before this version import as before.

## [0.1.17] - 2026-11-11

- Tapping a tab while a page is still loading (for example right after opening the app) opens the new page straight away, and every tap after it keeps working. Before, the next page could take a while and a further tap might never open, until the app was restarted.
- Leaving a page no longer fades it out; the new page comes in at once and starts at the top.

## [0.1.16] - 2026-11-11

- Finish lists every change to a routine's sets, each with its own switch, all off: sets added or left out, sets made warm-ups, left and right sets, and sets done in another order. The routine's sets change only where you switch one on; weights and reps are saved either way, and Finish says so.
- Warm-up weights carry over to the routine like the other sets' numbers. They never decide when the weight goes up.
- Drop sets keep their own numbers when a routine's sets change, and doing the right side before the left no longer counts as a change.
- A left and right set with no rest between them are joined by a line wherever sets are listed: past workouts, the routine page, the routine editor, a workout and the Next time table.
- Linux desktop downloads include the .rpm again, and installed Linux apps get updates again.

## [0.1.15] - 2026-11-11

- Progression now holds the rep range. Settings → Workout defaults → Progression has the defaults: rep range (6-12), weight step for both-sides exercises (5 kg) and for one-side-at-a-time exercises (2.5 kg, or 10 lb and 5 lb), and how many missed workouts in a row before the weight goes down. Each exercise in a routine has a Progression row, after the timer between reps, to give it its own. The old Rep range and Progression menu items are gone.
- Double progression: when every set reaches the top of the range, next time goes back to the bottom with a heavier weight worked out from what you lifted (50 kg × 12 at 6-12 becomes 60 kg × 6). Below the top the weight stays and your reps become the target. Only missing the bottom of the range several workouts in a row lowers the weight. Existing routines keep their behaviour: a fixed 5 × 5 becomes its own 5-5 range.
- The Next time sheet after a workout shows each set as Planned, You did and Next, with a plain reason ("You did 12 reps on every set, the top of 6-12").
- A routine's page shows everything set in it, in one short line each: rest for every set type, timer between reps, progression in plain words ("aims for 6-12 reps · when every set reaches 12, adds 2.5 kg and goes back to 6 reps") and notes. Only what is on is shown, and the line under each exercise says sets and reps, as in the editor. The Workouts tab is now called History.
- Keeping a changed rest in a workout ("Use 3:30 for this exercise from now on") now saves it for future workouts, into the routine or the exercise, and confirms it in place.
- When a rest ends while the phone is locked or you are in another app, a Rest over alert nudges you. The desktop app shows a notice when its window is not in front.
- Drag to reorder in the Reorder routines, Reorder goals and a workout's Reorder exercises popups.
- A left and right set with no rest between them are joined by a line, and "Left and right" adds its sets as fast as "Set", also offline. The add buttons under an exercise are matching pills.
- A × sits between weight and reps in the set tables, empty values keep their box, and the workout table fits heavy weights on a phone.
- In the routine editor, tapping an exercise's card opens it, the exercise note says how it is saved, and sections are evenly spaced.
- The workout summary shows Records and Rep targets as two labelled tiles.
- The one-side-at-a-time icon shows an L and an R split by a slash.
- Updating adds a small database change on first start, and the Android app asks for permission to sound the rest alert on time.

## [0.1.14] - 2026-11-10

- Left and right sets: any exercise, in a routine or a workout, can mix normal sets with left and right sets (a set's ⋮ menu, or "Add a left + right set" in the exercise's ⋮ menu). "One side at a time" can be switched for any exercise, built-in ones included, and more one-sided exercises are recognised. A left and right set next to each other count as one round (3L, 3R) with no rest between the sides; weight is per side ("kg / side"); Previous and Progression compare left with left and right with right.
- Opening a routine shows every exercise's planned sets, weights, reps and rests, laid out like the routine editor.
- Routines in a folder can be reordered from the folder's ⋮ menu.
- Rest times follow changes during a workout: changing a set to a warm-up, drop or failure set, adding a drop set, or changing an exercise's rest updates the rest straight away, including a timer already running. Warm-up, drop and failure sets without their own rest use Settings' rest for that kind, or the between-sets rest, as Settings shows.
- The Summary tab keeps up with edits to finished sets, and edits made with a weak connection are no longer undone.
- The rest timer beeps 3, 2, 1 in its last seconds, and sounds start reliably on phones.
- In a workout: "Next" shows once, the Resting title is centred, tapping the workout name and time opens the Summary, and the offer to keep a changed rest says what it was planned at.
- Drop sets move with their main set when Progression changes its weight, and their reps start again at the bottom of the range.
- The Finish screen compares with the last time you actually did each exercise, so it no longer says "First time" after a workout where it was left empty.
- Resuming a paused workout no longer makes the session time drop back later.
- Home's Today card shows in full during a workout instead of a small dot.
- A page that fails to open after a tab tap recovers by itself, and missing files after an update reload the page.
- Note icons line up with their text, and clicking the app icon to change the look makes it wobble.
- Updating adds a few small database changes on first start.

## [0.1.13] - 2026-11-09

- Reps carry over: the reps you do inside a rep range become next time's starting reps (10 of 8-12 starts next time at 10), with the range kept as the goal. Before, only weight changes carried over.
- Progression raises the weight only when every set was ticked and all reached the top of the range; next time starts back at the bottom. A ticked set below the range counts as a miss, and unticked sets are left out instead of stopping Progression for the whole exercise.
- Each set is compared with the right one, so an unticked middle set or a drop set no longer mixes up the numbers.
- Finish shows the reps you actually did, never the range: "Set 1  20 kg × 8 → 20 kg × 10", and suggestions like "20 kg × 12 → 22.5 kg × 8".
- The routine editor shows where reps start ("3 × 8-12 · starts at 11"), and an exercise's ⋮ menu has "Start at the bottom of the range".
- Updating adds one small database change on first start.

## [0.1.12] - 2026-11-09

- Progression: a routine always has your current numbers. After each workout it takes what you did, and Progression decides whether the weight goes up or down next time: Suggest (asks you on Finish), Automatic or Off, with a weight step and "Lower the weight after" N missed workouts. Defaults are in Settings → Workout → Progression; any exercise can have its own. Exercises that had the old progression rules are now Automatic. "Start from what you did last time" is gone, as the routine is now always up to date.
- Finishing a workout: the time is shown big, with how it went against the plan and against last time. "Next time" is a short summary that opens every change set by set ("Set 2  20 kg × 8 → 22.5 kg × 8"); suggestions apply only when you switch them on.
- Routine changes on Finish list every way the workout differed from the routine (exercises added, removed, swapped, reordered, sets added, exercises skipped, sets not done), each with its own switch, all off: the routine only changes where you say so. A finished workout's "Update the routine from this" uses the same list.
- History: every version of a routine is kept, after each workout and each edit, with no limit. See the routine as it was on any date, restore it, and follow each exercise's weight over time.
- An active workout has a Summary tab after the last exercise, with a muscle figure, a sets ring and tiles.
- Planning: Today and Tomorrow pick the day, plans can repeat every week on that day or every month, and the plan popup is split into What, When and Time, with routine and activity side by side.
- Home's Today block lists all of today's plans; tapping a day in the week shows that day's plans, with a link to the calendar.
- Reminders: tap one to see its details, then dismiss or keep it.
- Every ⋮ menu is split into groups, and routines, programs and notes have the same menu wherever they appear.
- The workout settings popup is grouped like Settings → Workout, with the same wording.
- Workout time estimates count the time doing each set and changing exercises, and once a routine is done they show how long it usually takes you.
- The Exercises page keeps its search and filters when you open an exercise and come back.
- In a workout, the Previous column is off by default (Settings → Workout → "Show last time's numbers") and the bottom bar no longer shows last time's numbers.
- After finishing, the workout page no longer shows a puzzling Done button.
- Updating runs a few database changes on first start. Update every device: an older app can't sync plans that repeat monthly.

## [0.1.11] - 2026-11-08

- Download works everywhere: exports, backups, CSVs, and exporting a workout, a route or a routine save a file and say where it went. On the phone the file goes to Downloads; the desktop app asks where to save it; a failed save shows an error instead of nothing.
- You can always delete your own account. Alone on the server, it goes back to first-run setup; if the last admin leaves, the longest-standing person left becomes admin.
- A password can no longer be the same as the username, and the create-account form says which box is your name and which you sign in with.
- Backup passwords are hidden while you type them.

## [0.1.10] - 2026-11-08

- Steps on Android come only from the phone's own step counter, so wobbling or tapping the phone no longer adds steps; in the browser the count is a labelled estimate that ignores wobbles.
- Steps at the start of a walk, just before Pause or Finish, and while Android had closed the app are no longer lost.
- Steps from the last seconds of a pause don't count after Resume, and steps taken just before Pause still count when you tap Resume straight away.
- The GitHub page has screenshots, a feature overview and every way to install Motus.

## [0.1.9] - 2026-11-07

- New app icon: a dumbbell on an ocean-blue gradient, on the phone's home screen, the installed web app, the browser tab, the desktop app and the Android splash screen.
- Notifications show a dumbbell in the status bar instead of the graph.
- The logo inside the app is the same dumbbell in the theme and accent colours you choose.

## [0.1.8] - 2026-11-07

- Steps count from the first step and rise one at a time: in the Android app Motus also counts from the motion sensor while it is on screen (needed on phones whose step sensors hold steps back), and in the browser gentle steps are no longer missed.
- Routines with their folders, programs, workouts and everything else can be exported as one Motus file, choosing which parts, and imported into another account; importing into another account on the same server used to add nothing.
- On the computer, clicking a calendar day shows its list under the calendar like on the phone; the chosen day is marked, the list fades in, and a planned workout can be skipped and a past day logged from its ⋮ menus.
- Enlarging or shrinking an activity's map glides to its new size.
- Home: the Today block has a header and its Log it or Start button sits small beside the plan's name; Muscles this week shows even before your first workout; This week labels last week's numbers; the streak and steps blocks say which goal they need; Today's log links to "Other days"; Edit home's switches lose a stray line.
- On the computer, Settings sits at the bottom of the sidebar under Appearance and the account.
- Servers & accounts is reached from Settings only, no longer from the More tab.
- The local dev server reports the version it really runs after a version bump.
- Motus is licensed under PolyForm Noncommercial 1.0.0: free to use, change and share, not to make money from.

## [0.1.7] - 2026-11-06

- On the phone, every page fills the screen again; in 0.1.6 pages were squeezed into a thin strip on the left.

## [0.1.6] - 2026-11-06

- Home is rebuilt from scratch: a Today card with this week's days leads a board of blocks (streak, this week, steps, pinned goals, goals due soon, program, muscles this week, up next, last workout, records, body weight and more) that you can reorder and show or hide from ⋮ > Edit home, saved to your account.
- Steps and distance keep counting with the screen off in the Android app, and reloading mid-walk no longer loses or restarts the step count.
- Swiping away a recording's notification puts it straight back, so a walk always keeps its notification and Pause button.
- Downloading an app update shows a notification with its progress on Android (and progress on the taskbar on a computer); tapping it opens App & Versions, and a finished download stays ready to install after the app is closed.
- The update switches work: automatic checks, automatic downloads and Only on Wi-Fi. A downloaded update on a computer now installs only when you tap Install, not when you quit.
- Edit goal opens the same full form as New goal, filled in, and every option can be changed.
- An exercise's preview in the picker has a Select button and swipes (or arrows) through the exercises the list is showing.
- Popups on the phone keep their last rows above Android's navigation bar, and ⋮ menus near the bottom open upward.
- On an enlarged map the button's arrows point inward.

## [0.1.5] - 2026-11-05

- Routes are drawn in red, and a button on the map enlarges it to full width and nearly full screen height.
- A walk shows one notification instead of two, and that notification keeps the route recording with the screen off.
- Switching to another app and back no longer flashes Offline; it only shows when the server stays unreachable for a few seconds.
- Steps from recorded walks count toward the day's steps on Home, in step goals and in Stats; the steps box keeps what you typed and shows the steps from activities below it.
- Weekly targets count activities for people who log activities, not only gym workouts.
- A planned walk or other activity leaves the calendar and Up next once you record one of that type that day.
- The Appearance panel and the ⋮ menus keep the page behind them still, and on the phone pulling the panel down closes it.

## [0.1.4] - 2026-11-05

- Steps start counting within a step or two instead of after about twenty, in the Android app and the web app; distance, moving time, climb and steps covered while paused no longer count, and a new walk starts its steps from zero.
- Servers & accounts is easy to find (More tab and Settings): every saved server and on-device account in one list, with switch, add, rename and remove.
- Downloading an app update shows how far it is, as a percentage with a bar, and can't start twice.
- The update Channel choice, which never did anything, is gone.
- A raised routine card in an open folder is no longer cut off at the top.

## [0.1.3] - 2026-11-05

- The Android app's background now runs up behind the status bar and navigation bar, like Money Manager, in every look; pages, sheets and panels stay clear of the clock, the navigation bar and the keyboard.
- Check for updates always shows that it is checking and how it ended (up to date with the time, a new version and how to get it, or a plain error), in every app, and no longer hangs on a slow connection.
- The interval timer keeps one notification that changes with each round instead of adding a new one every round.
- Blocks whose rows reach the edges, like those on the More page, have even space at the top and bottom too.

## [0.1.2] - 2026-11-04

- Notifications in the Android app: a running workout, rest, activity or interval timer shows on the lock screen with Pause/Resume, Skip, +30s and Set done; the app asks once to turn notifications on, and Settings shows whether they are allowed.
- Steps count again on walks, runs, hikes and any activity type set to "on foot", with a plain reason when they can't; climb no longer jumps from GPS altitude noise.
- Interval timer: seven soft alarm sounds and a countdown notification.
- Times read compactly everywhere (10s, 1m 30s, 1h 5m).
- The Android status and navigation bars match the app's colours in every look.
- What's new has its own page in Settings.
- About you (year of birth, sex, height) is one tidy card on the Body page.
- Cards have even space on all sides, and the template list is spaced properly.
- Devices on an older app version keep syncing activity types.

## [0.1.1] - 2026-11-04

- Works offline on server accounts: a copy of your data on each device, synced both ways; the app opens from its own copy when the server is away.
- The Android and desktop apps can keep several servers and on-device accounts and switch between them (https only).
- Goals: more goal types, the weekly target as a goal you can set per activity, goals in your own order, a detail view with streaks and history, achievements.
- Home: choose which sections show and in what order; goal blocks highlight when reached.
- Interval timer (optional): work, rest, rounds and sets, presets, a sound per part, and a bar at the bottom while it runs.
- Routines and programs: plan a workout for any day (including every day, with no time), program pages, folders that slide open, the muscle figure on every routine, template and exercise card.
- Account page with signed-in devices; deleting an account needs your password; year of birth, sex and height in their own tab on the Body page.
- App & Versions page: your installed version, the right download for your device, and a suggestion to get the Android or desktop app.
- Many fixes and polish: popups no longer let the page scroll behind them, clearer reminders, calendar Today button, spacing, wording and new app icon.

## [0.1.0] - 2026-11-01

First version.

- Routines: create from scratch, from a template, from another routine or from a workout; edit, duplicate, folders, schedules, version history.
- Workouts: pre-start preview with time estimate and last session per exercise; the running workout with last time's numbers filled in, rest timer between sets and after exercises (adjustable live), skip, replace, notes, reminders; finish summary with records.
- History calendar and list, workout details with improvements, exercise pages with history, charts and records.
- Goals for workouts, routines, exercises, muscle groups, activities and the body; home summary; stats.
- Walks and other activities with GPS and GPX import; body weight and measurements.
- Backups to the device, export and import (including Strong, Hevy and FitNotes).
- Accounts with data kept apart per person; desktop and Android apps with local or server accounts and in-app updates.
- Money Manager's look with the full Appearance panel.
