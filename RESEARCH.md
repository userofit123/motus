# Motus: Research & Suggestions

> Companion to [PLAN.md](PLAN.md) · 1 November 2026
>
> **Decision (1 Nov 2026): all suggestions in §4 are accepted**, including the ones marked 🕐 and ❌.
> Where each one lives, whether it is on by default, and its phase: PLAN.md §18. Optional features
> stay off and invisible until switched on (PLAN.md §10.0).
>
> **How to use this:** §4 is the list of suggestions. Each item has a recommendation
> (**✅ v1**, **🕐 later**, **❌ skip**). Tick or change them, and accepted items go into the plan's
> phases. §1–§3 are the research behind them.

---

## 1. simplefitnessapp: thorough analysis

**What it is:** basarsubasi/simplefitnessapp (v1.7.15, Dec 2025).
- **Stack:** React Native + Expo 52, TypeScript, MIT license.
- **Data:** purely local SQLite (`expo-sqlite`, raw SQL in screens). No server, accounts or sync.
- **Platforms:** Android (Play, F-Droid, GitHub) and iOS.
- **Languages:** 21 languages.

### 1.1 Data model
- **Plan side:** `Workouts` (a program, e.g. "Push Pull Legs") → `Days` → `Exercises`. Each exercise
  has a single `sets × reps`, a muscle group, a web link and notes. There is no target weight and no
  order column.
- **Session side:** `Workout_Log` (date, workout/day **names**, completion time) → `Logged_Exercises`
  (a **copy** of the plan taken when it is scheduled) → `Weight_Log` (actual sets).
- **Status:** "planned" vs. "done" is **inferred**. A session is done if it has at least one logged
  set.
- **Templates:** three built-in programs (Beginner / PPL / Bro split) with YouTube links.
- **Recurring schedules:** every N days or on chosen weekdays. The next 3 occurrences are generated
  ahead, each with an optional notification time.

### 1.2 Screens
- **Home:** three link cards, with no data shown.
- **My Workouts:** create, edit and drag-reorder programs. Days and exercises, JSON import/export per
  program, and copying from templates.
- **Calendar:**
  - a custom month grid with states logged / untracked / upcoming / today
  - tap a day for a sheet that previews, starts, logs manually or deletes that day's sessions
  - Quick Workout; recurring rules
- **Guided session:** a state machine (overview → exercise ⇄ rest → completed).
  - *Overview* settings: rest between sets and between exercises, vibration, sound, notification,
    auto-fill weight, auto-fill reps.
  - *Exercise:* one set at a time, with notes and a video link, and a jump-to-exercise list.
  - *Rest:* a big countdown with +15 s and Skip, showing "last workout" values for the next set.
- **Manual logging** of past sessions.
- **Progress:** per-exercise charts (an invented "CES" score, e1RM, per-set weight and reps), workout
  duration, volume, and muscle-group distribution. Ranges are week/month/year/all, with a sticky
  y-axis and tappable points.
- **Settings:** language, date format, 12/24 h, kg/lb, first weekday, light/dark, notifications, and
  raw DB-file import/export.

### 1.3 Worth borrowing
- Copying the plan into the session (history is immutable).
- One calendar with clear states.
- Date-aware routing (past → manual, today → guided).
- Automatic rest that tells sets from exercises apart.
- "Last time" values during rest.
- Notes and video mid-workout.
- Recurring schedules with per-schedule reminders.
- Shareable JSON programs.
- A "?" explainer on every chart.

### 1.4 Weaknesses (all fixed in PLAN.md §17)
- Status is inferred, and sessions link to plans by name strings.
- Exercise names are free text.
- Prescriptions are rigid.
- **Weight must be > 0**, so bodyweight exercises can't be logged.
- kg/lb is only a label, with no conversion.
- In-progress sets are held in memory only.
- Migrations are lazy and unversioned, foreign keys are off, and there's an edit bug that orphans
  logged sets.
- "Latest" means the highest ID, not the latest date.
- No notification when rest ends in the background.
- Recurring occurrences come back after being deleted, and recurrence drifts across DST changes.
- Screen files are 4,000 lines long.
- There is no body tracking, cardio, exercise library or multi-user support.

---

## 2. Market landscape: what other apps offer

### 2.1 Commercial apps: distinctive features

| App | Stand-out features |
|---|---|
| **Hevy** (market leader) | Set types (warm-up/drop/failure), supersets, inline "previous" column, warm-up & plate calculators, **lock-screen live rest timer with ±15/Skip**, live PR notifications, muscle distribution, sets per muscle per week, monthly report + Year in Review, body measurements + progress photos, social feed, public API, "send workout to ChatGPT/Claude", Strava sync, Wear OS, CSV export |
| **Strong** | Very fast minimalist logging, warm-up and plate calculators, widgets, the **CSV export that became the de facto interchange format** |
| **Fitbod** | Generated workouts from **per-muscle recovery %** (heat map), equipment profiles, "Strength Score" per muscle |
| **JEFIT** | ~1,400-exercise database, NSPI weekly adaptation score (strength/volume/balance/consistency), movement-balance checks |
| **Boostcamp** | A library of real programs (GZCLP, nSuns, 5/3/1, PHUL, PPL), training-max % programming, auto progression |
| **Alpha Progression** | Per-set targets for weight + reps + **RIR**, double progression, mesocycles with **planned deload weeks** |
| **StrongLifts 5×5** | Auto-increment on success, **auto-deload after N failures**, deload after a break, **adaptive rest** (longer after a failed set), plate math incl. fractional plates, log sets from the notification |
| **FitNotes** | Fully offline, calendar, per-exercise graphs, CSV import/export |
| **Liftin'** | Apple Watch double-tap to log, schedule-aware Smart Stack widget |
| **Gravl** | AI coach, next-session weight suggestions, machine weight-stack setup, injury-aware filtering |
| **Setgraph** | Fewest-taps logging, circuits/multi-sets, %1RM table, Dynamic Island timer |
| **MacroFactor Workouts** (2026) | **Multiple gym profiles** (equipment per gym), optional smart generation, progression that widens rep ranges |
| **Apple Workout (watchOS 26)** | Workout Buddy AI voice coach, auto-start strength workout on arriving at the gym |
| **Health Connect** (Android) | The on-device health data store. **Google Fit APIs are deprecated in 2026.** It holds exercise sessions with segments (reps, weight, RPE) and GPS routes, steps, weight and heart rate |
| **Strava** | GPS, segments, route planning/discovery; the sync target for walks/runs |
| **Liftosaur** (open source) | **Liftoscript**: progression rules as a small DSL (`lp`, `dp`, training max state), all programs editable |

### 2.2 Open-source / self-hosted apps

| App | Stack · License | Worth borrowing |
|---|---|---|
| **wger** | Django + Flutter · AGPL | Exercise sync design (pull the shared catalog without touching local exercises), license + author on every exercise, routines with progression, body weight, nutrition, progress photos |
| **workout.cool** | Next.js + Prisma + Postgres · MIT | Modern stack; the exercise picker flow (equipment → muscles → exercise). **Its exercise media has unclear licensing**, so don't reuse it |
| **Liftosaur** | Preact PWA + thin native wrappers · AGPL | Programs-as-code / progression DSL; the PWA-in-a-wrapper model (like Capacitor) |
| **LiftLog** | React Native + .NET · AGPL | Local-first, a **persistent Android workout notification**, shareable plan files, E2E-encrypted social |
| **Flexify / Flex** | Flutter + SQLite · MIT | Minimal fast logging, rest timer in the notification shade |
| **Ryot** | Rust + Postgres · GPL | Proves free-exercise-db works in production self-hosted apps; body measurements |
| **Workout Tracker** (jovandeginste) | Go single binary · MIT | **Admin-activated multi-user**, GPX/TCX/FIT import, daily weight & steps, equipment tracking, route heat-map, an **upload API that phone apps (FitoTrack) push to** |
| **FitTrackee / Endurain** | Flask or FastAPI + Vue · AGPL | Self-hosted Strava alternatives: PostGIS routes, GPX import, Strava/Garmin sync |
| **OpenTracks / FitoTrack** | Android · Apache / GPL | Privacy-first GPS recording, auto-export after each recording, stable track IDs (no duplicates on re-import) |
| **SparkyFitness** | source-available, non-commercial (UX reference only) | Health Connect → own-server sync, family profiles |

**Architecture takeaways:**
1. Make logging **local-first**, which every good gym app does.
2. Use **GPX/FIT plus an upload API** for interoperability.
3. Represent **progression as data**, not hardcoded program logic.
4. Store **license and source on every exercise media row**.

All four are in PLAN.md, or in §4 below.

---

## 3. Exercise library: licensing check

| Dataset | Size | Media | License | Can Motus bundle it? |
|---|---|---|---|---|
| **free-exercise-db** (yuhonas) | ~870 | 2 JPG photos each (start/end) | **Unlicense** (public domain) | **Yes**: chosen as the seed |
| **wger** | several hundred good entries, multilingual | images, a few videos | CC-BY-SA (per entry) | Yes, with attribution: optional sync |
| everkinetic | small | SVG line drawings | CC-BY-SA 4.0 | Yes, but dormant since ~2022 |
| ExerciseDB (V1/AscendAPI) | 1,500 | GIFs | Code AGPL; **GIF license not stated**; media likely third-party | **No** |
| hasaneyldrm/exercises-dataset | 1,324 | GIFs | Text MIT; **media © Gym visual** | Text only |
| workout.cool DB | ~1,200 | videos | Provenance unstated | **No** |
| MuscleWiki API | large | videos, body maps | Terms forbid storing or re-hosting | **No** |

**Strategy** (in PLAN.md §7):
1. Bundle free-exercise-db, shown as a crossfade loop between its two photos.
2. Offer an optional wger sync.
3. Let users upload their own media or add YouTube links.
4. Keep one `exercise_media` table that records the license per row, so a purchased commercial GIF
   pack can be added later.

**Muscle map component:** `body-highlighter` (lahaxearnaud). It is framework-agnostic with front and
back views and ~19 muscle groups, and takes intensity colours. Its MIT polygons come from
react-native-body-highlighter; keep the notices.

---

## 4. Suggestions

Value = for a personal self-hosted app. Size = S/M/L effort.

### 4.1 Logging and the active workout

| # | Suggestion | Seen in | Value | Size | Rec. |
|---|---|---|---|---|---|
| S1 | **Set types**: warm-up / normal / drop / failure. Warm-ups are excluded from volume and PRs | Hevy, Strong | High | S | ✅ v1 |
| S2 | **Supersets / circuits**: grouped exercises, auto-advance between them, rest after the round | Hevy, Setgraph | High | M | ✅ v1 |
| S3 | **RPE / RIR per set** (optional; toggle in settings) | Hevy, Alpha | High | S | ✅ v1 |
| S4 | **Plate calculator**: bar weight + your plate inventory, fractional plates, per-side visual | Strong, StrongLifts | High | S | ✅ v1 |
| S5 | **Warm-up calculator**: auto-generate ramp sets to the working weight | Strong, StrongLifts | Med | S | ✅ v1 |
| S6 | **e1RM per set** (Epley/Brzycki selectable) and a **%1RM table** | All, Setgraph | High | S | ✅ v1 |
| S7 | **Automatic PR detection** (heaviest, e1RM, reps at a weight, set volume, session volume) with a live in-workout toast | Hevy, Strong | High | M | ✅ v1 |
| S8 | **Bodyweight / assisted / weighted-bodyweight / timed / distance** exercise types | Hevy, Strong | High | M | ✅ v1 (already in the data model) |
| S9 | **Unilateral exercises** (left/right logging) and the **dumbbell single vs. pair** weight convention | Hevy (planned) | Med | S | ✅ v1 |
| S10 | **Replace exercise mid-workout** with an alternative for the same muscles (equipment busy) | Hevy, Fitbod | High | S | ✅ v1 |
| S11 | **Lock-screen / notification controls**: live countdown, +15/Skip, **log the next set from the notification** | Hevy, StrongLifts, LiftLog | High | M | ✅ v1 (countdown); 🕐 later (log from notification) |
| S12 | **Adaptive rest**: auto-lengthen rest after a failed set | StrongLifts | Low | S | 🕐 later |
| S13 | **Gym profiles**: equipment and plates per gym; the exercise picker hides what isn't available | MacroFactor | Med | M | 🕐 later |
| S14 | **Quick text entry**: type "3x8 80" or "80x8, 8, 7" to fill sets | Gravl (AI) | Med | S | 🕐 later |
| S15 | **Voice cues**: "Rest over, set 3 of Bench, 80 kg × 8" (TTS, offline) | Apple Workout Buddy | Med | S | ✅ v1 (toggle exists in the plan) |
| S16 | **Wear OS** watch app | Hevy, Fitbod, Gravl | Med | L | ❌ skip for now |

### 4.2 Routines and progression

| # | Suggestion | Seen in | Value | Size | Rec. |
|---|---|---|---|---|---|
| P1 | **Progression rules per routine exercise**: *linear* (+2.5 kg when all reps are hit), *double progression* (rep range then weight), *auto-deload* after N failures (−10%), deload after a long break. Shown as a suggested weight during pre-fill; it complements your reminders | StrongLifts, Alpha, Liftosaur | High | M | ✅ v1 |
| P2 | **Programs**: multi-week plans that group routines (Week 1: A/B/A, Week 2: B/A/B…) with a "next workout" pointer and planned deload weeks | Boostcamp, Alpha, MacroFactor | High | M | 🕐 later (phase 10) |
| P3 | **Starter templates**: PPL, Upper/Lower, Full Body 3×, 5×5-style, beginner, written by us (no licensed content) | Boostcamp, simplefitnessapp | Med | S | ✅ v1 |
| P4 | **Training-max % programming** (5/3/1-style waves, AMRAP-driven training-max updates) | Boostcamp, Liftosaur | Med | M | 🕐 later |
| P5 | **Progression DSL** (Liftoscript-like) for power users | Liftosaur | Low | L | ❌ skip |
| P6 | **Routine version history**: see and restore previous versions of a routine | — | Med | S | ✅ v1 (cheap with the events table) |
| P7 | **Share a routine with another user on the server** (copy, not a live link) | Hevy | Med | S | ✅ v1 |

### 4.3 Analytics and motivation

| # | Suggestion | Seen in | Value | Size | Rec. |
|---|---|---|---|---|---|
| A1 | **Weekly sets per muscle group vs. target range** (e.g. 10–20) with primary = 1, secondary = 0.5 | Hevy, JEFIT | High | M | ✅ v1 |
| A2 | **Muscle heat-map** on home, workout, exercise and stats | Hevy, Fitbod | High | M | ✅ v1 (already in the plan) |
| A3 | **Weekly streaks** (weeks meeting your goal, not daily streaks, which punish rest days) | Hevy | High | S | ✅ v1 |
| A4 | **Consistency heat-map** (GitHub-style year view) | Hevy | High | S | ✅ v1 |
| A5 | **Monthly report + Year in Review** (auto-generated summary page, shareable image) | Hevy | Med | M | 🕐 later |
| A6 | **Stalled-exercise detection** ("no progress on Bench in 5 sessions → consider a deload or a variation") | JEFIT | Med | S | ✅ v1 |
| A7 | **Recovery / freshness per muscle** (time since trained × volume) | Fitbod | Low | M | ✅ v1, as the simple version already in "current condition" |
| A8 | **Strength standards** (beginner…elite relative to body weight) | Fitbod, JEFIT | Low | M | 🕐 later |
| A9 | **Achievements / milestones** (100 workouts, 10 t lifted in a session, 100 km walked) | gamified apps | Low | S | 🕐 later |
| A10 | **Shareable workout summary image** | Hevy | Low | M | 🕐 later |

### 4.4 Body and general fitness

| # | Suggestion | Seen in | Value | Size | Rec. |
|---|---|---|---|---|---|
| B1 | **Body weight with a smoothed trend line** (exponential moving average, so daily noise is hidden) | MacroFactor, Hevy | High | S | ✅ v1 |
| B2 | **Body measurements** (waist, chest, arms, thighs…) + body fat % | Hevy, wger | Med | S | ✅ v1 |
| B3 | **Progress photos** (private, stored on your server, pose tags, side-by-side compare) | Hevy, wger | Med | M | 🕐 later |
| B4 | **Health Connect read**: steps, weight from smart scales, heart rate, workouts recorded by a watch | Fitbod, SparkyFitness | High | M | ✅ v1 (steps + weight) |
| B5 | **Health Connect write**: finished workouts and walks appear in other health apps | Hevy | Med | M | 🕐 later |
| B6 | **GPX/FIT auto-upload endpoint** for OpenTracks/FitoTrack/Garmin exports | Workout Tracker | Med | S | ✅ v1 |
| B7 | **Strava sync** (import walks, export workouts) | Hevy | Low | M | 🕐 later |
| B8 | **Daily step goal + step history** (from Health Connect) | Google Fit legacy | Med | S | ✅ v1 (with B4) |
| B9 | **Sleep / water / mood logging** (would make Motus a wellness app) | SparkyFitness | Low | M | ❌ skip for now (the data model allows it) |
| B10 | **Stretching / mobility routines** with timed holds | — | Med | S | ✅ v1 (just routines with timed sets) |

### 4.5 Data, platform and integrations

| # | Suggestion | Seen in | Value | Size | Rec. |
|---|---|---|---|---|---|
| D1 | **Import from Strong / Hevy / FitNotes CSV** with an exercise-name matching step (saved aliases) | Arvo, RepStack (migration tools) | High | S | ✅ v1 |
| D2 | **Strong-compatible CSV export** (other apps import it) | Strong | High | S | ✅ v1 (in the plan) |
| D3 | **Android home-screen widget**: next workout, streak, quick start | Strong, Liftin' | Med | M | 🕐 later |
| D4 | **App shortcuts** (long-press icon: "Start Chest Day", "Log walk", "Log weight") | — | Med | S | ✅ v1 |
| D5 | **Personal REST API with tokens** (your data, scriptable: Home Assistant, dashboards) | Hevy Pro, Workout Tracker | Med | S | ✅ v1 (API already exists; add personal tokens + docs) |
| D6 | **MCP server / "send to Claude"**: ask an LLM about your training history, export a workout as Markdown | Hevy | Med | S | 🕐 later |
| D7 | **Web-bundle live updates** (Capgo self-hosted) for JS-only fixes without a new APK | Capgo | Low | M | ❌ skip (the APK updater covers it) |
| D8 | **Obtainium-friendly releases** (documented fallback updater) | — | Med | S | ✅ v1 |
| D9 | **Passkeys** login | SparkyFitness | Med | M | 🕐 later |
| D10 | **OIDC / SSO** (Authelia, Authentik) for homelab users | SparkyFitness | Low | M | 🕐 later |
| D11 | **Biometric app lock** (Android) | Money Manager | Med | S | ✅ v1 |
| D12 | **Undo toast** after every change (Money Manager "Saved · Undo") | Money Manager | High | S | ✅ v1 |
| D13 | **Command palette** on desktop (Ctrl+K: start routine, find exercise, jump to a page) | — | Med | S | ✅ v1 |

### 4.6 Things deliberately not suggested
- **Social feeds and leaderboards.** These have little value on a personal server; P7 (sharing a
  routine) covers the useful part.
- **AI workout generation and AI form check.** They are expensive and low-trust, and the progression
  rules (P1) give the practical benefit.
- **Building GPS cardio analytics to Strava level.** Walk recording plus GPX import covers your needs.

### 4.7 Summary of recommended v1 additions

S1–S11 (except logging from the notification), S15, P1, P3, P6, P7, A1–A4, A6, A7, B1, B2, B4, B6, B8,
B10, D1, D2, D4, D5, D8, D11, D12, D13.

---

## 5. Technical research notes (used in PLAN.md)

### 5.1 Android self-update from GitHub Releases
- No mature plugin does this, so build a small custom Capacitor plugin.
- **Steps:**
  1. Download the APK to the app's cache.
  2. Verify its SHA-256.
  3. Install through `FileProvider` + `ACTION_VIEW`, or the `PackageInstaller` session API.
  4. If `canRequestPackageInstalls()` is false, send the user to "Install unknown apps" settings.
- **Requirements:** the `REQUEST_INSTALL_PACKAGES` permission, and the same signing key forever.
- **Limits:**
  - The user always confirms with one tap.
  - Google Play forbids self-updating. That's fine for GitHub distribution; a Play build would need
    the updater removed.
- The unauthenticated GitHub API allows 60 requests/hour per IP, so proxy the check through the
  server.

### 5.2 Desktop
electron-updater supports a GitHub provider, with Windows NSIS and Linux AppImage/deb/rpm. macOS needs
code signing to self-update. Money Manager already runs this setup.

### 5.3 Rest timer in the background
- Store the timer as an **end timestamp**.
- Schedule a `@capacitor/local-notifications` exact alarm.
- Android 12+ needs `SCHEDULE_EXACT_ALARM`. The user can revoke it, so re-check when the app resumes.
- `allowWhileIdle` is rate-limited to roughly 1 per 9 min in Doze, so use exact alarms instead.
- **Ongoing countdown:** a notification with `setUsesChronometer` + `setChronometerCountDown`, via a
  small native plugin.

### 5.4 GPS walks
- Use `@capacitor-community/background-geolocation` (MIT), which runs a foreground-service location
  watcher.
- Points arrive in JS, so **write them to SQLite immediately**.
- Start tracking from a visible user action (Android 14 rule).
- Ask for a battery-optimisation exemption, because OEM battery killers cause gaps in tracks.
- The paid Capawesome plugin adds a native queue, if this proves flaky.

### 5.5 Health Connect
- `@capgo/capacitor-health` (open source) reads steps, weight, heart rate and workouts. Its writes are
  limited.
- Background reads need an extra permission, so sync when the app is opened or through WorkManager.

---

## 6. Sources

- simplefitnessapp: https://github.com/basarsubasi/simplefitnessapp
- Hevy features: https://www.hevyapp.com/features/ · Live Activity: https://help.hevyapp.com/hc/en-us/articles/35649846517399 · Supersets: https://www.hevyapp.com/features/what-are-supersets/
- Strong: https://apps.apple.com/app/id464254577 · CSV template: https://repstack.pages.dev/tools/strong-csv-template/
- Fitbod recovery: https://help.fitbod.me/hc/en-us/articles/360006269014-Muscle-Recovery
- Boostcamp: https://www.boostcamp.app/best/gzcl
- Alpha Progression: https://alphaprogression.com/en/blog/periodize-your-training
- StrongLifts: https://stronglifts.com/app/
- MacroFactor Workouts: https://macrofactor.com/workouts/
- Health Connect sessions: https://developer.android.com/health-and-fitness/guides/health-connect/develop/sessions · Fit migration: https://developer.android.com/health-and-fitness/guides/health-connect/migrate/migration-faq
- Liftosaur: https://github.com/astashov/liftosaur · https://www.liftosaur.com/doc/liftoscript
- wger: https://github.com/wger-project/wger · https://wger.readthedocs.io/en/latest/administration/commands.html
- workout.cool: https://github.com/Snouzy/workout-cool
- LiftLog: https://github.com/LiamMorrow/LiftLog · Flexify: https://github.com/brandonp2412/Flexify · Ryot: https://github.com/IgnisDa/ryot
- Workout Tracker: https://github.com/jovandeginste/workout-tracker · FitTrackee: https://github.com/SamR1/FitTrackee · Endurain: https://github.com/endurain-project/endurain · OpenTracks: https://github.com/OpenTracksApp/OpenTracks
- free-exercise-db: https://github.com/yuhonas/free-exercise-db · ExerciseDB: https://github.com/ExerciseDB/exercisedb-api · Gym visual notice: https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/main/NOTICE.md · MuscleWiki terms: https://api.musclewiki.com/api-terms
- body-highlighter: https://github.com/lahaxearnaud/body-highlighter · react-body-highlighter: https://github.com/giavinh79/react-body-highlighter
- Capacitor local notifications: https://capacitorjs.com/docs/apis/local-notifications · background-geolocation: https://github.com/capacitor-community/background-geolocation · Capgo health: https://capgo.app/docs/plugins/health/
- electron-updater: https://www.electron.build/docs/features/auto-update · Tauri updater: https://v2.tauri.app/plugin/updater/
- Money Manager (sibling project `../moneymanager`): theme engine `frontend/src/core/theme.js`, appearance panel `frontend/src/components/AppearancePanel.vue`, live updates `frontend/src/live.js`, backups `server/src/backup.js`, release pipeline `.github/workflows/release.yml`
