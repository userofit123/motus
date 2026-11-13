# Changelog

The top entry's version is the one the release workflow publishes. Add a new `## [x.y.z]` section to release.

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
