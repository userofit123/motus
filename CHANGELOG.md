# Changelog

The top entry's version is the one the release workflow publishes. Add a new `## [x.y.z]` section to release.

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
