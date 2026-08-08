# Coverage rationale

`pnpm coverage` reports a measured Node-side number (see
[`apps/tui/README.md`](../apps/tui/README.md#coverage) for the Node/Bun
split). This document is the honest companion to that number: it accounts,
concretely and line-by-line, for **every** thing the number does not cover, so
the percentage is never read as "100% of everything" and no gap is silent.

Each entry states the file, the specific lines/branches, what the code does, and
the concrete reason it is not unit-tested. Where the reason is "real behavior, not
yet tested," it says so and links the issue that will close it — it is not dressed
up as "unreachable."

Line numbers drift as files change; they are anchors, not contracts. Re-run
`pnpm coverage` for the live picture.

## 1. Excluded from instrumentation (not in the number at all)

These files are excluded in `vitest.config.ts`. They are not Node-unit-testable
surfaces, so instrumenting them would only report dead 0% and make the percentage
dishonest.

| File | Why excluded | What guards it instead |
| --- | --- | --- |
| `apps/tui/src/app.ts` | Self-executing Bun entry: top-level `await`, `prepareStartup`, openTUI renderer construction, `process.exit` startup glue. Never runs under Node's `vitest run`. | `pnpm dev` (manual) + the startup/keypress smokes for the wiring it delegates to; `prepareStartup` itself is unit-tested (`startup.test.ts`). |
| `apps/tui/src/mount-app.ts` | Bun-only openTUI wiring (`@opentui/core` import, keypress subscription, `requestRender`). Never runs under Node. | `pnpm smoke:tui` drives real `j`/`k`/`enter` through it on the real openTUI test renderer. |
| `apps/tui/src/smoke-openTui.ts` | The keypress Bun smoke harness itself. | It *is* the test; running it (`pnpm smoke:tui`) is the assertion. |
| `apps/tui/src/smoke-startup-openTui.ts` | The startup Bun smoke harness itself: drives `prepareStartup` + `mountApp` through the real openTUI renderer against an on-disk store. | It *is* the test; running it (`pnpm smoke:startup`) is the assertion. |
| `apps/tui/src/report.ts` | A `tsx` CLI script: a top-level `try/catch` that folds genesis + log (`loadFoldedReview`) and renders the already-tested composition report. No unit to assert beyond a `process.stdout.write`. | Its constituent functions are unit-tested directly (`loadFoldedReview` by `packages/event-store/src/event-store.test.ts`, `report-fold.test.ts`, `fund-composition.test.ts`). |
| `apps/tui/src/spine.ts` | The `tsx` Node tracer (`pnpm spine`): a top-level `try/catch` orchestrating already-tested `ingestInbox` / `loadFoldedReview` / `buildCompositionReport` / `formatCompositionReport`. Same script category — no unit to assert. | Its constituent functions are unit-tested (`ingestInbox` by `apps/tui/src/event-store.test.ts`, `loadFoldedReview` by `packages/event-store/src/event-store.test.ts`, `report-fold.test.ts`); the end-to-end path is also driven by `pnpm spine` / `pnpm smoke:startup`. |
| `apps/tui/src/spine-reset.ts` | A `tsx` dev iteration helper (`pnpm spine:reset`): clear the log, restore the most recent archived inbox. A throwaway utility, not product behavior — no unit to assert. | Manual: it exists to re-run `pnpm spine` against an edited inbox. |
| `apps/price-feed/src/cli.ts` | The `pnpm prices:fetch` entry (`tsx` script): top-level console reporting and exit-code wiring over `runPriceFetch` / `scanFetchedMarks`. Same script category as `spine.ts` — no unit to assert as written. | Its constituent functions are unit-tested directly (`runPriceFetch` by `fetch-prices.test.ts`, `scanFetchedMarks` by `rejection-check.test.ts`); the end-to-end path is also driven by the manual dry run in `docs/price-feed-ops.md`. |
| `apps/web/src/push/push.ts` | Self-executing `tsx` script (`pnpm push` / `db:init`): top-level `main().then(..., process.exit)` — argv + credential + `process.exit` wiring only. Importing it runs `main()`, so there is no unit to assert as written. Slice #127 extracted the two pieces worth asserting into the measured `push/push-core.ts` (see below), leaving this a thin wrapper. PRD #134 slice 2 then moved `push.ts` off the committed fixture onto `loadCurrentFold()` (the real fold of the durable log). | `push-core.ts` is measured: `deriveSnapshot` / `loadCurrentFold` by `push-core.test.ts`, the real upsert (`upsertSnapshot`) by the gated `push-core.integration.test.ts`. The DDL `push.ts` applies via `--init` / `--init-only` is the tested `readSchemaDdl()` from `provision.ts`. |
| `apps/web/src/push/push-core.ts` | **Measured**, not excluded — listed here only for the map. The importable, self-exec-free half of the push shell. | `deriveSnapshot` (pure report→derivation) and `loadCurrentFold` (the real genesis+log fold, via `@numisma/event-store` — the single entry point both `push.ts` and `backfill-core.ts` call, with no report-only wrapper beside it) are unit-tested (`push-core.test.ts`); `upsertSnapshot` (the real `ON CONFLICT ... DO UPDATE`) is exercised by the gated `push-core.integration.test.ts` against a throwaway Postgres. Statements/lines/functions measure 100% with or WITHOUT the test DB — `backfill-core.test.ts` runs `upsertSnapshot` through a fake pool, so the SQL executes but is never parsed by Postgres, and only the gated test proves the `ON CONFLICT` clause is real. Branches are 85.71%: the gap is `loadReserveFloorAsOf`'s no-policy arm. Spelled out rather than rounded up — same posture as `provision.ts`. |
| `apps/web/src/push/push-core.fixtures.ts` | Test-only fixtures extracted from `push-core.ts` when the push stopped publishing the committed fixture (PRD #134 slice 2): `FIXTURE_PATH` / `loadFixture` (the retired committed fixture, now a test input only) and `makeTempStore` (a throwaway data dir for exercising `loadCurrentFold` over a real log). Excluded via the repo's `**/*.fixtures.ts` glob. | Exercised by `push-core.test.ts` / `push-core.integration.test.ts`, the tests that import it — it is test infrastructure, not product code to measure. |
| `apps/web/src/projection/provision-projection.ts` | Self-executing `tsx` provisioning CLI (`pnpm db:provision`): top-level `main().then(..., process.exit)` over the tested `provision.ts` builders. Same script category as `push.ts` — no unit to assert as written. | Its pure inputs (`readSchemaDdl`, `buildGrantStatements`, `rolesFromEnv`, `assertValidRoleName`) are unit-tested (`provision.test.ts`); the DB-applying `provisionProjection()` it calls is exercised by the gated integration test (`provision.integration.test.ts`). |
| `apps/web/src/auth/apply-auth-schema.ts` | Self-executing `tsx` auth-schema applier (`pnpm auth:apply`): top-level `main().then(..., process.exit)` that reads the vendored `better-auth.schema.sql` and applies it idempotently to `AUTH_DATABASE_URL`. Same script category as `push.ts`. | The vendored artifact is generated by the pinned `@better-auth/cli@1.4.21`; idempotency (already-exists → no-op) is demonstrated in the provisioning runbook (`docs/projection-provisioning.md`). |
| `apps/web/src/auth/seed-account.ts` (slice #125) | Self-executing `tsx` single-tenant seed CLI (`pnpm auth:seed`): top-level `main().then(..., process.exit)` that writes the ONE account through Better Auth's internal adapter (`auth.$context`) keyed on `NUMISMA_SEED_EMAIL` (idempotent — a second run no-ops). Same script category as `apply-auth-schema.ts`; importing it runs `main()`, so there is no unit to assert as written. | The single-tenant invariant it exists to serve — server-side signup disabled (`emailAndPassword.disableSignUp`) with sign-in still enabled — IS asserted (`lib/single-tenant.test.ts`), along with the anonymous-leaks-nothing gate behavior. |
| `apps/web/src/projection/pg-substrate.testkit.ts` (via `**/*.testkit.ts`) | Test-only shared substrate helper: boots/points-at a throwaway Postgres, creates ad-hoc login roles, drops them. Test infrastructure, not product code. | Exercised by every integration test that imports it (`provision.integration.test.ts` now; slice #127's push tests next). It *is* the harness the assertions run through. |
| `apps/web/src/lib/auth.ts` | Better Auth **server** instance (ADR-008): constructs a `Pool` + `betterAuth({...})` at module load. Framework wiring with a module-level side effect; not a Node-unit-testable surface. | The auth seam is asserted through behavior in slice #124 (session gate / header forwarding). Slice #125 additionally asserts the resolved single-tenant config off the constructed instance — `auth.options.emailAndPassword` shows `enabled: true` + `disableSignUp: true` (`lib/single-tenant.test.ts`); that reads the already-built config, it does not instrument the module (the `Pool`/`betterAuth` wiring stays excluded). |
| `apps/web/src/lib/auth-client.ts` | Better Auth **browser** client factory (`createAuthClient()`). Browser-side framework wiring, no unit to assert. | Exercised by the login flow (single-tenant: signup is disabled, #125); behavior guarded by the auth slices (#124/#125). |
| `apps/web/src/lib/query.ts` | A single `new QueryClient()` export — TanStack Query wiring, no logic. | N/A — trivial framework construction. |
| `apps/web/src/routes/api/auth/$.ts` | TanStack Router file-route that mounts `auth.handler` on `/api/auth/*`. Route-registration wiring, no unit to assert. | The Better Auth handler behind it is third-party; the route is exercised end-to-end by the auth flows. |
| `apps/web/src/routeTree.gen.ts` | Generated by TanStack Router — not authored source. | N/A — regenerated from the route files. |

The `.tsx` render components (`SummaryCard`, `SectionTable`) and the route/router
`.tsx` files are **not** matched by the coverage include glob (`apps/*/src/**/*.ts`
matches `.ts`, not `.tsx`) — a deliberate posture recorded in §6, not an oversight.

## 2. Defensive / unreachable guards (kept on purpose, cannot be tested honestly)

These branches exist to make each function safe in isolation, but a prior check
in the real call path makes them unreachable. Testing them would require faking a
state the pipeline already excludes, so they are documented rather than tested.

**`packages/engine/src/parse.ts`**

- `validateNamedRecords` `!Array.isArray(value)` (~L148-150) — every caller
  (`portfolios` directly, plus `validateAccounts` / `validateInstruments`) only
  runs after the top-level `requiredArrays` loop has already confirmed the value
  is an array.
- `validateReserves` `!Array.isArray(value)` (~L233-235) and `validatePositions`
  `!Array.isArray(value)` (~L261-263) — `reserves` and `positions` are both in
  the same top-level `requiredArrays` check, so these are unreachable from
  `parseFundReview`.
- `validateCapitalRecordIds` `if (!isRecord(record) || typeof record.id !==
  "string") continue` (~L415-417) — by the time this runs, every reserve and
  position has passed `validateCapitalRecordShape`, which already required a
  record carrying a non-empty string `id`.
- `parseReviewInput` invalid-json catch, `error instanceof Error ? error.message
  : String(error)` false branch (~L448) — `JSON.parse` only throws `SyntaxError`
  (an `Error`), so the `String(error)` fallback never runs.

**`apps/tui/src/review-file.ts`**

- `normalizeLoadFundReviewError` `error instanceof Error ? error : new
  Error(String(error))` false branch (~L108) — the only throwers reaching it
  (`readFile`, `parseFundReviewError`) throw `Error` instances; the
  non-`Error` fallback is a defensive coercion. (The `ENOENT`/`EISDIR`/`EACCES`
  branches above it *are* tested, the last one skipped only when running as
  root — see `review-file.test.ts`.)

**`packages/engine/src/compose/canonical.ts`**

- `buildCanonicalState` Reserve `portfolioLabel` fallback
  `portfolios.get(reserve.portfolioId)?.name ?? reserve.portfolioId` (~L176) and
  the Position `portfolioLabel` fallback (~L339) — both run only after
  `validateCapitalBase` has already excluded any record whose `portfolioId` is
  missing, so `portfolios.get(...)` always resolves and the optional-chain /
  `?? id` miss is unreachable.
- `accountLabel` `account ? … : fallback` false branch (~L436) — same reason:
  `validateCapitalBase` excludes any record with a missing `accountId`, so every
  record that reaches `accountLabel` has a resolved Account.

**`packages/engine/src/format.ts`**

- `sectionRows` `?.rows ?? []` miss (~L153) — the five composition sections are
  always present in the report, so `.find(...)` never returns undefined and the
  `?? []` fallback is unreachable from `formatCompositionReport`.

**`apps/tui/src/dashboard.ts`**

- `emptyDetailMessage` Tempo branch (~L345-346) and Account branches
  (~L348-350) — `emptyDetailMessage` is reached only when a drill-down's detail
  body is empty, and only a Portfolio drill-down can be empty (it filters to
  Positions, so a Portfolio holding only Reserves yields no rows). A Tempo row
  exists only because a line carries that Tempo, and an Account row only because
  a line carries that Account, so their drill-downs are never empty and these
  messages never render. The Portfolio branch (~L342-343) *is* tested
  (`dashboard.test.ts`).

## 3. Low-value presentation branches

**`packages/engine/src/price-journey.ts`** (100% lines) — the journeys sort
comparator's `|| a.label.localeCompare(b.label)` tie-break (~L104 branch) runs
only when two journeys have equal point counts. A tie-break ordering detail; not
worth a crafted multi-journey fixture this increment.

## 4. Real, reachable behavior — closed by #72

The behavior previously parked here (compose-engine warnings/exclusions,
drill-down filtering, and the dashboard renderer's empty-state / tier-expansion /
title branches) was **not** defensive and **not** low-value — shippable behavior
a regression could break while the suite stayed green. It is now unit-tested:

- **`packages/engine/src/compose/canonical.ts`** (100% lines) — Reserve
  missing-reference exclusion, Position `unsupported-execution-mode`,
  Account/Instrument `currency-mismatch`, Lot-level invalid-numeric warnings
  (quantity/cost/`entryFx`, plus the empty-`lots` guard for non-parse callers),
  and `detailLinesForRow` portfolio/tempo/account drill-down filtering — across
  the `fund-composition-*.test.ts` suite (`fund-composition-warnings.test.ts`,
  `fund-composition-dashboard.test.ts`). (`parseFundReview` rejects empty `lots`,
  so that one guard is exercised through the public `buildCompositionReport` with
  a directly-built `FundReviewData`, the same way the TUI tests do.)
- **`apps/tui/src/dashboard.ts`** (100% branches) — empty-section "No live
  records." rows, the Portfolio empty-detail message, typed vs untyped detail
  columns, zero-denominator tier-table guards, and the `detailTitle` /
  summary-focus placeholder branches — all in `dashboard.test.ts`.
- **`packages/engine/src/format.ts`** (100% lines) — the `formatRowFocus`
  "No live records" placeholder, the `formatDataSafety` "no warnings" string,
  and the empty-section body — across the `fund-composition-*.test.ts` suite.

What remains uncovered after #72 is only the §2 defensive guards and the §3
tie-break — each listed there with a concrete reason.

## 5. Event-sourcing spine (ADR-003) — newly added

The engine event modules (`events/*.ts`) and the durable event-store are the
persistence spine added in the portfolio-history increment, and the remainder
across both is **real, reachable behavior that is partially — not yet
exhaustively — covered**. It is listed here honestly, not dressed up as
unreachable; closing it is a follow-up, tracked against the spine's
reliable-conversion work.

PRD #134 slice 1 split the event-store's *read path* — path resolution,
genesis load, log load with quarantine, `loadFoldedReview` — out of
`apps/tui/src/event-store.ts` into the new **`@numisma/event-store`** package
(`packages/event-store/src/event-store.ts`), so `apps/web`'s push can fold the
durable log without depending on the TUI. `apps/tui/src/event-store.ts` now
holds only the write/ingest half (`ingestInbox`, `migrateLegacyLog`, inbox
archival, magnitude-threshold env plumbing, `parseAsOfArg`); its read-path unit
tests moved with the code into `packages/event-store/src/event-store.test.ts`.

- **`packages/engine/src/events/*.ts`** (91% lines, measured) — the covered core is the
  fold itself (`events/fold.ts`) and the ingest cross-reference
  (`events/crossref.ts`), exercised by `event-ingest.test.ts` and `fold.test.ts`.
  Uncovered: several **per-field `parseEvent` rejection branches** in
  `events/parse.ts` (e.g. the individual `position.*` non-empty-string /
  `executionMode` / `direction` / `currency` errors and the per-lot shape errors)
  — the validator is exercised, but not every individual malformed-field fixture
  exists yet; plus two real branches in `events/fold.ts` — a `PriceMarked`
  carrying `usdMxn` updating the fold's FX (~L223), and the zero-`totalQuantity`
  guard in the weighted-average helper (~L281).
- **`packages/event-store/src/event-store.ts`** (the read path, 96% lines) — the
  covered core is `loadEventLog`'s quarantine handling and `loadFoldedReview`'s
  fail-loud fold, exercised by `packages/event-store/src/event-store.test.ts`.
  Uncovered: `loadGenesis`'s validation-failure throw (a corrupt `genesis.json`,
  defensive) and `readOptional`'s non-`ENOENT` rethrow (an unexpected fs error
  the call path does not otherwise produce — defensive).
- **`apps/tui/src/event-store.ts`** (the write/ingest path, 89% lines) — the
  covered core is the validated ingest boundary, dedup, atomic append, archive,
  and quarantine (`event-store.test.ts`). Uncovered: the inbox **invalid-JSON**
  and **non-array** rejection throws, and the `--as-of=<date>` (equals-form) arg
  variant (the space-separated form is tested). The file's measured percentage
  dropped from the pre-split ~94% because the read path it used to also contain
  was more thoroughly covered; splitting it out left a higher proportion of this
  file's remaining lines in less-exhaustively-tested rejection branches
  (`migrateLegacyLog`'s abort paths, the ingest-commit-capture warn branch) —
  real, reachable behavior, not yet individually itemized here.

`startup.ts` is at 100% (`startup.test.ts`).

## 6. `apps/web` coverage posture (PRD #121 / slice #122)

Slice #122 brings `apps/web` into the repo's co-located `*.test.ts` convention.
Before it, `apps/web` matched the coverage include glob (`apps/*/src/**/*.ts`) with
zero tests, so it reported a dishonest 0%. This section is the committed decision
for what that number measures.

**Measured (`.ts`, under the number):**

- **`apps/web/src/projection/contract.ts`** — the single writer/reader source of
  truth (ADR-007). Fully exercised by `contract.test.ts`: `getLatestSnapshot`
  empty/stale/ok arbitration and the real version comparison against
  `COMPOSITION_SNAPSHOT_SCHEMA_VERSION` (pg pool mocked, arbitration not stubbed);
  `fundIdOf` slug derivation across casing, punctuation runs, and
  leading/trailing separators; and the lazy `getReaderPool()` singleton (missing
  env throws, lazy construction memoizes, injected stub short-circuits) via the
  test-only `setReaderPoolForTests()` seam. That seam resets/injects the
  module-level `readerPool` so no pool leaks between tests; production lazy
  construction from `PROJECTION_DATABASE_URL` is unchanged.
- **`apps/web/src/lib/dashboard.ts`** — the session-gated read server function.
  Left **measured, not excluded**: it is real, reachable behavior, not dead
  weight. **Slice #124** factored the gate's core into `loadDashboard`, whose
  request headers, auth surface, and snapshot reader are INJECTED dependencies
  (`SessionGateDeps`). `dashboard.test.ts` drives that seam for real: authenticated
  session → snapshot; no session → `/login` redirect (zero-byte body); and the
  header-forwarding regression — an injected `auth` whose `getSession` outcome
  depends on the forwarded cookie, so the incoming request cookie must actually
  reach `auth.api.getSession({ headers })` (a dropped/blank cookie fails the test,
  the assertion a stubbed session return cannot make). `loadDashboard` is fully
  covered (100% branch/func). The remaining uncovered lines are the thin
  `getDashboard = createServerFn(...).handler(...)` wrapper that wires the real
  `getRequest()` / `auth` / `getReaderPool()` into `loadDashboard` — framework
  wiring that needs the TanStack Start server runtime, in the same category as the
  §1 excluded wiring but kept measured here so the covered core is visible.
- **`apps/web/src/projection/provision.ts`** (slice #123, ADR-010) — the ADR-007
  grant-provisioning source of truth. Pure builders (`readSchemaDdl`,
  `buildGrantStatements`, `assertValidRoleName`, `rolesFromEnv`) and the
  schema.sql grants/DDL-separation guard are unit-tested (`provision.test.ts`);
  the DB-applying `provisionProjection()` is exercised by the gated integration
  test (`provision.integration.test.ts`), which asserts the real 8/8 credential
  invariants against a throwaway Postgres. With the test DB present, `provision.ts`
  is 100% covered; without it, `provisionProjection()`'s two `pool.query` lines
  show uncovered (the integration test skips) — flagged honestly, not hidden. The
  thin CLI (`provision-projection.ts`), the self-executing auth applier
  (`apply-auth-schema.ts`), and the shared test substrate
  (`pg-substrate.testkit.ts`, via the `**/*.testkit.ts` exclude) are excluded per
  §1.

- **`apps/web/src/push/push-core.ts`** (slice #127; real fold since PRD #134
  slice 2) — the importable, self-exec-free half of the push shell, extracted
  from `push.ts` so the derivation and the real upsert are assertable without
  running the script. `deriveSnapshot` (report → `fundId` / `asOf` /
  `schemaVersion`, delegating to the shared contract) is unit-tested
  (`push-core.test.ts`, no DB). `loadCurrentFold` — the real fold of the
  durable log (resolve event-store paths via `@numisma/event-store`, fold
  genesis + `events.jsonl`, `buildCompositionReport`), returning the fold
  alongside the report and called directly by both `push.ts` and
  `backfill-core.ts` — is also unit-tested there against a throwaway on-disk store built by the
  coverage-excluded `push-core.fixtures.ts`; the retired committed fixture
  (`FIXTURE_PATH` / `loadFixture`) now lives in that same fixtures module as a
  test input only, no longer read by the push itself. `upsertSnapshot` — the
  exact `INSERT ... ON CONFLICT (fund_id, as_of) DO UPDATE` the script runs — is
  exercised by the gated `push-core.integration.test.ts`: two pushes of the same
  key yield exactly one row with `pushed_at` refreshed and `report` /
  `schema_version` updated (no delete, no duplicate), pushed through the WRITER cred
  on the #123 throwaway-Postgres substrate. Measured 100% statements / 100% lines
  / 100% functions EVEN WITH THE TEST DB ABSENT, which is not the reassurance it
  looks like and is why the number is spelled out: `backfill-core.test.ts` drives
  `upsertSnapshot` through a fake pool, so the SQL string is executed but never
  parsed by Postgres. Only the gated integration test proves the `ON CONFLICT`
  clause is valid and idempotent against a real server; a green line count here
  says the branch ran, not that the statement is correct SQL. Branches sit at
  85.71%, the one gap being `loadReserveFloorAsOf`'s no-policy-in-effect arm
  (`pickPolicyAsOf(...)?.reserveTargetPct` returning `undefined`) — R1's absent
  floor, asserted at the reader instead (`verdict.test.ts`'s R5 case). The blast
  radius this real fold opens — `apps/web` now depends on `@numisma/event-store`,
  the reader for the whole private event log — is guarded structurally, not by
  a coverage number: `apps/web/src/event-store-import-guard.test.ts` asserts no
  `apps/web` source file outside `src/push/` imports that package.

**Excluded (`.ts` dead weight — see §1 table):** `push/push.ts` (self-executing
script — now a thin argv/credential wrapper over the measured `push-core.ts`) and
`auth/seed-account.ts` (self-executing single-tenant seed script), `lib/auth.ts` /
`lib/auth-client.ts` / `lib/query.ts` / `routes/api/auth/$.ts` (framework wiring
with module-level side effects, not Node-unit-testable), and `routeTree.gen.ts`
(generated). Each would otherwise be dishonest 0%.

**Single-tenant gate (slice #125, ADR-007):** `lib/single-tenant.test.ts` asserts
the two invariants without new instrumented product code. (1) Self-service signup
is disabled at the server — `auth.options.emailAndPassword` shows `enabled: true`
+ `disableSignUp: true`, read off the already-constructed `auth` instance (the
`/signup` route and its login-page link are deleted). (2) An anonymous visitor
leaks nothing — it drives the slice #124 `loadDashboard` seam with an `auth`
whose `getSession` returns null and asserts the `/login` redirect (zero-byte
body) with `getSnapshot` never called. The deterministic seed that establishes
the one account (`auth/seed-account.ts`, `pnpm auth:seed`) is an excluded
self-executing script (above).

**`.tsx` render components — documented exclusion, not RTL (Open Question
resolved):** `SummaryCard` and `SectionTable` (and the route/router `.tsx` files)
are outside instrumentation because the include glob is `*.ts`, not `*.tsx`. This
is deliberate: they render already-tested engine data (`@numisma/engine/format` +
the four dashboard types, whose formatting is locked by
`packages/engine/src/format.test.ts`), and the `CompositionReport` type import in
`contract.ts` is the compile-time drift guard for their inputs.

**They are no longer *pure* render surfaces, and this paragraph used to say they
were.** PRD #146 gave both a decision to make: whether a number may be shown at
all. `SummaryCard` gates the fund value and the unrealized P&L on
`fundValueRendered`, and `SectionTable` gates the `% of fund` column on
`percentOfFundRendered` and every cell on its row's `RowView`. That is exactly the
kind of logic an uninstrumented file hides — review finding 1 was an unguarded
`SummaryCard` printing a NAV the glance refused to show, and no coverage number
would have caught it, because the file reports none.

What compensates is **not** the coverage glob but the source-level assertions in
`glance/row-view.test.ts` (and `routes/route-move.test.ts`): the decisions
themselves live in the pure, fully instrumented `glance/row-view.ts`, and the tests
assert that the components actually consult them. That is a weaker guarantee than
rendering the component, and it is named here rather than implied — it catches a
surface silently reverting to the raw payload; it cannot catch a layout mistake or
a wrong branch inside JSX. **The reader must open the page to judge that.**

This increment still does **not** add a React Testing Library toolchain (jsdom +
RTL + the react vite plugin in the test path) — the reliability payoff does not
yet justify the toolchain weight and maintenance surface, and the decisions worth
asserting were extractable to `.ts` instead. But the honest trigger below has
moved closer: a third component gating on suppression, or any branch that cannot
be lifted into a pure module, should buy the toolchain rather than widen this
exemption again. Mirrors the
`apps/tui/src/app.ts` Bun-only split: instrument what Node's `vitest run` actually
executes, and account for the rest here rather than reporting dead 0%. If a later
slice adds interactive `.tsx` behavior (sort/filter/drill-down — all D4 non-goals
today), it revisits this and adds RTL for that component.

## What this number means

After this pass, every Node module's *meaningful, reachable* behavior is
unit-tested, with the explicit exception of the §5 event-sourcing spine
remainder — real behavior that is partially covered and flagged as such, not
hidden. §1–§3 account, concretely, for everything else outside the number, and §5
names what the spine still leaves open. "Reliable" here means *measured and
accounted for* — not "100% of everything," and explicitly not covering the
Bun-only wiring.
