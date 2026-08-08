# @numisma/web

The hosted read-projection dashboard — a phone-checkable view of fund
composition, backed by a disposable Postgres projection of the local event
log. Built on **TanStack Start** (Vite-based full-stack React), chosen over
Next.js in ADR-009. Package name `@numisma/web`, version tracks the monorepo
root (`0.8.0`). Deployed to Vercel as project `numisma-web`; see
`docs/web-deploy-runbook.md` for the deploy mechanism.

## What this app owns

- **The dashboard**: reads the `composition_snapshot` projection table
  (read-only credential) and renders it behind a session gate.
- **The push shell**: a one-way, local-to-cloud sync of the folded
  `CompositionReport` (never the raw event log) into the projection DB.
- **The auth server**: Better Auth (email/password, single-tenant, no
  self-service signup) with its own separate `numisma_auth` Postgres store.
- **Projection provisioning**: idempotent, driver-only DDL + grants for the
  projection DB (no `psql`).

This app does **not** run `@numisma/engine`'s fold in the cloud — folding
happens locally against `NUMISMA_DATA_DIR` (default `~/Dev/<fund>/data`);
only the derived report is pushed. It does not read or write the raw event
log at request time, and it never holds a write credential to the projection
DB at runtime.

## Runtime / framework

- **TanStack Start** (`@tanstack/react-start`) + **TanStack Router** +
  **TanStack Query** + **TanStack Table**, on **Vite** with the **Nitro**
  server, `preset: "vercel"` (`apps/web/vite.config.ts`). `vite build` emits
  a Vercel Build Output API v3 artifact at `apps/web/.vercel/output`.
- **React 19**, **Node ≥24** (root `package.json` `engines`), **pg** 8.x for
  raw Postgres access (no ORM).
- **Better Auth** 1.6.23 for the auth server; schema managed by the pinned
  `@better-auth/cli@1.4.21` (vendored, checked-in SQL — see
  `docs/projection-provisioning.md`).

## Route map

Five routes, all under `src/routes/` (file-based, `routeTree.gen.ts` is
generated and committed):

| Route | File | Behavior |
| --- | --- | --- |
| `__root` | `src/routes/__root.tsx` | Shell: `<html>`, `QueryClientProvider`, TanStack Router `Scripts`. |
| `/` | `src/routes/index.tsx` | **Triage/glance surface** (D11): "does anything need me before I next sit at the desk?" Session-gated loader (`getDashboard`); redirects to `/login` if unauthenticated. |
| `/big-picture` | `src/routes/big-picture.tsx` | The full composition dashboard (summary + section tables) — moved here from `/` by the D11 route move. Same session-gated loader. |
| `/login` | `src/routes/login.tsx` | Email/password sign-in only. No signup link, no `/signup` route — single-tenant (ADR-007). Navigates to `/` on success. |
| `/api/auth/$` | `src/routes/api/auth/$.ts` | Catch-all mounting Better Auth's handler (`auth.handler`) for `GET`/`POST`. |

There is no change-password screen and no client call to one — see
`docs/hosted-cutover-runbook.md` step 6 for the password-rotation procedure
(delete-and-reseed, not a UI flow).

## Read-projection data flow

The projection DB (`composition_snapshot`, one row per `(fund_id, as_of)`)
is a **disposable, re-projectable view** (ADR-007) — never a system of
record. The event log stays local and canonical.

- **`pnpm push`** (`src/push/push.ts` → `push-core.ts`) — folds the real
  durable event log into a `CompositionReport`, narrows it to the
  ADR-007/D8 allow-listed `ProjectionReport` shape (`totals`, `dashboard`,
  `glance` — never raw theses, risk budgets, or stop levels), and upserts
  one row via `ON CONFLICT (fund_id, as_of) DO UPDATE` using
  `PROJECTION_WRITE_DATABASE_URL`. No fixture path, no flag to fall back to
  one.
- **`pnpm backfill`** (`src/push/backfill.ts` → `backfill-core.ts`) —
  replays every anchored date in the log into the projection DB. Idempotent,
  zero-argument (enumerates the log's own dates). Also produces the replay
  fixture (`--fixture` / `--fixture-only`) used by tests.
- **`pnpm gap-report`** (`src/push/gap-report.ts` → `gap-report-core.ts`) —
  reports days missing from the log against a calendar floor/ceiling.
  Requires no environment (no DB URL, no data-dir var). Exit 0 even when
  days are lost (a lost day is reported, not a failure); exit 1 only on a
  malformed run.
- **`pnpm db:init`** (`push.ts --init-only`) — applies only the
  `composition_snapshot` DDL (no fold, no upsert), for bootstrap/recovery
  without depending on the durable log being populated.
- **`pnpm db:provision`** (`src/projection/provision-projection.ts` →
  `provision.ts`) — idempotent DDL + the ADR-007 two-role grants
  (`numisma_push`: SELECT/INSERT/UPDATE, no DELETE; `numisma_web`: SELECT
  only), applied through the pg driver with the one-shot
  `PROJECTION_ADMIN_DATABASE_URL`. See `docs/projection-provisioning.md`.

The dashboard reader (`src/lib/dashboard.ts` → `src/projection/snapshot-reader.ts`
for the values, with `src/projection/contract.ts` supplying the pg-free contract
types) runs server-side only, behind the Better Auth session gate, using the
read-only `PROJECTION_DATABASE_URL`. The read credential and `pg` import
never reach the client bundle — enforced structurally by TanStack Start's
`createServerFn` compilation and asserted by
`src/client-bundle.integration.test.ts` against the built output.

## Auth setup

`src/lib/auth.ts` configures Better Auth: email/password only,
`disableSignUp: true` (single-tenant — the one account is seeded, not
self-registered), DB-backed rate limiting (`storage: "database"`, global
60/min + `/sign-in/email` at 10/5min), no lockout (deliberate — see
ADR-011 D5), and a 30-day rolling session. It owns a separate `numisma_auth`
Postgres via `AUTH_DATABASE_URL`, disjoint from the projection DB (ADR-008).

`package.json` scripts:

| Script | What it does |
| --- | --- |
| `auth:generate` | Regenerates the vendored `src/auth/better-auth.schema.sql` via the pinned `@better-auth/cli@1.4.21`, from `src/lib/auth.ts`. Run against an empty DB, then commit the file. |
| `auth:apply` | Applies the vendored, checked-in schema SQL to `AUTH_DATABASE_URL` (`src/auth/apply-auth-schema.ts`). Idempotent — the checkout-independent first-time-setup step. |
| `auth:migrate` | The CLI-driven alternative to `auth:apply` (also pinned to `1.4.21`). |
| `auth:seed` | Deterministic, idempotent single-account seed (`src/auth/seed-account.ts`), from `NUMISMA_SEED_EMAIL` / `NUMISMA_SEED_PASSWORD` / `NUMISMA_SEED_NAME`. Writes through Better Auth's internal adapter, not the (disabled) HTTP signup route. |
| `auth:verify-limit` | Attacks `/sign-in/email` with wrong-password attempts against a `.invalid` probe address until it observes an HTTP 429 (`src/auth/verify-rate-limit.ts`). Exit 0 only on an observed 429. Must be run against a real deployment (localhost/preview cannot prove the counter is DB-shared) — see `docs/hosted-cutover-runbook.md` step 7. |

## Security posture (ADR-011 — single-tenant)

- Exactly one seeded account; open self-service signup is rejected at the
  auth server.
- No account lockout, by design — with one account, lockout hands an
  anonymous attacker a permanent denial of service. Rate limiting alone
  degrades attacker throughput without ever fully closing the owner's door.
- Rate-limit counters are DB-backed (`numisma_auth."rateLimit"`), not
  in-memory — required because Vercel serverless instances don't share
  memory.
- Split credentials enforce a structural one-way guarantee: the deployed
  app never holds a write credential to the projection DB
  (`PROJECTION_WRITE_DATABASE_URL` and `PROJECTION_ADMIN_DATABASE_URL` are
  local/operator-only, never set in the Vercel project).
- Production is publicly reachable; previews carry Vercel Deployment
  Protection and hold **no** environment variables (build/compile smoke
  checks only, since the 2026-07-25 git-push deploy cutover).
- Secret rotation is trigger-based (an event that changes who could have
  seen a credential), not calendar-based.
- Full operational detail, the credential inventory, and the panic levers:
  `docs/hosted-cutover-runbook.md`. The provisioning mechanism and its
  automated 8/8 credential-invariant probe:
  `docs/projection-provisioning.md`.

## Environment variables

See `apps/web/.env.example` for the authoritative, commented list. Summary:

| Var | Used by | Scope |
| --- | --- | --- |
| `PROJECTION_DATABASE_URL` | Dashboard reader | Runtime — deployed app (Production only) |
| `AUTH_DATABASE_URL` | Better Auth | Runtime — deployed app (Production only) |
| `BETTER_AUTH_SECRET` | Better Auth | Runtime — deployed app (Production only) |
| `BETTER_AUTH_URL` | Better Auth | Runtime — deployed app (Production only) |
| `PROJECTION_WRITE_DATABASE_URL` | `push`, `backfill`, `db:init` | Local/operator only — never in the web project's env |
| `PROJECTION_ADMIN_DATABASE_URL` | `db:provision` | One-shot, local/operator only |
| `PROJECTION_WRITER_ROLE` / `PROJECTION_READER_ROLE` | `db:provision` | Optional, default `numisma_push` / `numisma_web` |
| `NUMISMA_SEED_EMAIL` / `NUMISMA_SEED_PASSWORD` / `NUMISMA_SEED_NAME` | `auth:seed` | Local/operator only |
| `AUTH_VERIFY_BASE_URL` | `auth:verify-limit` | Local/operator only — **set it, or the run proves nothing** (defaults to `http://localhost:3000`) |
| `NUMISMA_DATA_DIR` | `push`, `backfill` (via `@numisma/engine`) | Should stay **unset** in production use — defaults to `~/Dev/<fund>/data` |

## Tests

Colocated `*.test.ts` under `src/`, run by the root `pnpm test` (Vitest).
Notable groups:

- `src/projection/*.test.ts`, `src/push/*.test.ts` — provisioning,
  push/backfill/gap-report core logic, and the ADR-007 payload allow-list
  (`projection-payload.test.ts`).
- `src/projection/provision.integration.test.ts`,
  `src/push/*.integration.test.ts` — gated on `NUMISMA_TEST_DATABASE_URL`;
  skip loudly without a real Postgres, run in CI (`.github/workflows/ci.yml`)
  against a Postgres service container.
- `src/auth/*.test.ts` — auth config invariants and the rate-limit verifier
  core.
- `src/lib/single-tenant.test.ts`, `src/lib/dashboard.test.ts` — the
  session gate (redirect-and-never-read-the-snapshot for anonymous
  visitors) and dashboard loader.
- `src/client-bundle.integration.test.ts` — scans the **built**
  `.vercel/output/static` assets for leaked server-only tokens (the pg
  driver, connection strings, `BETTER_AUTH_SECRET`, the table name). Skips
  on an unbuilt tree; runs in CI after `pnpm --filter @numisma/web build`.
- `src/routes/route-move.test.ts` — source-level assertions that `/` is the
  glance and `/big-picture` carries the composition tables (D11), since
  this repo has no render-testing toolchain by decision.
- `src/event-store-import-guard.test.ts`,
  `src/preferences-import-guard.test.ts` — confine privileged local-disk
  reads to the push path, keeping the render surface from reaching them.

Run from the repo root: `pnpm test` (root Vitest config, `vitest.config.ts`,
picks up every workspace `*.test.ts` including these). There is no
per-package `test` script in `apps/web/package.json`.

## Related docs

- `docs/web-deploy-runbook.md` — how this app deploys (git-push primary,
  prebuilt CLI fallback).
- `docs/projection-provisioning.md` — the provisioning mechanism and its
  credential invariants.
- `docs/hosted-cutover-runbook.md` — the one-time console checklist for
  taking this app from merged to live with real data.
- ADR-007, ADR-008, ADR-009, ADR-010, ADR-011 (`context/adr/`) — the
  decisions this app implements.
