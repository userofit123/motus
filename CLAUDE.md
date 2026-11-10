# Motus: working notes

## Task queue
The chat message "Work the queue" means: read and follow `workflow/RUNNER.md` (tasks from the Focus list "Motus", account "Server"). Otherwise tasks come from the chat as usual.

Self-hosted fitness tracker. Plan: PLAN.md (decisions in §16, anti-bloat rules in §10.0). Research: RESEARCH.md.

## Layout
- `packages/engine`: all data logic (handlers, SQL migrations, row-level security). Runs on PostgreSQL (server) and PGlite (apps, tests).
- `packages/shared`: types and pure logic shared by everything (units, training maths, settings, features, templates).
- `apps/server`: Fastify around the engine: sign-in, sessions, admin, SSE live updates, media.
- `apps/web`: Vue 3 + TypeScript UI. Two shells (desktop rail, phone tabs) sharing pages. Look ported from Money Manager.
- `apps/desktop`: Electron (local accounts run the server inside the app). `apps/android`: Capacitor.

## Rules
- **Consistency first (top rule, the developer rejects any break).** Every visible element looks and behaves like its siblings and the app's existing equivalents: same row layout (label left, control right), same left edge and indents, same control type for the same kind of value, same spacing between equal blocks, same alignment (centred blocks stay centred), same wording style. Before finishing UI work, compare it element by element with its neighbours on the same screen and the most similar existing screen, at phone (360px) and desktop width. Every visual change gets a separate design review before it is done; an inconsistency is a failure, never a minor note.
- Clean by default (PLAN.md §10.0): one primary button per screen; secondary actions in ⋮ menus; optional features off and absent until switched on in Settings → Features.
- Styles only through the theme tokens (`--acc`, `--s1`, `--tx2`, …); never hard-coded colours.
- Every change announces what it touched (`ctx.changed(...)`, topics in `packages/shared/src/live.ts`) so all screens update live.
- Every user-owned table has `user_id` and a row-level-security policy (migration 002). References to other rows go through `visible()`.
- Weights are stored in kg and distances in metres; convert only for display.
- Plain wording in the UI. Comments say why.
- Only plain dashes "-" in the UI (ranges "8-12", empty values "-"), never "–" or "—".
- Design quality: new screens and blocks match the app's existing visual language. Study a similar screen first and reuse its cards, stat tiles with icons, rings and bars, the muscle figure, badges and charts; give numbers a clear value/label hierarchy and show state visually (done, PR, trend). A block that is only lines of text is not finished. Clean and minimal, never bare.
- Dot separators ("Legs · 5") always have equal space on both sides: in text " · " with single spaces; in a flex row the dot is its own element (`<span class="sep">·</span>`) so the row's gap spaces it, never "· 5" as one item next to a gap.
- Spacing inside blocks comes from the density tokens (`--cpy`, `--cpx`, `--lpy`, `--lmh`, `--tdy`) and between blocks from `--spg` / `--hg`; no fixed paddings on cards, rows or sections.
- Cards that show the muscle figure (routine, template, program day, exercise) use the Routines list's routine card as the template - figure on the left, info on the right, never the figure above the info; change the other card to match, never the routine card: `<BodyMap class="rbody" :values="{}" :highlight="muscles" :secondary="helpers" />` as the card's first child, card gets class `wbody` (styles in app.css); main muscles = every exercise's primary ones, helpers = secondary ones that are nobody's main.

## Develop
- `docker compose -f docker-compose.dev.yml up -d` → https://motus.local (see docs/development.md).
- Run pnpm through the container: `./scripts/pnpm.sh …` (e.g. `./scripts/pnpm.sh --filter @motus/engine test`).
- Release: `node scripts/bump.mjs x.y.z`, fill in CHANGELOG.md, push to main.
