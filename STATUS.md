# Status

What is built, what is left, and what needs you. Updated 1 November 2026.

## Built

**Core (requirements 1–22)**
- Accounts and sign-in (first account becomes admin), invites, admin panel, signed-in devices, password change, account deletion.
- Data kept apart by PostgreSQL row-level security, checked by an automated test that tries to reach another person's data.
- Live updates: every change announces what it touched; all open screens on every device refresh (SSE).
- Exercise library: 876 exercises with instructions, muscles, equipment and photos (free-exercise-db, public domain); custom exercises with your own photos or a video link; favourites; merge.
- Routines: from scratch, from a template, from another routine, from a workout; edit, duplicate, folders, pin, archive, version history, schedules with reminders; rest between sets, after each exercise, per set and between reps.
- Start sheet: resume, today's plan, a routine, a new routine, an empty workout, an activity, a past workout.
- Pre-start preview: exercises, sets, reps, estimated time with rests, last time per exercise, reminders and pinned notes, skip or reorder for today, workout settings.
- Running workout: last time's numbers filled in, Previous column, rest timer (−30/−15/+15/+30, exact time, pause, skip, "use this rest for the exercise"), timed sets with 3-2-1, rep timer, skip / do later / skip remaining sets, replace exercise, add exercises and sets, notes button, reminders when an exercise comes up, offline queue, keep screen on.
- Finish: rating, notes, body weight, update the routine, one-tap "add weight next time" reminders.
- History calendar (month grid, phone dots) and list; workout detail with improvements vs last time, records, muscles, rest taken; edit, duplicate, save as routine, repeat, export, delete.
- Exercise page: about, history with position in each workout, charts, records, rep maxes, notes and reminders.
- Goals: general, routine, exercise, muscle group, activity, body; weekly/monthly/once; progress, pace, history.
- Home: this week, streak, time, condition (muscle map), up next, previous workout, goals; optional cards.
- Stats: overview, routines, exercises (most improved, stalled), muscles (weekly sets vs target, balance), activities, body.
- Walks and activities: GPS recording (screen-off recording in the Android app), manual entry, GPX/TCX import and export, splits.
- Body weight with a smoothed trend.
- Settings: units (metric/imperial and each unit), formats, workout defaults, features, appearance, notifications, backup, export/import, updates, admin, about.
- Backups to the device on a schedule (folder, Android Documents, desktop folder, or a download), optional password encryption, restore by merge or replace.
- Export JSON and CSV; import Motus files, Strong / Hevy / FitNotes CSV (with exercise matching), GPX/TCX.
- Offline use for server accounts (web app, desktop, Android): the app works on a copy of your data in the device's own database and syncs both ways when the server can be reached; the newest change to a row wins. Only signing in, the admin pages and uploading photos need the server.
- Look: Money Manager's theme engine and full Appearance panel; Ember dark by default; separate desktop and phone layouts.

**Apps and releases**
- Desktop app (Electron, Linux and Windows): local accounts with the server built in, server accounts, account switcher, backups to a folder, updates from GitHub.
- Android app (Capacitor): local accounts (database in the app) and server accounts, lock-screen rest timer, notifications, in-app updater (download, SHA-256 check, install), backups to Documents/Motus, planned-workout notifications.
- Release workflow: Docker image (GHCR, amd64 + arm64), desktop installers with auto-update files, signed APK with `android-latest.json`.

**Optional features (Settings → Features)**
Set types, RPE/RIR, supersets, plate calculator, warm-up sets, left/right sides, quick entry, voice cues, adaptive rest, progression rules,
programs with deload weeks, gym profiles, sharing routines, body measurements, progress photos, steps, sleep/water/mood, achievements,
monthly report and year in review, strength standards, share image, buttons on the rest notification, Health Connect (Android app: reads steps, sleep, weight and workouts, e.g. a band through Gadgetbridge), personal API tokens and GPX upload address, "Ask Claude" text copy, command palette.

## Planned (not built yet, hidden from Settings → Features)
- Health Connect: writing your workouts back (reading is built).
- Strava sync — needs a Strava API app (client id and secret).
- Wear OS app.
- Instant (web-bundle) updates without a new APK.
- Passkeys and OIDC sign-in.
- Push notifications in the browser for planned workouts (the Android app already has them).

## Needs you
- **Make the GitHub repository public** when you are ready: the apps check for updates through GitHub's public API, and Docker/apps download from the release.
  After the first release, check on GitHub that the `motus` package (ghcr.io) is public (package settings → visibility), so servers can pull it without signing in.
- **Cut a release**: `node scripts/bump.mjs x.y.z`, write the new CHANGELOG.md section, push to main. The Release workflow then creates the release `vx.y.z` with the signed `motus-x.y.z.apk`, `android-latest.json`, the Linux and Windows installers, and the server image.
- **Android signing key**: created outside the repository (the keystore and its password file) and stored as repository secrets. Keep a copy somewhere safe: every future update must be signed with it.
- **Dev account**: `demo` / `demo-password-1` (admin) exists in the dev database with test data. Create your own account or ask to reset the dev database.
