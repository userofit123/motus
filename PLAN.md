# Motus — Self-Hosted Fitness Tracker: Master Plan

> Status: **v2: decisions made** · 1 November 2026
> Companion documents: [RESEARCH.md](RESEARCH.md) (what other apps offer; **all suggestions accepted**, see §18)
>
> **The rule above all others: clean, calm, uncluttered.** Many features, few visible buttons.
> Read §10.0 before designing any screen.

This document turns every requirement you gave into a concrete design. Section 0 is a **traceability
matrix**: each of your requirements is listed with the section(s) that cover it, so you can check
nothing was dropped. Everything you wrote is treated as the required minimum. Additions that came
from research are **not** mixed in here. They are listed separately in RESEARCH.md for you to accept
or reject. The only exceptions are items that are needed for your requirements to work, such as an
offline queue for gym logging; those are marked *(enabler)*.

---

## Table of contents

0. [Requirements traceability](#0-requirements-traceability)
1. [Name, scope and terminology decisions](#1-name-scope-and-terminology-decisions)
2. [Platforms and architecture](#2-platforms-and-architecture)
3. [Tech stack](#3-tech-stack)
4. [Accounts, security and data isolation](#4-accounts-security-and-data-isolation)
5. [Live data model (everything updates everywhere)](#5-live-data-model)
6. [Data model (database schema)](#6-data-model)
7. [Exercise library](#7-exercise-library)
8. [Screens and features](#8-screens-and-features)
   - 8.1 Navigation · 8.2 Home · 8.3 Start workout · 8.4 Pre-start preview · 8.5 Active workout
   - 8.6 Rest timer system · 8.7 Remembering previous values · 8.8 Skip exercise · 8.9 Notes
   - 8.10 Reminders · 8.11 Finish and summary · 8.12 Workout detail · 8.13 Calendar
   - 8.14 Routines page · 8.15 Routine editor · 8.16 Exercise view · 8.17 Goals
   - 8.18 Stats · 8.19 Activities (walks and more) · 8.20 Settings
9. [Backup, restore, export and import](#9-backup-restore-export-and-import)
10. [Design system and appearance](#10-design-system-and-appearance)
11. [Desktop-first AND mobile-first UI](#11-desktop-first-and-mobile-first-ui)
12. [Self-updating apps and release pipeline](#12-self-updating-apps-and-release-pipeline)
13. [Self-hosting and deployment](#13-self-hosting-and-deployment)
14. [Testing and quality](#14-testing-and-quality)
15. [Delivery phases](#15-delivery-phases)
16. [Decisions log](#16-decisions-log)
17. [Lessons from simplefitnessapp](#17-lessons-from-simplefitnessapp)
18. [Accepted additions from research](#18-accepted-additions-from-research)

---

## 0. Requirements traceability

### Goals

| # | Your requirement | Covered in |
|---|---|---|
| G1 | Full desktop app and mobile app | §2, §11, §12 |
| G2 | Installable as an APK (Capacitor or best option) | §2.3, §12.3 |
| G3 | Live: data entered in one page updates every relevant area | §5 |
| G4 | Look at other workout trackers and offer what they offer | RESEARCH.md (suggestions to approve) |
| G5 | Remember previous workouts and auto-fill last amounts | §8.7 |
| G6 | Real desktop-first AND mobile-first design, not just responsive | §11 |
| G7 | Open-source exercise library with explanation, image/GIF, name | §7 |
| G8 | Analyse simplefitnessapp thoroughly | §17 and RESEARCH.md §1 |
| G9 | Self-updating: GitHub Actions builds releases; the app checks the version, auto-downloads and updates | §12 |
| G10 | Look: simple, clean, modern Material, inspired by Money Manager, including its atmosphere/appearance options | §10 |
| G11 | Extremely clean layout and organisation; none of the clutter and bloat of other fitness apps | §10.0 (applies to every screen) |
| G12 | Fully independent app (local account), plus the option to point an account at a server; both kinds side by side | §2.4 |
| G13 | Create the repository | §12.0 |
| G14 | Accept all research suggestions | §18 |

### Numbered requirements

| # | Your requirement | Covered in |
|---|---|---|
| 1 | Calendar of workouts; clicking a cell or workout opens it | §8.13 |
| 2 | Workout detail: what it was, duration, what was done, improvements, stats, everything | §8.12 |
| 3 | User accounts and logins for several people | §4 |
| 4 | Data must not leak | §4.3–4.5 |
| 5 | Create a new routine from scratch or based on an existing one | §8.15.1 |
| 6 | Fully edit, update and duplicate existing routines and workouts | §8.14, §8.15, §8.12.3 |
| 7 | Goals: general, per routine, per exercise, per muscle group, etc. | §8.17 |
| 8 | Goals page to track them all | §8.17.3 |
| 9 | Home page: summary, updates, current condition, goals, upcoming, previous workout, last workout date | §8.2 |
| 10 | Start-new-workout button: choose an existing routine or create a new one | §8.3 |
| 11 | Proper timer: between sets, between reps, longer breaks between exercises, custom per-exercise breaks set in the routine, override (longer or shorter) live | §8.6 |
| 12 | Skip an exercise during a workout | §8.8 |
| 13 | Page showing all routines | §8.14 |
| 14 | Decide: "routine" or "workout" | §1.3 |
| 15 | Full settings, including metric/imperial | §8.20 |
| 16 | Stats page: progress over time per workout/routine, muscle group, exercise | §8.18 |
| 17 | Pre-start preview: exercise/set/rep counts, estimated duration with breaks, exercise list, tap an exercise to see its history and last session, a general exercise view (what it is, how to do it, history, weights, position in the workout), and workout settings toggles | §8.4, §8.16 |
| 18 | General fitness, not just lifting: walks and more, well integrated; choose a fitting name | §1, §8.19 |
| 19 | Everything exportable and importable | §9.3, §9.4 |
| 20 | Backups to the user's device, configurable in a Backup & Restore page (on/off, frequency), plus general export/import | §9.1, §9.2 |
| 21 | Notes on every exercise, during and after a workout; a notes button in the active session to add to the routine or the exercise; notes shown when opening a routine or exercise | §8.9 |
| 22 | Reminders for a routine or exercise, e.g. "increase weight next time" on bench press, shown when that exercise next starts | §8.10 |
| — | Screenshot-style look and Money Manager atmosphere chooser | §10 |

---

## 1. Name, scope and terminology decisions

### 1.1 Product scope: a **fitness** app

You asked whether this is a workout, fitness or wellness app. Decision: **fitness app**.

- "Workout" is too narrow, because walks, runs, cycling and body weight are in scope.
- "Wellness" implies sleep, mood, nutrition and meditation, which are not in your requirements. The
  data model leaves room to add those later as further activity and metric types (§6.9). If you add
  them, a rename is cheap.

### 1.2 Name: **Motus** (decided)

*Motus* is Latin for "movement, motion". It is short and covers lifting, walking and anything else.
The name lives in one config constant.

### 1.3 Terminology (requirement 14)

The industry convention, used by Hevy and Strong and familiar to most users:

| Term | Meaning | Example |
|---|---|---|
| **Exercise** | A movement from the library | Bench Press (Barbell) |
| **Routine** | A saved, reusable **plan**: ordered exercises, target sets, reps, weights and rest times | "Chest Day" |
| **Workout** | One **performed session**: what you actually did on a date, usually started from a routine | "Chest Day, Sun 1 Nov, 58 min" |
| **Activity** | Any non-lifting session: walk, run, cycle, hike, swim, yoga, sport… | "Evening walk, 4.2 km" |
| **Session** | UI umbrella word for "workout or activity" in the calendar and history | — |
| **Set** | One effort: weight × reps, or time, or distance | 80 kg × 8 |
| **Folder** | A group of routines | "Push/Pull/Legs" |

Rule: you **edit a routine**, you **do a workout**. A workout keeps a **snapshot** of the routine as
it was when started, so editing a routine later never rewrites history (lesson from simplefitnessapp,
§17).

---

## 2. Platforms and architecture

### 2.1 Overview

```
                       ┌──────────── Motus Engine (packages/engine, TypeScript) ────────────┐
                       │ all business logic + API handlers + SQL migrations + live events   │
                       │ runs on PostgreSQL (server) or PGlite (Postgres in WASM, on device)│
                       └───────▲─────────────────────▲─────────────────────────▲───────────┘
                               │                     │                         │
      ┌────────────────────────┴───┐  ┌──────────────┴──────────────┐  ┌───────┴─────────────────────┐
      │ Self-hosted server (Docker)│  │ Desktop app (Electron)      │  │ Android app (Capacitor APK) │
      │ Engine + PostgreSQL 16     │  │ Local accounts: Engine +    │  │ Local accounts: Engine +    │
      │ multi-user, RLS, SSE,      │  │ PGlite in the main process  │  │ PGlite inside the app       │
      │ also serves the web/PWA    │  │ Server accounts: HTTPS to a │  │ Server accounts: HTTPS to a │
      │                            │  │ server                      │  │ server                      │
      └────────────────────────────┘  └─────────────────────────────┘  └─────────────────────────────┘
```

One frontend codebase produces two complete UIs, **desktop** and **phone** (§11), and runs in all
three shells. The UI never knows which kind of account it is talking to: it calls one API client, and
a **transport** routes each call either to the in-app engine (local account) or over HTTPS (server
account).

### 2.2 Server accounts work offline *(enabler)*

This applies to **server accounts**. Local accounts are always offline by nature. For server
accounts the server is the source of truth, but gyms often have poor signal, and losing a logged set
is unacceptable. So:

- **The active workout is local-first.** Every set, timer change, note and skip is written straight
  to the device: SQLite on Android, IndexedDB on web and desktop. Changes are then streamed to the
  server when it can be reached. If the app is killed mid-workout, it resumes exactly where you were.
- **All other edits** (routines, goals, settings) go through an **outbox**: they apply optimistically
  in the UI, are queued if offline, and are sent with a revision number. The server resolves
  conflicts: last writer wins per field, and a conflict toast appears for routines.
- **Reads** are cached (TanStack Query persisted cache plus a service worker), so history, routines
  and the exercise library are viewable offline.

Money Manager is "online-only with an offline read-only view". This is the main architectural upgrade
over it.

### 2.3 Android: Capacitor (decision)

Money Manager uses a hand-written Kotlin WebView shell. For Motus, **Capacitor 7/8** is the better
choice because the features need native plugins that already exist:

| Need | Plugin |
|---|---|
| Local accounts' database | **PGlite** (Postgres compiled to WASM) running the same engine in the app, persisted to the app's private storage. One SQL dialect everywhere, so no second database implementation |
| Rest-timer alerts when the phone is locked | `@capacitor/local-notifications` (exact alarms) + small custom plugin for an ongoing countdown notification (chronometer) |
| Keep screen awake during a workout | `@capacitor-community/keep-awake` |
| Local DB for the offline workout | `@capacitor-community/sqlite` |
| Walk GPS tracking in the background | `@capacitor-community/background-geolocation` (MIT) |
| Backups to the device | `@capacitor/filesystem` (+ Storage Access Framework folder picker) |
| Haptics/vibration | `@capacitor/haptics` |
| Steps/weight from the phone (optional) | `@capgo/capacitor-health` (Health Connect) |
| Self-update | custom ~100-line plugin: download APK → verify SHA-256 → install intent (§12.3) |
| Biometric app lock (optional) | `@capgo/capacitor-native-biometric` |

The Money Manager Android shell's biometric lock, NanoHTTPD proxy and server list can be ported as
ideas; Capacitor replaces the shell itself.

### 2.4 Local accounts and server accounts (decision)

Both apps, desktop and Android, are **fully independent**, as Money Manager is, and can also point
an account at a server. Each account on a device is one of two kinds, and **both kinds can live side
by side** on one device, with a quick account switcher:

| | **Local account** | **Server account** |
|---|---|---|
| App, screens, exercise library, images | On the device | On the device (bundled; never loaded from the server) |
| Database (your workouts, routines, goals…) | On the device (PGlite) | **On your server** (PostgreSQL), with an offline cache and outbox on the device (§2.2) |
| Your uploaded media (custom exercise photos, progress photos) | On the device | Stored on the server, cached on the device |
| Needs a network | Never | Only to sync |
| Other devices | No (use backups to move it) | Yes: phone, desktop and browser all see the same data live |
| Backups | Device backups (§9) are the safety net, so they are **on by default** | Device backups (§9) + server backups |

**How it looks to you:**
- First launch asks one question: **"Use Motus on this device"** or **"Connect to a server"**.
  You can add the other kind later from the account switcher.
- The account switcher (avatar, bottom of the desktop rail / top of the phone Home) lists accounts
  with a small "This device" or server-name label. Nothing else in the UI changes between kinds.
- **Moving a local account to a server:** restore its backup into a server account (§9.2, "Merge"),
  so the backup format doubles as the migration path.

**Isolation between accounts on one device:** each local account has its **own database file**, and
each server account has its own cache, outbox and token. They never share storage.

**Desktop: Electron (decision).** Electron is used, as in Money Manager, because you already run
electron-builder and electron-updater in production. Local accounts run the engine with PGlite in
the main process, exactly like Money Manager's "This computer" mode.

**Android:** local accounts run the engine with PGlite inside the app (§2.3).

### 2.5 Web / PWA

The same build is served by the server, for server accounts only. It is installable as a PWA, which
is **the iPhone option** (decided: no native iOS app).

---

## 3. Tech stack

| Layer | Choice | Why |
|---|---|---|
| UI framework | **Vue 3.5 + Vite** | Same as Money Manager, so its theme engine, components, phone kit and charts port directly |
| Language | **TypeScript** everywhere (decided), strict mode | Shared types across engine, server, apps and UI |
| State / data | **TanStack Vue Query** (cache, optimistic updates, offline persistence) + small Pinia-style stores for UI state | Gives per-entity caching and invalidation instead of Money Manager's whole-state reload, which won't scale to years of set history |
| Live updates | **SSE** `/api/events` per user (Money Manager pattern) with **typed events** | §5 |
| Charts | Port Money Manager's SVG `LineChart` and sparklines; add **uPlot** for dense history charts | Lightweight; matches the look |
| Muscle map | `body-highlighter` (MIT, framework-agnostic SVG) | Muscle heatmaps on exercise, workout and stats pages |
| Maps (walks) | **Leaflet** + OpenStreetMap tiles (tile URL configurable, self-hostable) | Route display and live tracking |
| Text | **English only** (decided). All UI text still lives in one `en.ts` strings file rather than inline, so wording stays consistent | |
| Engine | `packages/engine`: business logic, handlers, migrations; no HTTP inside. Used by the server, Electron and Android | §2.4 |
| Server | **Node 22**, Fastify wrapping the engine, `zod` validation | |
| DB | **PostgreSQL 16** with **Row-Level Security** on the server; **PGlite** for local accounts (desktop + Android) and tests | Same dual driver as Money Manager |
| Migrations | Numbered SQL files (Money Manager pattern) | |
| Query layer | Kysely (typed SQL builder, no heavy ORM) | Typed but close to SQL |
| Auth | scrypt/argon2id passwords, hashed session tokens in HttpOnly cookies (web) / bearer tokens (apps), optional TOTP | Port Money Manager `auth.js`, extended for multiple users |
| Media | Local disk volume (`/data/media`), optional S3-compatible | Exercise images and user uploads |
| Jobs | in-process scheduler (`node-cron`) | Backups, catalog sync, reminders |
| Push notifications | Web Push (Money Manager has `web-push`) + local notifications on Android | Scheduled-workout reminders |
| Tests | Vitest (unit), Node test runner/PGlite (API), Playwright (E2E desktop + phone viewports) | |
| Repo layout | pnpm monorepo: `apps/web`, `apps/server`, `apps/desktop`, `apps/android` (Capacitor), `packages/engine`, `packages/shared`, `packages/exercise-data`, `docs/`, `scripts/` | |

---

## 4. Accounts, security and data isolation

(requirements 3 and 4)

### 4.1 Accounts

Local accounts (§2.4) are protected by an optional app lock (PIN/biometric) and a separate database
file each. The rest of this section is about **server** accounts.

- **Roles:** `admin` and `user`. The first account created becomes admin (a setup wizard runs on first
  launch). Workout Tracker's well-known default password is a mistake; Motus has none.
- **Registration modes** (admin setting): closed (admin creates users), invite link/code (default),
  or open.
- **Login:** username/email + password. Optional TOTP 2FA. Passkeys are a later suggestion.
- **Session management:** Settings → Account lists every place the account is signed in: this
  device marked, each other one named from its browser and system ("Firefox on Linux", "Motus app on
  Android"), when it was last active and when it signed in, with "sign out" per device and "sign out
  the others". A line above the list says how many other devices are signed in. Local accounts have
  no such list.
- **Account page:** one page in Settings → You: initials, name, optional email, username and role,
  password (server accounts), sign out, sync status, signed-in devices and delete account. A local
  account shows name, email, sign out, and delete (which points to Accounts on this device).
- **Body facts:** year of birth, sex and height (all optional, height stored in cm) sit on the Body
  page, as one quiet card at the top of the Weight tab ("178 cm · 34 · Male") that opens a small
  sheet. Only sex (with the latest weight) is used, for the strength standards.
- **Account deletion:** deletes all of the user's data, after offering a final export.
- **Admin panel:** users (create, disable, reset password, delete), registration mode, exercise
  catalog sync, server backups, storage usage. **Admins cannot see other users' workout data in the
  UI** (privacy by default).

### 4.2 Device sign-in for the apps

- The Android and desktop apps hold an **account list**: local accounts plus server accounts (Money
  Manager's server list, extended). Each server account has a long-lived device token, stored in
  Android Keystore / OS keychain via Electron `safeStorage`.
- There can be several accounts of either kind per device, e.g. your local account, your server
  account and a partner's, with a quick account switcher. Each account's database, cache and offline
  queue are **separate files**, so nothing mixes.

### 4.3 Data isolation: defence in depth

1. **Every user-owned row has `user_id NOT NULL`** (FK to `users`, `ON DELETE CASCADE`).
2. **PostgreSQL Row-Level Security** on every user table:
   `USING (user_id = current_setting('app.user_id')::uuid)`. The API opens each request's
   transaction with `SET LOCAL app.user_id = …`. The app's DB role is **not** the table owner and has
   no `BYPASSRLS`, so even a buggy query cannot read another user's rows.
3. **Repository layer** adds `WHERE user_id = $me` too (belt and braces) and never accepts `user_id`
   from the client.
4. **IDs are UUIDv7**, so they cannot be enumerated.
5. **SSE channels are per user.** An event is only ever pushed to that user's connections.
6. **Media files** are served only through an authenticated route that checks ownership. Shared
   catalog media is public-read.
7. **Shared data** is only the global exercise catalog, which is read-only. Custom exercises are
   private to their creator. Sharing a routine with another user is an explicit copy (a later
   suggestion), never a live link.
8. **Backups and exports** are per user and optionally encrypted with the user's password (§9).
   Server-wide admin backups are encrypted at rest with a server key.
9. **Device caches** are wiped on sign-out (setting: "keep offline data on this device" on/off).

### 4.4 General security

- HTTPS expected behind a reverse proxy (Caddy example included). Secure, SameSite=Strict cookies;
  CSRF token for cookie auth.
- Rate-limited login with lockout backoff. Passwords hashed with argon2id or scrypt.
- `zod` validation on every endpoint; size limits on uploads; images re-encoded (strips EXIF/GPS
  metadata from photos).
- Strict CSP, no third-party scripts, self-hosted fonts.
- A Docker network layout like Money Manager's: DB on an internal-only network.

### 4.5 Isolation test suite (must pass before every release)

An automated suite creates users A and B and tries, as B, every endpoint with A's IDs
(read/update/delete/duplicate/export/media/SSE). Every attempt must return 404, and no row may
change. It also runs raw SQL as the app role with B's `app.user_id` and asserts zero visible A rows
on every table.

---

## 5. Live data model

(goal 3: entering data in one page updates every area it touches)

### 5.1 How it works

1. **One client cache** (TanStack Query) holds every entity by key: `workout:{id}`,
   `routine:{id}`, `exercise:{id}:history`, `stats:*`, `goals`, `home`, `calendar:{month}`…
2. **Every mutation is optimistic.** It updates the cache immediately, so all mounted components that
   read that data re-render at once on this device.
3. The server commits, then publishes a **typed event** on the user's SSE channel:
   `{type:"workout.set.updated", ids:{workout, exercise}, rev}`.
4. Each client, including other devices and other tabs, maps the event to the cache keys it affects
   and refetches only those. Example: logging a set invalidates the workout, that exercise's history
   and PRs, the stats for that exercise and muscle group, the goals that track it, the home summary
   and the calendar day.
5. A **dependency map** in `packages/shared/live-deps.ts` defines which events touch which keys.
   It is one file with unit tests, so "it didn't update over there" bugs are fixed in one place.
6. Fallback: if SSE drops, the client reconnects with backoff and polls `/api/rev` every 60 s. On
   reconnect it fetches changes since its last `rev`.

### 5.2 Examples you will notice

- Finish a workout on the phone, and the desktop calendar, home page, stats and goals update within
  about 1 s without a refresh.
- Edit a past workout's weight, and the exercise PRs, e1RM chart, goal progress and "previous values"
  for the next session all recompute.
- Add a note mid-workout, and it appears on the exercise page and routine page, even if they are open
  on another device.
- Complete a goal, and you get a celebration toast plus updated home and goals cards.

---

## 6. Data model

PostgreSQL. Every table has `id uuid (v7)`, `user_id` where user-owned, `created_at`, `updated_at`,
`deleted_at` (soft delete for undo and sync), and `rev bigint`. Weights are stored canonically in
**kg** and distances in **metres**; the display unit is a user setting, so conversion is lossless and
switching units never corrupts data (a simplefitnessapp bug).

### 6.1 Users and settings
- `users(id, username, email, password_hash, role, totp_secret_enc, display_name, avatar_media_id, birth_date, sex, height_cm, locale, created_at, disabled_at)`
- `sessions(id, user_id, token_hash, device_name, platform, last_seen_at, expires_at)`
- `user_settings(user_id PK, data jsonb, updated_at)`: units, workout defaults, timer defaults, notifications, backup config, appearance (synced like Money Manager `/api/prefs`).

### 6.2 Exercise catalog
- `exercises(id, owner_user_id NULL=global, source ['free-exercise-db'|'wger'|'custom'], source_id, name, aliases text[], category, mechanic, force, level, equipment_id, tracking_type, is_unilateral, instructions text[], description_md, default_rest_s, archived)`
  - `tracking_type`: `weight_reps | bodyweight_reps | weighted_bodyweight | assisted_bodyweight | reps_only | duration | distance_duration | weight_duration | distance_weight`
- `exercise_muscles(exercise_id, muscle_id, role ['primary'|'secondary'])`
- `muscles(id, slug, name, group_id)` and `muscle_groups(id, slug, name)`: chest, back, shoulders, biceps, triceps, forearms, core, glutes, quads, hamstrings, calves, adductors, abductors, neck, cardio.
- `equipment(id, slug, name)`
- `exercise_media(id, exercise_id, kind ['image'|'gif'|'video'|'svg'|'youtube'], path_or_url, position, license, author, source)`
- `exercise_user_prefs(user_id, exercise_id, default_rest_s, default_rest_after_s, favourite, hidden, bar_weight_kg, increment_kg)`: per-user overrides of library exercises.

### 6.3 Routines (plans)
- `routine_folders(id, user_id, name, position, color)`
- `routines(id, user_id, folder_id, name, description, color, icon, based_on_routine_id, position, pinned, archived, est_duration_s cached, last_performed_at cached, times_performed cached, settings jsonb)`
  - `settings`: overrides of workout defaults (§8.4.3)
- `routine_exercises(id, routine_id, exercise_id, position, superset_group, rest_between_sets_s, rest_after_exercise_s, rest_between_reps_s, prefill_mode ['last'|'target'], notes_pinned_text, warmup_enabled)`
- `routine_sets(id, routine_exercise_id, position, set_type ['warmup'|'normal'|'drop'|'failure'], target_reps, target_reps_max, target_weight_kg, target_duration_s, target_distance_m, target_rpe, rest_after_s NULL)`
  - `rest_after_s` is a per-set override

### 6.4 Workouts (performed sessions)
- `workouts(id, user_id, routine_id NULL, routine_snapshot jsonb, name, status ['in_progress'|'completed'|'discarded'], started_at, ended_at, active_duration_s, paused_s, total_rest_s, notes, rating 1–5, perceived_difficulty, bodyweight_kg, location_text, settings_used jsonb, source ['app'|'manual'|'import'], client_id)`
  - `client_id` is for idempotent offline sync
- `workout_exercises(id, workout_id, exercise_id, routine_exercise_id NULL, position, status ['pending'|'active'|'done'|'skipped'|'partial'], skip_reason, superset_group, started_at, ended_at, rest_between_sets_s, rest_after_exercise_s)`
  - `position` is where it was in **this** workout, which powers "exercise #3 of 6" in history
- `workout_sets(id, workout_exercise_id, position, set_type, weight_kg, reps, duration_s, distance_m, rpe, rir, completed bool, completed_at, rest_planned_s, rest_actual_s, prefilled_from_set_id, e1rm_kg cached, is_pr_flags int)`
- `personal_records(id, user_id, exercise_id, kind ['max_weight'|'e1rm'|'max_reps_at_weight'|'max_volume_set'|'max_session_volume'|'longest_duration'|'longest_distance'], value, workout_set_id, achieved_at, superseded_at)`

### 6.5 Scheduling
- `schedules(id, user_id, routine_id or activity_type, rule ['once'|'weekly_days'|'every_n_days'], days_of_week, interval_days, start_date, end_date, time_of_day, remind_before_min, active)`
- `schedule_exceptions(schedule_id, date, kind ['skipped'|'moved'], moved_to)`
- Upcoming occurrences are **computed, not pre-generated**, which avoids simplefitnessapp's
  "deleted occurrences come back" bug. A workout started on a scheduled day links back through
  `schedule_id` + `scheduled_date`.

### 6.6 Notes (requirement 21)
- `notes(id, user_id, target_type ['exercise'|'routine'|'routine_exercise'|'workout'|'workout_exercise'|'activity'], target_id, body, tags text[], difficulty 1–5 NULL, pinned bool, created_in_workout_id NULL)`
  - tag examples: "too easy", "change", "good fit", "pain"
  - `created_in_workout_id` records where the note was written

### 6.7 Reminders (requirement 22)
- `reminders(id, user_id, target_type ['exercise'|'routine'|'routine_exercise'], target_id, scope_routine_id NULL, body, trigger ['next_start'|'every_start'|'on_date'|'after_n_sessions'], trigger_date, trigger_n, status ['pending'|'shown'|'done'|'dismissed'], created_in_workout_id, shown_in_workout_id, action jsonb NULL)`
  - `scope_routine_id`: only when the exercise is done inside this routine
  - `action`: optional machine action, e.g. `{"increase_weight_kg":2.5}`

### 6.8 Goals (requirement 7)
- `goals(id, user_id, scope ['general'|'routine'|'exercise'|'muscle_group'|'activity_type'|'body'], scope_id, metric, comparator ['>='|'<='|'='], target_value, unit, period ['once'|'per_week'|'per_month'|'streak'], start_date, deadline, status ['active'|'achieved'|'failed'|'archived'], achieved_at, notes)`
- `goal_snapshots(goal_id, date, value)`: written by a daily job and on relevant events, for progress charts.

### 6.9 Activities and body (requirement 18)
- `activity_types(id, slug, name, icon, has_distance, has_gps, met_value)`: walk, run, hike, cycle, swim, yoga, stretching, sport, elliptical, rowing, other. User-extendable.
- `activities(id, user_id, type_id, started_at, ended_at, duration_s, moving_time_s, distance_m, steps, elevation_gain_m, avg_hr, max_hr, calories, route_geojson / gpx_media_id, notes, source ['gps'|'manual'|'import_gpx'|'health_connect'], client_id)`
- `activity_points(activity_id, t, lat, lon, alt, accuracy, speed)`: raw GPS, compressed after finishing.
- `body_metrics(id, user_id, measured_at, kind ['weight'|'body_fat'|'waist'|'chest'|'arm'|'thigh'|…], value, unit_canonical)`
- `daily_steps(user_id, date, steps, source)` (if Health Connect is accepted)

### 6.10 System
- `events(id, user_id, type, payload, rev)`: the live feed and audit/undo log.
- `backup_runs(id, user_id, device_id, at, size, status)`: an informational record of device backups.
- `app_meta(key, value)`: schema version, API level.

---

## 7. Exercise library

(goal 7)

### 7.1 Sources, chosen after a licensing check (details in RESEARCH.md §3)

| Source | Role | License | Ship it? |
|---|---|---|---|
| **free-exercise-db** (yuhonas) | **Bundled seed**: ~870 exercises with name, instructions (step list), primary/secondary muscles, equipment, level, category, 2 photos each (start/end position) | Unlicense (public domain) | **Yes**, bundled in the server image |
| **wger** | **Optional sync** (admin button / weekly): more exercises, translations (incl. some Hebrew/German), descriptions, images | CC-BY-SA per entry; attribution shown on the exercise page | Yes, as an optional layer |
| **User custom exercises** | Create your own, with your own photos/GIF/video upload or YouTube link | User's own | Yes |
| ExerciseDB GIFs, MuscleWiki, workout.cool videos | — | Unclear or proprietary media licenses | **No**: not bundled, to avoid legal trouble |

### 7.2 Animated demos

free-exercise-db has two photos per exercise, start and end. The exercise page shows them as a
**smooth crossfade loop** (start ↔ end), which works like a GIF without any licensing risk. Where wger
or users supply a GIF or video, that is shown instead.

### 7.3 Library features (the minimum)

- Search (fuzzy, aliases such as "bench" → Bench Press), filter by muscle group, equipment and
  category, and sort by name, most used or recently used.
- Every exercise shows its name, media, instructions, muscles (on a muscle-map figure) and equipment.
- Custom exercise editor: name, tracking type, muscles, equipment, instructions, media, default rest.
- Edit a library exercise for yourself only (stored as per-user overrides; the catalog itself stays
  untouched).
- Merge duplicates (re-points all history to one exercise).
- Each record stores license, author and source; the sync never overwrites user edits.

---

## 8. Screens and features

### 8.1 Navigation

Kept deliberately short (§10.0). Workouts and activities share **one History page** (calendar + list)
instead of three separate pages.

**Desktop**: left rail like Money Manager's (full or mini), with a gliding active pill. **7 items:**

> Home · History · Routines · Exercises · Goals · Stats · Settings
> Footer: account switcher · sync status (server accounts only) · update (only when one exists) · Appearance

**Phone**: bottom tab bar, **5 slots**, with a centre **Start** button:

> Home · History · **[ + Start ]** · Routines · More (Exercises, Goals, Stats, Settings)

While a workout is in progress, a **persistent mini bar** sits on every page (above the tab bar on
the phone, top of content on desktop). It shows the routine name, elapsed time, the current rest
countdown and a "Return" button.

### 8.2 Home page (requirement 9)

Laid out like the screenshot: stat cards with sparklines on top, then a few calm sections with
"All →" links. Home answers four questions at a glance (how am I doing, what's next, what did I do
last, how are my goals) and **nothing else by default**.

**Default content:**
1. **Title + date + one status line**: "Last workout: Chest Day · 2 days ago".
2. **Four stat cards** (sparkline + ⓘ tooltip each), like the screenshot's top row:
   - **This week**: workouts done / weekly goal.
   - **Streak**: weeks in a row meeting your goal.
   - **Time this week**: training + activities, vs. last week.
   - **Condition**: a small muscle-map figure (sets per muscle, last 7 days) with a one-line summary
     such as "Legs rested 9 days".
3. **Resume workout**: only appears while one is in progress.
4. **Up next**: today's and the next scheduled routine, with one Start button.
5. **Previous workout**: one card (name, date, duration, volume, PRs) → workout detail.
6. **Goals**: the top 3 active goals with progress bars → Goals page.
7. **Start button**: desktop bottom-right FAB like the screenshot; phone centre tab.

**Optional cards**, off by default and added via "Customise home" at the bottom of the page:
volume this week, walking/steps, body weight trend, recent PRs, pending reminders, recent activity
feed, weekly sets per muscle, achievements. Cards can be reordered and removed. Removing everything
optional still leaves a complete Home.

Phone version: the same content as one scrolling column; the four stat cards become a 2×2 grid. It is
a separately designed layout, not a squashed desktop one.

### 8.3 Start workout (requirement 10)

The **Start** button (FAB / centre tab / keyboard shortcut `N` on desktop) opens a sheet:

1. **Resume in-progress workout** (if any).
2. **Today's scheduled routine(s)** (if any).
3. **Start from a routine**: pinned routines and recently used first, with search and folder list.
   Picking one opens the **pre-start preview** (§8.4).
4. **Create a new routine**: opens the routine editor, then "Save & start" or "Save".
5. **Empty workout**: start blank and add exercises as you go (you can save it as a routine at the
   end).
6. **Log an activity**: walk/run/… (start GPS tracking or enter manually).
7. **Log a past workout**: manual entry with a date and time picker.

### 8.4 Pre-start preview (requirement 17)

The screen shown after choosing a routine, before pressing **Start**.

#### 8.4.1 Header summary
- Routine name, folder, description, last performed ("6 days ago") and times performed.
- Counts: **exercises**, **total sets** (working + warm-up shown separately), **total target reps**.
- **Estimated duration** including rests, e.g. "≈ 62 min (sets 24 min · rest 38 min)". The formula:
  - for each set: estimated set time + its rest; for each exercise: rest-after-exercise.
  - The set-time estimate comes from **your own history** (median seconds per set for that exercise),
    otherwise from defaults (≈ 3 s per rep + 10 s setup, or the target duration for timed sets).
  - It updates live when you change settings or skip exercises in the preview.
- Muscle map of what this routine trains.
- **Pending reminders** for this routine and its exercises, shown up front.
- **Pinned notes** for the routine.

#### 8.4.2 Exercise list
Each row shows: thumbnail, name, sets × reps @ weight (pre-filled values as they will be used), rest
settings, and "**Last time:** 80 kg × 8, 8, 7 · 6 days ago". Optional pre-start edits, which apply to
this workout only unless you tick "also update routine":
- reorder, remove or skip, swap exercise, add an exercise, change sets.

**Tapping an exercise opens the Exercise View** (§8.16) as a sheet (phone) or side panel (desktop),
on its History tab, showing the last session in full.

#### 8.4.3 Workout settings (toggles, behind one "Workout settings" row)

The preview shows a single row, "Workout settings · Default", that opens a sheet. The sheet lists
**only the toggles for features you have turned on** (§10.0). Each toggle shows the routine default
with a per-workout override. "Save as routine default" and "Save as global default" sit at the bottom
of the sheet.

| Setting | Default |
|---|---|
| Pre-fill from last workout (vs. routine targets) | On |
| Auto-start rest timer when a set is ticked | On |
| Rest between sets / after exercise defaults (if the routine has none) | 90 s / 150 s |
| Countdown before timed sets (3-2-1) | On |
| Sound at rest end | On |
| Vibration at rest end | On |
| Warning at 10 s left | On |
| Voice cues ("Next: Dumbbell Press, set 1") | Off |
| Keep screen awake | On |
| Lock-screen / notification timer controls | On |
| Show warm-up sets | On |
| Auto-advance to next exercise when sets are done | On |
| Show previous-values column | On |
| Show reminders and pinned notes when an exercise starts | On |
| Confirm before skipping an exercise | Off |
| Track RPE | Off |
| Plate calculator button | On |

### 8.5 Active workout screen

#### 8.5.1 Phone (one-hand design)
- **Top bar:** routine name, elapsed time (tap to pause the workout), ⋮ menu (notes, add exercise,
  reorder, settings, discard, finish).
- **Exercise pager:** one exercise per card. Swipe left and right between exercises. A progress dots
  strip shows done / current / skipped / pending.
- **Exercise card:**
  - name (tap → Exercise View), thumbnail and muscle chips
  - **reminder banner** if one applies (§8.10) and **pinned notes**
  - **sets table**: `# | Previous | kg | Reps | ✓`
    - The values are pre-filled (§8.7) and edited with large steppers (−/+ by plate increment) or a
      numeric keypad sheet.
    - Swipe a set to delete it; long-press for its type (warm-up/drop/failure).
  - "+ Add set", "Notes", "Skip exercise" and "Replace exercise" actions.
- **Ticking a set** records it, then starts the rest timer (§8.6), haptic tick.
- **Rest timer sheet** slides up from the bottom (it does not block the set table): a big countdown
  ring with **−15 · −30 / +15 · +30**, tap the number to type an exact time, **Pause**, **Skip**.
  It also shows "Next: set 3 · 80 kg × 8".
- **Notes button** (always visible floating chip): a sheet with three targets (§8.9).
- **Finish** button appears in the top bar once ≥1 set is done; finishing with unticked sets asks
  "Mark remaining as skipped / Finish anyway / Keep going".

#### 8.5.2 Desktop (three panes)
- **Left:** exercise list (drag to reorder, status icons, superset brackets, skip/restore).
- **Centre:** current exercise: big sets table with keyboard entry (Tab/Enter through
  weight → reps → ✓; `Space` ticks the set, `S` skips, `R` starts/stops rest), media loop,
  instructions toggle.
- **Right:** rest timer (large), elapsed time, live stats (sets done, volume, est. remaining time),
  notes panel, reminders.

#### 8.5.3 Robustness
- Every action is saved locally instantly and synced (§2.2). Kill the app or reboot the phone, and the
  workout resumes exactly where it was.
- All timers are based on **end timestamps** (not counting intervals), so they stay correct after
  backgrounding or sleep.
- The workout can be continued from another device: start on the phone, view it live on the desktop.

### 8.6 Rest timer system (requirement 11)

#### 8.6.1 Timer types
1. **Rest between sets**: after ticking a set.
2. **Rest after exercise**: the longer break before the next exercise (configured per exercise in the
   routine).
3. **Rest between reps**: for cluster/rest-pause or timed-rep work, e.g. "10 reps, 15 s between each
   rep". It is an optional per-exercise interval timer that beeps each rep window.
4. **Timed set timer**: counts down a plank/hang/carry set with a 3-2-1 lead-in, and auto-ticks the
   set when it ends.
5. **Workout elapsed timer** (pausable) and **per-exercise elapsed time** (recorded for stats).

#### 8.6.2 Configuring custom breaks (when creating a routine)

Most specific wins:

```
set-level override  >  routine exercise (between sets / after exercise / between reps)
                    >  your per-exercise default  >  routine default  >  global default (Settings)
```

- In the routine editor every exercise shows two rest chips: "Between sets 1:30" and "After exercise
  2:30". Tap a chip to edit it with a picker (presets 0:30, 0:45, 1:00, 1:30, 2:00, 3:00, 5:00 plus a
  custom value).
- Any individual set can have its own rest (e.g. 3:00 after the heavy top set, 1:00 after back-off
  sets).
- Supersets: there is no rest between the exercises within a round; the rest comes after the round.
- Rest can be **0** (go straight on).

#### 8.6.3 Live override during a workout
- ±15 s / ±30 s buttons, a type-exact-value field, pause/resume, skip, and **restart**.
- A "**Make this the new default**" option after changing it: for this set onward, this exercise in
  this routine, or this exercise everywhere.
- The **actual** rest taken is recorded per set (`rest_actual_s`), for stats ("average rest" and
  "rest vs. planned").

#### 8.6.4 Alerts
- Sound (choice of sounds, volume), vibration pattern, optional warning at 10 s left, optional voice.
- Android: an exact-alarm local notification fires when the rest ends, even when the phone is
  locked. An **ongoing notification** shows a live countdown with **+15 / Skip** actions while a
  workout is active.
- Desktop/web: a system notification, plus the countdown in the window/tab title ("1:12 · Bench").

### 8.7 Remembering previous values (goal 5)

This is the heart of the tracker.

**Pre-fill rule** for each exercise × set position when a workout starts or an exercise is added:

1. Find the **most recent completed workout by date** (not by insert order, another simplefitnessapp
   bug) that contains this exercise.
   - Preference order: same routine → any routine → none.
   - A routine-exercise setting chooses between "same routine only" and "anywhere".
2. Set *n* is pre-filled from that session's set *n* of the same set type. Warm-ups map to warm-ups,
   working sets to working sets. If today has more sets than last time, the extra ones copy the last
   working set.
3. If there is no history, use the routine targets. If there are no targets, leave it empty.
4. A routine-exercise toggle switches to **"targets"** pre-fill, e.g. when you follow a fixed plan.
5. Pending **reminder actions** apply on top. For example, "increase weight 2.5 kg" adjusts the
   pre-filled weight, and that weight is highlighted with a ↑ badge.

**Display:**
- The "Previous" column shows exactly what you did last time for that set (e.g. "80×8"). Tapping it
  copies the value.
- Pre-filled values look slightly dimmed until confirmed or edited, so you can see what is real
  versus suggested.
- Beat last time, and you get an inline "+2.5 kg" / "+1 rep" chip. Set a record, and you get a PR
  badge (if PR detection is accepted).

**At finish:** "Update routine with today's values?" offers three choices: update targets, keep
targets, or ask every time (setting).

### 8.8 Skip exercise (requirement 12)

- The **Skip** action on an exercise prompts for an optional reason chip: equipment busy, pain/injury,
  out of time, don't feel like it, or other.
- Skip options:
  - **Skip** (status `skipped`)
  - **Do later** (moves it to the end of the queue)
  - **Skip remaining sets** (status `partial`)
- A skipped exercise can be restored at any time before finishing.
- Skips are excluded from volume and estimates but shown in the workout detail (crossed out with the
  reason), and counted in stats ("most skipped exercises").
- Individual sets can be skipped and deleted as well.
- The pre-start preview can mark exercises as skipped before starting.

### 8.9 Notes (requirement 21)

**Where notes live:**

| Note on | Written from | Shown on |
|---|---|---|
| Exercise (general, everywhere) | Active workout, exercise view, after the workout | Exercise view (Notes tab), active workout (pinned ones), pre-start preview |
| Routine | Active workout, routine page, after the workout | Routine page, pre-start preview |
| Exercise within a routine | Active workout, routine editor | Routine editor, active workout when that exercise starts |
| This workout | Active workout, finish screen, workout detail | Workout detail, calendar preview |
| This exercise in this workout | Active workout, workout detail | Workout detail, exercise history entry |

**Notes button during an active session:** opens a sheet with a target selector:

> ◉ This exercise (Bench Press) — always ○ Bench Press in this routine only ○ This routine ○ Just this workout

- Each note has text, optional **difficulty rating** (1–5: too easy … too hard) and quick tags
  ("too easy", "too hard", "change next time", "good exercise for me", "pain", "form"). It can be
  **pinned** so it shows every time.
- Notes record the workout they were written in ("written during Chest Day, 1 Nov"), so you can jump
  back.
- After a workout, the notes are editable in the workout detail and exercise view.
- The exercise view and routine page have a **Notes** tab listing all notes, newest first,
  filterable by tag.

### 8.10 Reminders (requirement 22)

**Creating one:**
- From the active workout: on an exercise ⋮ → "Remind me next time…"; from the finish screen; from
  the exercise view; from the routine page.
- Fields:
  - **Target:** exercise (anywhere) / exercise in this routine / routine.
  - **Text:** "Increase weight to 82.5", "Try a narrower grip".
  - **When:**
    - **next time it starts** (default)
    - every time
    - after N sessions
    - on/after a date
  - **Optional action:** adjust weight +x, adjust reps +x, change rest. The action is applied to the
    pre-filled values when the reminder fires (§8.7).
- Quick presets on the finish screen: for each exercise where you hit all target reps, a one-tap
  "Remind: increase weight next time" button.

**Showing it:**
- A routine reminder appears on the pre-start preview and as a banner on workout start.
- An exercise reminder appears as a highlighted banner at the top of the exercise card **when that
  exercise starts** (it becomes active / you swipe to it). It also shows a badge in the preview list.
- Actions on the banner: **Done** (marks complete), **Snooze to next time**, **Dismiss**.
- Reminders not marked done stay visible and keep a history (on the exercise view's Notes &
  Reminders tab).

**Separate: scheduled workout notifications.** These push notifications ("Leg day today at 18:00")
come from schedules (§6.5) and are configured in Settings → Notifications.

### 8.11 Finish and summary

- Summary: duration, active vs. rest time, exercises done/skipped, sets, reps, volume, PRs,
  comparison vs. the last time this routine was done (Δ volume, Δ duration, per-exercise
  better/same/worse), muscle map.
- Inputs: workout rating (1–5), how it felt, notes, body weight (optional), and editing the name,
  start and end times.
- Prompts: update routine values? (§8.7), reminders presets (§8.10), save as a new routine (for
  empty workouts).
- Then it opens the **Workout detail**.

### 8.12 Workout detail (requirement 2)

#### 8.12.1 Contents
- Header: name, routine link, date, start–end, **total duration**, active time, rest time, rating,
  notes, body weight.
- Stat tiles: exercises, sets, reps, **volume**, PRs, average rest, density (volume/min).
- **Improvements** section, compared with the previous session of the same routine and with each
  exercise's last time:
  - per exercise: best set, e1RM, volume and reps, with Δ arrows and colour
  - "New records" list
  - "You beat last time on 4/6 exercises"
- **Exercise list**: every set (type, weight, reps, RPE, rest planned vs. actual, time ticked),
  position number, skipped exercises with reasons, notes per exercise.
- Muscle map of the work done; sets per muscle group.
- **Timeline** (optional view): when each set happened, with rest gaps shown.
- Reminders created in this workout; notes written in this workout.

#### 8.12.2 Navigation
Previous/next workout arrows. "Other sessions of this routine" link.

#### 8.12.3 Actions (requirement 6)
- **Edit** everything: sets, values, exercises (add/remove/reorder), times, notes. History, PRs, stats
  and goals recompute live.
- **Duplicate**: as a new workout on another date (e.g. to log a repeat session) or as a template.
- **Save as routine** / **Update routine from this workout**.
- **Repeat now**: start a new workout with this workout's structure.
- Delete (with undo), export (JSON/CSV), share as an image (if accepted).

### 8.13 History: calendar + list (requirement 1)

One page for everything you have done: workouts and activities. A segmented control at the top
switches between **Calendar** (default) and **List** (a chronological, searchable list of sessions).

**Desktop:**
- Month grid (default), week view and year heat-map view.
- Each day cell shows chips: a coloured dot or icon per session (workout colour = routine colour;
  activities have their own icons), a name, and a duration. Scheduled-but-not-done items show as
  outlined chips; missed ones are faded.
- **Click a chip** → opens that workout or activity detail (side panel or page).
- **Click a cell** → day panel listing all sessions of that day plus "Log workout / activity on this
  day".
- Drag a scheduled item to another day (reschedule) or onto "skip".

**Phone:**
- A compact month grid with dots, and an agenda list for the selected day below it. Swipe between
  months. Tap a day to see its sessions, tap a session to open it.

**Both:**
- Header stats for the visible month: workouts, activities, total time, active days, streak.
- Filters: workouts / activities / scheduled, by routine, by activity type.

### 8.14 Routines page (requirement 13)

- Grid (desktop) / list (phone) of all routines, grouped by **folders** (collapsible, drag to
  reorder), with **pinned** at the top and a separate **Archived** filter.
- Card: name, colour/icon, exercise count, sets, est. duration, muscle chips, last done, times done,
  pending reminder badge.
- Search and sort (name, last done, most done, created).
- Card actions: **Start**, **Preview**, **Edit**, **Duplicate**, **New routine based on this**,
  move to folder, pin, archive, export/share, delete.
- Routine page (click a card): overview, exercises with targets and rests, notes, reminders, history
  of performed workouts (list + charts of duration and volume over time), schedule.

### 8.15 Routine editor (requirements 5 and 6)

#### 8.15.1 Ways to create
1. **From scratch.**
2. **Based on an existing routine**: copies everything, then you edit; `based_on_routine_id` records
   where it came from.
3. **From a past workout** ("Save as routine").
4. **Duplicate** (an identical copy named "… (copy)").
5. (If accepted) **from a starter template**.

#### 8.15.2 Editor
- Name, description, folder, colour, icon.
- Add exercises from the library picker: search, filters, multi-select, recently used.
- Per exercise:
  - sets, with each set's type, target reps (or a rep range), target weight, duration/distance for
    timed/cardio exercises, and optional RPE
  - rest between sets, rest after exercise, rest between reps
  - per-set rest overrides
  - pre-fill mode
  - pinned note
  - superset grouping
- Drag to reorder (with an explicit `position` column, never re-insert hacks).
- Live summary bar: exercises, sets, est. duration, muscle map.
- Routine-level workout settings defaults (§8.4.3).
- Schedule (e.g. "Sun & Wed at 18:00", with a reminder).
- **Autosave** draft; **Undo/redo**; version history is a later suggestion.

### 8.16 Exercise view (requirement 17)

Opened from anywhere: library, preview, active workout, workout detail, stats. It is a sheet on the
phone and a page or side panel on desktop.

**Tabs:**
1. **About**:
   - name, media loop/GIF/video, step-by-step instructions, tips
   - primary/secondary muscles on a muscle map, equipment, level, mechanic
   - license and attribution
   - your per-exercise settings (default rests, bar weight, increment)
2. **History**:
   - **Last session** card at the top: date, routine, every set, notes.
   - A full list of every session with this exercise: date, routine, **position in that workout
     ("#1 of 6" / "#6 of 6 – last")**, sets (weight × reps), best set, volume, e1RM, notes, skipped
     flags. Tapping a row opens that workout.
   - "First done", "last done", "times done", "most common position", "usual time of day".
3. **Charts**: max weight, e1RM, best set, total volume per session, reps at a given weight, and
   duration/distance for those types. Ranges: 1 month, 3 months, 1 year, all. Points are tappable and
   open the session.
4. **Records**: PRs (heaviest, e1RM, best reps at each weight, best volume), and a 1–10 rep-max table
   (if accepted).
5. **Notes & Reminders**: every note and reminder (§8.9, §8.10), with add, edit, pin and complete.
6. **Routines**: which routines include this exercise.

### 8.17 Goals (requirements 7 and 8)

#### 8.17.1 Goal types

| Scope | Example goals | Metric source |
|---|---|---|
| **General** | 3 workouts per week · 150 active minutes per week · train 4 weeks in a row · 100 workouts this year | workouts + activities |
| **Routine** | Do Chest Day 8 times this month · finish Leg Day under 60 min · raise Chest Day volume to 12,000 kg | workouts of the routine |
| **Exercise** | Bench 100 kg × 1 · e1RM 110 kg · 20 strict pull-ups · plank 3 min · run 5 km under 25 min | sets / PRs |
| **Muscle group** | 12–20 sets of back per week · train legs twice a week | sets per muscle (primary 1, secondary 0.5) |
| **Activity** | Walk 30 km per month · 8,000 steps per day average · 2 walks per week | activities / steps |
| **Body** | Body weight to 78 kg by 1 March · waist 85 cm | body metrics |

#### 8.17.2 Goal properties
- target value, comparator
- period: one-off / per week / per month / streak
- start date, optional deadline
- notes, reminder notifications
- auto-detects achievement (with a celebration), and recurring goals reset each period while keeping
  their history

#### 8.17.3 Goals page
- Sections: Active / Achieved / Archived. Filter by scope.
- Card: progress bar/ring, current vs. target, pace ("on track: need 2 more workouts by Sunday"),
  sparkline of progress history, deadline countdown.
- Goal detail: progress chart over time (`goal_snapshots`), contributing sessions list, edit,
  archive, duplicate.
- Goals also appear on Home, on the routine page (its goals), on the exercise view and on the stats
  pages.

### 8.18 Stats page (requirement 16)

**Global controls:** date range (week/month/3 months/year/all/custom) and a **compare to previous
period** toggle.

| Tab | Contents |
|---|---|
| **Overview** | Workouts, total time, volume, sets, reps, activities, distance, active days, streaks; workouts-per-week bar chart; consistency heat-map (GitHub style); time-of-day / weekday distribution; average workout duration |
| **Routines** | Per routine: times done, avg duration, volume over time, completion rate (skipped exercises), est. vs. actual duration |
| **Exercises** | Searchable table: times done, last done, best set, e1RM trend sparkline, volume; click → exercise view charts. "Most improved", "stalled" (no progress in N sessions), "most skipped" |
| **Muscle groups** | Sets and volume per muscle group per week (stacked bars), muscle heat-map for the range, balance (push vs. pull, upper vs. lower), neglected muscles |
| **Activities** | Distance, duration, count, pace per type; walking trends; steps; map of all routes (heat-map) |
| **Body** | Body weight trend (raw + smoothed average), measurements |
| **Records** | All PRs timeline |

Every chart has an ⓘ tooltip explaining it (Money Manager tooltip system), and every data point is
tappable through to its source.

### 8.19 Activities: walks and more (requirement 18)

- **Activity types:** walk (first-class), run, hike, cycle, swim, yoga, stretching, sport, rowing,
  elliptical, other. Users can add their own (name, icon, distance yes/no, GPS yes/no).
- **Recording a walk (Android):** Start → live map with your track, a big duration/distance/pace
  display, pause/resume, lock-screen notification. It keeps tracking with the screen off, via a
  foreground-service location watcher, with points written to SQLite immediately. Finish → save with
  notes.
- **Manual entry** (any platform): type, date/time, duration, distance, steps, notes.
- **Import:** GPX/TCX/FIT files from a watch, Strava export, OpenTracks/FitoTrack (auto-export to
  Motus's upload endpoint).
- **Activity detail:** map, splits per km, pace/elevation chart, stats, notes, edit, delete.
- **Integration everywhere:**
  - activities appear in the calendar, home feed and stats
  - goals can target them
  - weekly "active minutes" combines workouts and activities
  - the home "current condition" includes walking
- **Body weight and measurements:** logged from Home (quick-add) or the Body section; shown in Stats.
  The finish screen offers to log body weight.

### 8.20 Settings (requirement 15)

| Section | Options |
|---|---|
| **Account** | Name, email, username, password, 2FA, sync, signed-in devices (every other place signed in), delete account. Year of birth, sex and height are on the Body page |
| **Features** | One switch per optional feature (§10.0): when off, the feature disappears from every screen. Grouped as Logging, Training, Body & activity, Insights, Integrations |
| **Units & formats** | Measurement system **Metric / Imperial** (one switch), with individual overrides: weight kg/lb, distance km/mi, body measurements cm/in, height cm/ft-in. First day of week, date format, 12/24 h |
| **Workout defaults** | Default rest between sets / after exercise, all toggles from §8.4.3, pre-fill rule (same routine vs. anywhere), "update routine on finish" behaviour, default set type, weight increments (kg/lb), bar weight, available plates (for the plate calculator if accepted) |
| **Timer & sounds** | Sound choice, volume, vibration pattern, 10 s warning, voice cues, exact-alarm permission helper (Android) |
| **Notifications** | Scheduled-workout reminders, goal achieved, inactivity nudge (off by default), update available |
| **Appearance** | The full Money Manager atmosphere panel (§10) |
| **Exercises** | Manage custom exercises, hidden exercises, merge duplicates |
| **Activities** | Activity types, GPS accuracy/battery mode, map tile source |
| **Backup & Restore** | §9.2 |
| **Export & Import** | §9.3, §9.4 |
| **Updates** | Current version, check now, auto-check (on), **auto-download** (on/off), install on restart, release notes, channel (stable/beta) |
| **Accounts** (apps) | Account list (local and server accounts), add a local account, connect to a server, switch, remove; "keep offline data on device" for server accounts |
| **Privacy & security** | App lock (biometric/PIN, Android), clear local cache |
| **Admin** (admins only) | Users, registration mode, exercise catalog sync (wger), server backups, storage |
| **About** | Version, licenses and attributions (exercise data), links |

---

## 9. Backup, restore, export and import

(requirements 19 and 20)

### 9.1 Device backups: per user, to the user's device

- **Format:** `.motusbackup`, based on Money Manager's `.mmbackup`:
  - magic `MOTB` + version + flags
  - gzip JSON of **all the user's data**: routines, workouts, sets, notes, reminders, goals,
    activities with routes, body metrics, settings, custom exercises **with their media**
  - optional **AES-256-GCM encryption** with a password (scrypt KDF)
- **Where:**
  - **Android:** a folder you choose via the system folder picker (e.g. `Documents/Motus` or a synced
    folder such as Syncthing/Google Drive), default `Documents/Motus/Backups`.
  - **Desktop:** a chosen folder (default `~/Documents/Motus Backups`).
  - **Web:** a download (a scheduled browser backup isn't reliable, so the web shows "download
    backup" plus server backups).
- **Scheduling:**
  - Android: WorkManager periodic job + run on app open if overdue.
  - Desktop: the main process scheduler, with catch-up if the machine was off.

### 9.2 Backup & Restore settings page

- **Automatic backups:** On/Off.
- **Frequency:** after every workout / daily / every N days / weekly (+ time of day).
- **Keep:** last N backups or N days (rotation, always keeping the newest).
- **Location** (folder picker), **encrypt** on/off + password, include media on/off.
- **Backup now** button, last backup time/status, list of backups with size, **Restore** from any (or
  from a file).
- **Restore modes:**
  - **Replace all**: makes a safety backup first.
  - **Merge**: adds missing items by ID and never duplicates.
- A preview before restoring shows counts per type and the date range.
- **Server-side backups (admin):** an instance-wide nightly backup, encrypted, with rotation (Money
  Manager `backup.js` pattern). This is separate from the per-user device backups.

### 9.3 Export (everything exportable)

- **Full export:** JSON (complete, documented schema, versioned) or the backup file.
- **CSV:** workouts/sets (Strong-compatible column layout, so other apps can import it), activities,
  body metrics, goals.
- **Per item:**
  - a single routine or folder → shareable `.motusroutine` JSON
  - a single workout → JSON/CSV
  - an activity → GPX
- An export panel with choices of what to include, a date range and a preview (Money Manager
  `ExportPanel` pattern).

### 9.4 Import

- Motus backup / JSON (replace or merge).
- Routine files (`.motusroutine`).
- GPX/TCX/FIT activities (single or batch).
- CSV with a column-mapping wizard.
- (Suggested, see RESEARCH.md) Strong CSV, Hevy CSV and FitNotes CSV migration with an
  exercise-name matching step.
- Every import shows a dry-run preview and is undoable as one batch.

---

## 10. Design system and appearance

(goals 10 and 11, the screenshot and the Money Manager atmosphere chooser)

### 10.0 Clean by default: the anti-bloat rules

Other fitness apps bury the few things you use under buttons, badges and options you don't. Motus has
many features but **shows only what you use**. These rules are binding on every screen and every
change:

1. **One primary action per screen.** It is the only filled (accent) button. Everything else is a
   quiet text or icon button.
2. **Progressive disclosure.** Secondary actions live in a ⋮ menu or a sheet, never in a toolbar row.
   A card shows a summary; details are one tap away.
3. **Optional features are switched on and off** in Settings → Features. When a feature is
   off it is **completely absent**: no greyed buttons, no empty tabs, no upsell. Turning one on adds
   it exactly where it belongs.
   - **Always there (the core):** routines, workouts, rest timers, pre-fill, skip, notes,
     reminders, goals, history, stats, exercise library, walks, backups, PR detection.
   - **On by default for a new account:** set types menu, supersets, plate calculator, warm-up
     calculator, unilateral logging, longer rest after a missed set, logging from the notification,
     progression rules, programs, body measurements, steps, sleep/water/mood, achievements, monthly
     report and year in review, strength standards.
   - **Off by default (switch on as wanted):** RPE/RIR, voice cues, gym profiles, sharing routines,
     quick text entry, progress photos, share images, Health Connect, Strava, Wear OS, API tokens,
     MCP / "send to Claude", web-bundle live updates, command palette.
4. **The set table shows four columns**: `Previous · kg · Reps · ✓`. RPE, set type and timing
   appear only if their feature is on.
5. **Button budget.** The active workout shows at most: the set table, "+ Add set", Notes, the timer,
   and Finish. Everything else (skip, replace, reorder, reminder, settings) is in the exercise ⋮ menu.
6. **Short navigation**: 7 rail items on desktop, 6 tabs and Start on the phone (§8.1). New features join an
   existing page; they never get their own nav item without a strong reason.
7. **No noise:** no badges except real pending items (an update, a reminder due today), no
   motivational pop-ups, no red dots for "new feature", toasts only for results (Saved · Undo,
   PR, goal reached).
8. **Calm visuals:** generous spacing, one accent colour, numbers as the heroes (large, tabular), text
   labels short and plain.
9. **Defaults that just work**, so most people never open Settings. Settings has search, and each
   section shows only what applies (server settings only for server accounts).
10. **Review check:** every new feature states (a) which page it lives on, (b) whether it is
    core or optional, and (c) what it adds to the default view. The answer to (c) should almost
    always be "nothing".

### 10.1 Port Money Manager's theme engine wholesale

From `../moneymanager/frontend` (sibling folder):
- `src/core/theme.js` (atmospheres, applyTheme, saved looks, view-transition swaps)
- `src/components/AppearancePanel.vue` + `styles/components/appearance.css`
- `styles/tokens.css`, `theme.css`, `base.css`, and the card/button/chip/tab/form/sheet/tooltip/toast
  CSS
- the pre-paint script in `index.html` (no flash on load) and the self-hosted fonts (Inter, Nunito,
  Rubik)

Storage keys are renamed (`motusTheme`, `motusBoot`), and preferences sync per user via
`/api/prefs`, so your look follows you across devices.

### 10.2 Appearance options (identical to Money Manager)

| Tab | Options |
|---|---|
| Colours | Mode light/dark/auto · Atmosphere: Indigo, Ocean, Forest, Sunset, Aurora, Mono, Rose, **Ember**, Gold, Meadow, Lagoon, Sky, Slate, Plum, Mocha, Mint, Midnight, Candy, **Custom** (one base colour → full palette, every token overridable, separate light/dark, chart colours) |
| Background | glow, mesh, diagonal, spot, aurora, horizon, duo, corners, sweep, flat · glow intensity · texture none/dots/stripes/grid/static with scale and opacity |
| Style | Surface solid/outline/raised/glass (blur, vibrance, opacity) · corners round/soft/sharp · font sans/serif/rounded/mono |
| Layout | Density compact/cozy/roomy · card spacing tight/standard/loose/wide · nav spacing · nav full/mini (desktop) |
| Saved looks | Up to 25 named looks; assign one to light mode and one to dark mode; shuffle by clicking the logo |

**Default look for Motus:** **Ember**, dark, glow background. This is exactly the screenshot: peach
accent `#f8b396`, warm near-black `#17100d`, pink second glow `#f47b99`.

### 10.3 Motus-specific design additions (same tokens)

- **Semantic workout colours:** set types (warm-up = muted, drop = `--c2`, failure = `--neg`), PR gold
  badge, skipped = struck-through `--tx2`, "better than last time" = `--pos`.
- **Muscle-map figure** coloured from `--acc` intensity ramps, so it follows the atmosphere.
- **Rest timer ring** uses the `--acc` → `--acc2` gradient (like the FAB).
- **Numbers:** tabular numerals everywhere (weights and times don't jiggle).
- **Motion:** `--ease` curve, view transitions between pages, a satisfying tick animation and haptic
  on set completion, and confetti-free PR celebration (subtle glow pulse).
- **Material principles:** clear elevation via surfaces s1/s2, 44–48 px touch targets, bottom sheets
  on the phone, FAB, segmented controls, state layers on press.
- **Accessibility:** WCAG AA contrast check on every atmosphere (automated test), reduced-motion
  support, screen-reader labels, full keyboard support on desktop.

---

## 11. Desktop-first AND mobile-first UI

(goal 6)

As in Money Manager, **two separately designed UIs** share one data layer, logic and i18n:

```
apps/web/src/
  core/        theme, prefs, tooltips, toasts, live (SSE), offline outbox, timers
  data/        query keys, API client, live-deps map, local DB adapter
  logic/       pure functions: prefill, estimates, PRs, e1RM, goals, stats, units (unit-tested)
  desktop/     DesktopApp.vue, rail nav, pages, side panels, multi-pane layouts, keyboard shortcuts
  phone/       PhoneApp.vue, tab bar, stack navigation, sheets, swipe pagers, steppers, haptics
  shared-ui/   cards, charts, muscle map, media loop, inputs used by both
```

- The UI is chosen by device class (≤860 px wide, or a touch device ≤1100 px → phone UI), with a
  manual override in Settings ("Use phone layout / desktop layout").
- **Desktop design principles:**
  - information density, multi-pane (list + detail side panels)
  - hover tooltips, keyboard shortcuts, drag and drop (routine editor, calendar), wide charts
  - persistent active-workout mini bar
- **Phone design principles:**
  - one-hand reach (primary actions in the bottom third), bottom sheets instead of dialogs
  - swipe pagers (exercises), large steppers and numeric keypad sheets, haptics
  - pull-to-refresh, safe areas, keyboard-aware layout
  - lock-screen timer, screen kept awake during workouts
- **Tablets:** phone UI in portrait, desktop UI in landscape (override available).
- Every screen in §8 gets **both** a desktop and a phone design. Playwright visual tests run each one
  at desktop and phone viewports.

---

## 12. Self-updating apps and release pipeline

(goal 9)

### 12.0 Repository

- **GitHub: `userofit123/motus`**, created **private** for now. It must be made **public before the
  first release**, because the apps check for updates through the public GitHub Releases API (a
  private repo would need a token in every app). This matches Money Manager, which is public.
- Same privacy setup as Money Manager:
  - commits use the GitHub no-reply email
  - a `post-commit` hook rewrites commit times to UTC, so no time zone is published
  - a `pre-commit` hook refuses a personal author email and files that hold data or secrets
    (backups, exports, `.env`, keystores)
  - install once per clone: `git config core.hooksPath .githooks`

### 12.1 Versioning

- SemVer. The version comes from the top entry of `CHANGELOG.md` (Money Manager `bump.mjs` /
  `release-notes.mjs` pattern).
- **API level** (`/api/version` → `{version, apiLevel, minClientApiLevel}`). Apps check
  compatibility with their server and say clearly "update the app" or "update the server".

### 12.2 GitHub Actions: `release.yml`

Triggered when `CHANGELOG.md` gets a new version on `main` (or manually):

1. **test**: lint, unit, API tests on Postgres 16, isolation suite (§4.5), E2E.
2. **version**: read the version; skip if the tag exists.
3. **docker**: multi-arch (amd64/arm64) server image → `ghcr.io/<you>/motus:<ver>` + `latest`.
4. **desktop**: electron-builder → Windows NSIS (`latest.yml`), Linux AppImage/deb/rpm
   (`latest-linux.yml`), macOS dmg (best effort). Published to the GitHub Release.
5. **android**:
   1. build web → `npx cap sync` → Gradle `assembleRelease`
   2. sign with the keystore from secrets (same key forever, or updates break)
   3. upload `motus-<ver>.apk`
   4. generate `android-latest.json` (`{version, versionCode, url, sha256, size, notes, minSdk}`)
6. **release notes** from the changelog are attached to the release.
7. `pages.yml`: docs site (optional).

### 12.3 Android in-app updater (Money Manager doesn't have this; built new)

1. **Check:**
   - on launch and every 6 h (setting), fetch `android-latest.json` from the latest GitHub release
     (or via the server's `/api/update-check` proxy, which caches it and avoids GitHub rate limits)
   - compare with the app's own `versionCode` (from `App.getInfo()`, not the server version, a Money
     Manager gap)
2. **Notify:** an "Update available: 1.4.0" banner with release notes. Settings → App & Versions has the
   switches.
3. **Download:** automatic if **auto-download** is on (Wi-Fi only option), otherwise on tap. Progress
   shown; resumes on failure.
4. **Verify:** SHA-256 must match the manifest.
5. **Install:**
   - fire the system installer via `FileProvider` + `ACTION_VIEW` / `PackageInstaller`
     (`REQUEST_INSTALL_PACKAGES` permission)
   - first time: a guided prompt to allow "Install unknown apps" for Motus
   - Android always requires one user tap to confirm a sideloaded install; this is an OS rule, so
     "auto-update" means download and stage automatically, then one tap
6. **Never during an active workout:** the update is deferred until the workout is finished.
7. **Fallback:** Obtainium compatibility (it tracks GitHub releases) is documented.

### 12.4 Desktop updater

electron-updater against GitHub Releases (Money Manager `desktop/main.js` lines ~294–352):
- auto-check
- **auto-download** following the setting
- install on quit
- a "Restart to update" button in the rail and tray
- deferred during an active workout

### 12.5 Web / server

- The web app checks `/api/version` and shows "New version loaded, reload" when the server was
  updated. The service worker updates its cache.
- Server: an optional Watchtower overlay (`docker-compose.autoupdate.yml`) for automatic container
  updates, with `MOTUS_VERSION` pinning, plus an admin "update available" banner via
  `/api/update-check`.

---

## 13. Self-hosting and deployment

- `docker-compose.yml`: `postgres:16-alpine` (internal network only) + `motus` app (serves API + web +
  media), volume `/data` (media, backups, keys). Published on `127.0.0.1:8790` by default; put
  Caddy/Traefik in front for HTTPS.
- Overlays: `proxy` (Caddy network), `dev` (Vite hot reload), `build` (from source), `demo` (sample
  data), `autoupdate` (Watchtower).
- `setup.sh` generates `.env` (DB password, session secret, server key) from `.env.example`.
- First run: a setup wizard creates the admin, chooses units and imports the exercise
  library (bundled, no network needed).
- Health check endpoint, structured logs, and a resource footprint target of < 300 MB RAM.

---

## 14. Testing and quality

- **Unit:** all `logic/` functions (pre-fill, duration estimate, e1RM, PRs, goal progress, unit
  conversion, rest resolution hierarchy, schedule recurrence across DST).
- **API:** every endpoint on PGlite in-memory, plus the **isolation suite** (§4.5) on real Postgres
  with RLS.
- **Live-deps tests:** each event type invalidates the right keys.
- **Offline tests:** a workout logged with the network off syncs correctly; duplicate submits are
  idempotent (`client_id`).
- **E2E:** Playwright journeys at desktop (1440×900) and phone (390×844) viewports: create routine →
  start → log sets with pre-fill → rest override → skip → notes → reminder → finish → see the
  calendar/home/stats/goals update.
- **Visual and a11y:** screenshot diffs per atmosphere (Ember dark + one light), axe checks, contrast
  test across all atmospheres.
- **Strings test:** every UI string comes from `en.ts` (no hard-coded text in components).
- **Clean-UI checks:** a lint rule flags more than one primary button per screen, and visual tests run
  with **all optional features off** (the default look must stay calm) and **all on** (nothing
  overflows or crowds).
- **Both account kinds:** the API suite runs against the engine on PGlite (local account) and over
  HTTP on PostgreSQL (server account) with identical expectations.
- **CI blocks release** on any failure. A `CLAUDE.md` with project conventions is adapted from Money
  Manager's.

---

## 15. Delivery phases

Each phase ends with something usable on both desktop and phone. The APK pipeline comes early so the
phone flow is tested on a real device throughout.

| Phase | Scope | Exit criteria |
|---|---|---|
Research items (IDs from §18) are placed in the phase they belong to.

| Phase | Scope | Exit criteria |
|---|---|---|
| **0. Foundation** | Repo + hooks (done), pnpm monorepo, engine package with migrations on PostgreSQL **and** PGlite, ported theme engine + Appearance panel, desktop and phone shells with navigation, Features switchboard (§10.0), server (auth, multi-user, RLS), SSE live channel, isolation test suite, Docker compose, CI with test job · D12 undo toast | Two server users sign in on web; a local account works in the desktop app; the look matches the screenshot; isolation tests pass |
| **1. Exercise library** | free-exercise-db import, library pages (search/filter), exercise view About tab, custom exercises + media upload, muscle map · S8 tracking types, S9 unilateral | Browse and create exercises on desktop and phone |
| **2. Routines** | Routines page, folders, editor (from scratch / based on / duplicate), rest configuration, routine notes · P3 starter templates, P6 version history, S2 supersets | Full routine CRUD with all rest settings |
| **3. Workout engine** | Start sheet, pre-start preview, active workout (desktop + phone), pre-fill from previous, rest timer system with live override, skip, notes button, finish summary, offline outbox for server accounts · S1 set types, S3 RPE/RIR, S4 plate calc, S5 warm-up calc, S6 e1RM, S7 PR detection, S10 replace exercise, S12 adaptive rest, S14 quick text entry, S15 voice cues | Complete a real gym session on the phone, offline, with timers and notifications |
| **4. Android app + updates** | Capacitor app with local accounts on PGlite, local notifications + ongoing timer, keep awake, haptics, release pipeline (Docker, Electron, APK), in-app APK updater, Electron updater · S11 lock-screen controls incl. logging from the notification, D4 app shortcuts, D8 Obtainium, D11 biometric lock | Install the APK from GitHub; publish a new version; the app downloads and installs it |
| **5. History** | Workout detail (with improvements), edit/duplicate/save-as-routine, History page (calendar + list, desktop + phone), exercise view History/Charts/Records tabs | Click any calendar day/workout; full history everywhere |
| **6. Reminders, goals, home** | Reminders (create, trigger on exercise start, actions), goals (all scopes) + goals page, Home (default + optional cards), scheduling + workout notifications · P1 progression rules, A3 weekly streaks, A7 condition | Home shows the summary; reminders fire at the right exercise |
| **7. Stats** | Stats page, all tabs · A1 weekly sets per muscle, A2 heat-map, A4 consistency heat-map, A6 stalled exercises, A8 strength standards | Progress over time per routine/exercise/muscle/activity |
| **8. Activities & body** | Activity types, walk GPS recording, manual entry, GPX/FIT import, activity detail, integration into history/home/stats/goals · B1 weight trend, B2 measurements, B3 progress photos, B4 Health Connect read, B5 Health Connect write, B6 upload endpoint, B8 step goal, B10 mobility routines | Record a walk on the phone; it appears everywhere |
| **9. Backup/export/import** | Device backups with scheduling + settings page, restore (replace/merge), exports, imports with preview · D1 Strong/Hevy/FitNotes import, D2 Strong-compatible export | Scheduled backup lands in the chosen folder; restore on a fresh install works; a local account moves to a server via backup |
| **10. Training depth** | P2 programs, P4 training-max programming, P7 share routine with another user, S13 gym profiles, A5 monthly report + year in review, A9 achievements, A10 share image, D13 command palette | Run a multi-week program end to end |
| **11. Integrations & extras** | D5 personal API tokens + docs, D6 MCP / send to Claude, D9 passkeys, D10 OIDC, B7 Strava, B9 sleep/water/mood, D7 web-bundle live updates, P5 progression DSL, S16 Wear OS app | Each works behind its Features switch |
| **12. Polish → 1.0** | Clean-UI audit of every screen against §10.0, accessibility, performance (10 years of data), docs site | Release 1.0 |

---

## 16. Decisions log

| Date | Decision |
|---|---|
| 2026-11-01 | Name: **Motus** |
| 2026-11-01 | **TypeScript** everywhere |
| 2026-11-01 | **English only** |
| 2026-11-01 | Apps are fully independent (**local accounts**, data on the device) **and** can point an account at a server (**server accounts**, database on the server, app and files local); both kinds side by side (§2.4) |
| 2026-11-01 | No native iOS app; iPhone uses the PWA |
| 2026-11-01 | Repository `userofit123/motus` created (private until the first release, §12.0) |
| 2026-11-01 | **All research suggestions accepted** (§18); optional ones stay off until switched on (§10.0) |
| 2026-11-01 | Overriding design rule: extremely clean, no clutter (§10.0) |
| 2026-11-03 | The everyday optional features (set types, supersets, plates, warm-ups, sides, progression, programs, body, steps, daily log, achievements, reports, standards…) start **on** for new accounts; the rest stay off (§10.0) |

Still open, not blocking: server port/domain for your deployment (default `127.0.0.1:8790`).

---

## 17. Lessons from simplefitnessapp

(full analysis in RESEARCH.md §1)

**Borrowed:**
- the program → session copy (snapshot) so history is immutable
- the one-calendar view with clear states (done / missed / upcoming / today)
- date-aware logging (past date → manual entry, today → guided session)
- the guided set-by-set flow with automatic rest that tells sets from exercises apart, +15 s, skip
  and jump-to-exercise
- "last time" values shown during rest
- per-exercise notes and video link visible mid-workout
- recurring schedules (every N days / weekdays) with per-schedule reminder times
- shareable JSON routine files, starter templates, and a "?" explainer on every chart

**Fixed:**

| Their problem | Motus |
|---|---|
| Session status inferred from "has any logged set"; links by name string | Explicit status enum + foreign keys + snapshot |
| Free-text exercise names ("Bench press" ≠ "Bench Press") | Exercise catalog with IDs, aliases, merge |
| One sets × reps per exercise, no weight targets, no per-set rest | Per-set targets, types and rest overrides |
| Weight must be > 0 (bodyweight broken) | Tracking types incl. bodyweight / assisted / timed / distance |
| kg/lb is only a label, no conversion | Canonical units + lossless conversion |
| In-progress sets only in memory | Local-first persistence of every action |
| Lazy, unversioned migrations; FKs off | Versioned migrations, FKs and RLS on |
| "Latest" = highest ID, not latest date | Latest by date |
| No rest-end notification in the background; interval-based timers | Exact-alarm notifications; timestamp-based timers |
| Recurring: deleted occurrences come back, no end date, DST drift | Computed occurrences + exceptions + end dates, timezone-safe |
| Raw DB-file export only | Versioned JSON/CSV/backup with merge restore |
| No body weight, no cardio, no exercise library, single user | All included |

---

## 18. Accepted additions from research

All suggestions from RESEARCH.md §4 are accepted. "Core" means on by default. "Optional" means off
until switched on in Settings → Features (§10.0), and absent from the UI until then.

| ID | Addition | Lives in | Default | Phase |
|---|---|---|---|---|
| S1 | Set types (warm-up/normal/drop/failure) | Set ⋮ menu in the active workout; routine editor | Optional | 3 |
| S2 | Supersets / circuits | Routine editor ⋮ "Group as superset"; active workout brackets | Optional | 2 |
| S3 | RPE / RIR per set | Extra set-table column | Optional | 3 |
| S4 | Plate calculator | Tap a weight → "Plates" in the keypad sheet | Optional | 3 |
| S5 | Warm-up calculator | Exercise ⋮ "Add warm-up sets" | Optional | 3 |
| S6 | e1RM + %1RM table | Exercise view Charts/Records | Core (charts) | 3 |
| S7 | PR detection + live toast | Workout, exercise view, home card | Core | 3 |
| S8 | Bodyweight/assisted/timed/distance types | Exercise data model | Core | 1 |
| S9 | Unilateral + dumbbell pair convention | Exercise settings | Optional | 1 |
| S10 | Replace exercise mid-workout | Exercise ⋮ menu | Core | 3 |
| S11 | Lock-screen countdown + log next set from the notification | Android notification | Core (countdown), Optional (logging) | 4 |
| S12 | Adaptive rest after a failed set | Timer settings | Optional | 3 |
| S13 | Gym profiles | Settings → Training; picker filter | Optional | 10 |
| S14 | Quick text entry ("3x8 80") | Keypad sheet text field | Optional | 3 |
| S15 | Voice cues | Workout settings sheet | Optional | 3 |
| S16 | Wear OS app | Separate app module | Optional | 11 |
| P1 | Progression rules (linear, double, auto-deload) | Routine editor per exercise; shown as the suggested weight | Optional | 6 |
| P2 | Multi-week programs with deload weeks | Routines page, "Programs" section | Optional | 10 |
| P3 | Starter routine templates | "New routine" → "From template" | Core | 2 |
| P4 | Training-max % programming | Program editor | Optional | 10 |
| P5 | Progression DSL | Routine editor "Advanced rule" | Optional | 11 |
| P6 | Routine version history | Routine ⋮ "History" | Core | 2 |
| P7 | Share a routine with another server user (copy) | Routine ⋮ "Share" (server accounts) | Optional | 10 |
| A1 | Weekly sets per muscle vs. target range | Stats → Muscle groups; optional Home card | Core | 7 |
| A2 | Muscle heat-map | Home condition card, workout, exercise, stats | Core | 7 |
| A3 | Weekly streaks | Home stat card | Core | 6 |
| A4 | Consistency heat-map | Stats → Overview | Core | 7 |
| A5 | Monthly report + Year in Review | Stats → "Reports" | Optional | 10 |
| A6 | Stalled-exercise detection | Stats → Exercises; exercise view hint | Core | 7 |
| A7 | Freshness per muscle | Home condition card | Core | 6 |
| A8 | Strength standards | Exercise view Records | Optional | 7 |
| A9 | Achievements | Stats → "Achievements"; optional Home card | Optional | 10 |
| A10 | Shareable summary image | Workout ⋮ "Share image" | Optional | 10 |
| B1 | Body weight with smoothed trend | Stats → Body; quick-add on Home | Core | 8 |
| B2 | Body measurements | Stats → Body | Optional | 8 |
| B3 | Progress photos | Stats → Body → Photos | Optional | 8 |
| B4 | Health Connect read (steps, weight, HR, watch workouts) | Settings → Integrations | Optional | 8 |
| B5 | Health Connect write | Settings → Integrations | Optional | 8 |
| B6 | GPX/FIT auto-upload endpoint | Settings → Integrations (server accounts) | Optional | 8 |
| B7 | Strava sync | Settings → Integrations | Optional | 11 |
| B8 | Daily step goal + history | Goals; Stats → Activities | Optional (with B4) | 8 |
| B9 | Sleep / water / mood logging | Stats → Body → "Daily log"; quick-add sheet | Optional | 11 |
| B10 | Mobility/stretching routines with timed holds | Normal routines with timed sets | Core | 8 |
| D1 | Import from Strong / Hevy / FitNotes CSV | Settings → Export & Import | Core | 9 |
| D2 | Strong-compatible CSV export | Settings → Export & Import | Core | 9 |
| D3 | Android home-screen widget | Android launcher | Optional | 4 |
| D4 | App shortcuts (long-press icon) | Android launcher | Core | 4 |
| D5 | Personal API tokens + API docs | Settings → Integrations (server accounts) | Optional | 11 |
| D6 | MCP server / "send workout to Claude" | Settings → Integrations; workout ⋮ | Optional | 11 |
| D7 | Web-bundle live updates | Settings → App & Versions | Optional | 11 |
| D8 | Obtainium-friendly releases | Docs + release naming | Core | 4 |
| D9 | Passkeys | Settings → Account | Optional | 11 |
| D10 | OIDC / SSO | Server admin settings | Optional | 11 |
| D11 | Biometric/PIN app lock | Settings → Privacy | Optional | 4 |
| D12 | Undo toast after every change | Everywhere | Core | 0 |
| D13 | Command palette (Ctrl+K) | Desktop only | Optional | 10 |

D3 (widget) is accepted too and is scheduled with the Android work in phase 4.
