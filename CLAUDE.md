# Motus: working notes

Self-hosted fitness tracker. Plan: PLAN.md (decisions in §16, anti-bloat rules in §10.0). Research: RESEARCH.md.

## Layout
- `packages/engine`: all data logic (handlers, SQL migrations, row-level security). Runs on PostgreSQL (server) and PGlite (apps, tests).
- `packages/shared`: types and pure logic shared by everything (units, training maths, settings, features, templates).
- `apps/server`: Fastify around the engine: sign-in, sessions, admin, SSE live updates, media.
- `apps/web`: Vue 3 + TypeScript UI. Two shells (desktop rail, phone tabs) sharing pages. Look ported from Money Manager.
- `apps/desktop`: Electron (local accounts run the server inside the app). `apps/android`: Capacitor.

## Rules
- Clean by default (PLAN.md §10.0): one primary button per screen; secondary actions in ⋮ menus; optional features off and absent until switched on in Settings → Features.
- Styles only through the theme tokens (`--acc`, `--s1`, `--tx2`, …); never hard-coded colours.
- Every change announces what it touched (`ctx.changed(...)`, topics in `packages/shared/src/live.ts`) so all screens update live.
- Every user-owned table has `user_id` and a row-level-security policy (migration 002). References to other rows go through `visible()`.
- Weights are stored in kg and distances in metres; convert only for display.
- Plain wording in the UI. Comments say why.

## Develop
- `docker compose -f docker-compose.dev.yml up -d` → https://motus.local (see docs/development.md).
- Run pnpm through the container: `./scripts/pnpm.sh …` (e.g. `./scripts/pnpm.sh --filter @motus/engine test`).
- Release: `node scripts/bump.mjs x.y.z`, fill in CHANGELOG.md, push to main.
