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
| `apps/tui/src/import-orders-cli.ts` | The `pnpm orders:import` entry: WIRING ONLY — it binds the real `readFile`, the real orders sidecar path, the real fold (`loadFoldedReview`) and a real readline prompt to `importBitgetOpenOrders`, which holds the flow and every refusal. Importing this file *runs the import* (top-level `await`), so there is no unit to assert as written — which is exactly why the flow was extracted to its own module. | The flow module `import-orders.ts` and its seven siblings ARE measured, across eight test files: `import-orders.test.ts`, `import-orders-report.test.ts`, `import-orders-append-filter.test.ts`, `import-orders-changed-claims.test.ts`, `import-orders-merge-notice.test.ts`, `import-orders-funding-declaration.test.ts`, `import-orders-unattributed-refusal.test.ts`, plus the engine-side ingest/attribution units. The injected clock (`now`) is what lets those tests freeze the observation instant. |
| `apps/tui/src/record-fill-cli.ts` | The `pnpm orders:fill` entry: WIRING ONLY — it binds the real fs, the real data dir, the real genesis + log and a real readline prompt to `recordFill`, which holds the flow, every refusal, the write ordering and the rollback. Importing this file *runs the act*; the header says so itself, and states the split as the reason. STILL EXCLUDED FROM THE NUMBER — v8 does not instrument a spawned subprocess — but it is no longer untested: `record-fill-cli.test.ts` (audit finding 2) drives the shell itself via `spawnSync(tsx, …)` against a throwaway `mkdtemp` data dir, the same shape `durable-log-guards.test.ts` already uses for `spine-reset`, and asserts this exact seam — the shell now pairs `loadEventLog` with `assertLogFullyLoaded` — end to end. | The flow module `record-fill.ts` IS measured by `record-fill.test.ts` and `record-fill-reliable.test.ts`, which drive the refusals, the append/write ordering and the log rollback through the injected `readLogImage` / `writeLogImage` / `restoreLogImage` seams — no real log touched. The shell's own wiring (the assertion this row used to have no test surface for at all) is now guarded by `record-fill-cli.test.ts`'s subprocess spawn. |
| `apps/tui/src/cancel-order-cli.ts` | The `pnpm orders:cancel <orderId> [observedAt]` entry: WIRING ONLY — argv plus the real orders sidecar, clock and streams bound to `cancelOrder`. No readline (the whole assertion is in argv), but importing it still *runs the act*, so there is no unit to assert as written. | The flow module `cancel-order.ts` IS measured by `cancel-order.test.ts`, which drives the retire path and every refusal through injected `loadOrders` / `appendOrders` / `now`. |
| `apps/tui/src/migrate-legacy-log.ts` | The `pnpm migrate:log` one-shot runner (ADR-003 amendment, PRD #82 slice M1): reads the git-ignored operator mapping `data/migration-cash-legs.json` and hands it to `migrateLegacyLog`. Self-executing `main().catch(..., process.exitCode)` — same category as `apps/web/src/push/push.ts`; importing it rewrites the durable log in place. | `migrateLegacyLog` itself lives in `apps/tui/src/event-store.ts`, which IS measured (`event-store.test.ts`) — including its fail-loud abort paths, which are what make the rewrite safe. The only logic here is the ENOENT-tolerant mapping read, deliberately delegating the "which ids still need a leg" error to `migrateLegacyLog`. |
| `apps/price-feed/src/cli.ts` | The `pnpm prices:fetch` entry (`tsx` script): top-level console reporting and exit-code wiring over `runPriceFetch` / `scanFetchedMarks`. Same script category as `spine.ts` — no unit to assert as written. | Its constituent functions are unit-tested directly (`runPriceFetch` by `fetch-prices.test.ts`, `scanFetchedMarks` by `rejection-check.test.ts`); the end-to-end path is also driven by the manual dry run in `docs/price-feed-ops.md`. |
| `apps/web/src/push/push.ts` | Self-executing `tsx` script (`pnpm push` / `db:init`): top-level `main().then(..., process.exit)` — argv + credential + `process.exit` wiring only. Importing it runs `main()`, so there is no unit to assert as written. Slice #127 extracted the two pieces worth asserting into the measured `push/push-core.ts` (see below), leaving this a thin wrapper. PRD #134 slice 2 then moved `push.ts` off the committed fixture onto `loadCurrentFold()` (the real fold of the durable log). | `push-core.ts` is measured: `deriveSnapshot` / `loadCurrentFold` by `push-core.test.ts`, the real upsert (`upsertSnapshot`) by the gated `push-core.integration.test.ts`. The DDL `push.ts` applies via `--init` / `--init-only` is the tested `readSchemaDdl()` from `provision.ts`. |
| `apps/web/src/push/backfill.ts` | Self-executing `tsx` script (`pnpm backfill`): argv (`parseBackfillArgs`) + credential + `process.exit` wiring over `backfill-core.ts`. Same category as `push.ts`. | `backfill-core.ts` is measured (`backfill-core.test.ts`) — it drives the whole replay loop, including `--fixture` / `--fixture-only`, with no database. |
| `apps/web/src/push/gap-report.ts` | Self-executing `tsx` script (`pnpm gap-report`): argv + console + exit-code wiring over `gap-report-core.ts`. No database or environment required by design (D-series). | `gap-report-core.ts` is measured (`gap-report-core.test.ts`) — argument validation, the calendar window bound, and the exit contract are unit-tested with an injected clock and a throwaway store. |
| `apps/web/src/auth/verify-rate-limit.ts` | Self-executing rate-limit attack script (D5/D10, `pnpm auth:verify-limit`): argv + env + console + exit-code wiring over `verify-rate-limit-core.ts`. Fires real HTTP requests, so it cannot be run as a unit test. | `verify-rate-limit-core.ts` IS measured — its decision logic (observe-a-429 exit contract) is unit-tested with an injected fetch/clock, no network. |
| `apps/web/src/push/push-core.ts` | **Measured**, not excluded — listed here only for the map. The importable, self-exec-free half of the push shell. | `deriveSnapshot` (pure report→derivation) and `loadCurrentFold` (the real genesis+log fold, via `@numisma/event-store` — the single entry point both `push.ts` and `backfill-core.ts` call, with no report-only wrapper beside it) are unit-tested (`push-core.test.ts`); `upsertSnapshot` (the real `ON CONFLICT ... DO UPDATE`) is exercised by the gated `push-core.integration.test.ts` against a throwaway Postgres. Statements/lines/functions measure 100% with or WITHOUT the test DB — `backfill-core.test.ts` runs `upsertSnapshot` through a fake pool, so the SQL executes but is never parsed by Postgres, and only the gated test proves the `ON CONFLICT` clause is real. Branches are 88.88% (8/9): the gap is `loadReserveFloorAsOf`'s no-policy arm. Spelled out rather than rounded up — same posture as `provision.ts`. |
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
| `**/*.d.ts` | Type-only declaration files — no runtime statement to instrument. No `.d.ts` currently lives under a measured `src/`, so the glob matches nothing today; it exists to keep a future one from reporting dishonest 0%, the same defensive posture as the `**/*.fixtures.ts` / `**/*.testkit.ts` globs above. | N/A — `tsc`'s own type-check is what verifies a declaration file, not a coverage number. |

**"Excluded from instrumentation" is not "untestable."** The four orders/migration
CLI shells above (and the other self-executing scripts in this table) are excluded
because v8 cannot report a spawned subprocess's coverage back to this process, and
because importing one in-process runs the real act — not because nothing can drive
them. `record-fill-cli.test.ts` proves the counterexample: it spawns the shell for
real, against a throwaway data dir, and asserts its own wiring. The other three
CLI shells (`import-orders-cli.ts`, `cancel-order-cli.ts`, `migrate-legacy-log.ts`)
have no such spawn test today — they remain untested-by-any-suite, not merely
uninstrumented — which is a real, open gap, not one this table should imply is
closed by analogy.

The `.tsx` render components (`SummaryCard`, `SectionTable`, `FillPath`,
`PriceDropPathChart`) and the route/router `.tsx` files are **not** matched by the
coverage include glob (`apps/*/src/**/*.ts` matches `.ts`, not `.tsx`) — a
deliberate posture recorded in §6, not an oversight.

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

None currently open. The one entry this section used to carry —
`packages/engine/src/price-journey.ts`'s sort-comparator tie-break — is closed
(audit finding 41): the file measures 100% statements/branches/functions/lines in
the fresh run, so whatever fixture now exists exercises the equal-point-count tie.
Kept as a section heading rather than deleted, so a future low-value branch has an
obvious home.

## 4. Real, reachable behavior — closed by #72

The behavior previously parked here (compose-engine warnings/exclusions,
drill-down filtering, and the dashboard renderer's empty-state / tier-expansion /
title branches) was **not** defensive and **not** low-value — shippable behavior
a regression could break while the suite stayed green. It is now unit-tested:

- **`packages/engine/src/compose/canonical.ts`** (100% lines, 96.1% branch) —
  Reserve missing-reference exclusion, Position `unsupported-execution-mode`,
  Account/Instrument `currency-mismatch`, and `detailLinesForRow`
  portfolio/tempo/account drill-down filtering — across the
  `fund-composition-*.test.ts` suite (`fund-composition-warnings.test.ts`,
  `fund-composition-dashboard.test.ts`). Lot-level invalid warnings are no longer
  three hand-rolled checks with three strictnesses — audit finding 5 (A3) unified
  them into ONE predicate, `invalidLotFields` (`packages/engine/src/internal.ts:209-234`),
  which `canonical.ts:299` calls as defense in depth "on the same rule both ingest
  doors enforce." `invalidLotFields` reports quantity/cost/tier/`entryFx` off a
  single `isFiniteNumber` floor (`internal.ts:117`), tightened by
  `isPositiveNumber` when `requireCost` is true (the Position-Lot case). The
  three remaining branch gaps (`canonical.ts:176,344,441`) are the
  `portfolioLabel`/`accountLabel` fallback misses documented in §2 — unrelated to
  the Lot rule. (`parseFundReview` rejects empty `lots`, so the empty-`lots`
  guard is exercised through the public `buildCompositionReport` with a
  directly-built `FundReviewData`, the same way the TUI tests do.)
- **`apps/tui/src/dashboard.ts`** (98.36% lines, 98.24% branch, uncovered
  `:387-392`) — empty-section "No live records." rows, the Portfolio
  empty-detail message, typed vs untyped detail columns, zero-denominator
  tier-table guards, and the `detailTitle` / summary-focus placeholder branches
  are all in `dashboard.test.ts`. NOT 100% branches (audit finding 41 — this
  bullet used to claim it was): `:387-392` is a real, reachable render arm not
  yet itemized here; tracked as an open small gap, not dressed up as
  unreachable.
- **`packages/engine/src/format.ts`** (97.97% lines, uncovered `:119-120` and
  `:388-391`) — the `formatRowFocus` "No live records" placeholder, the
  `formatDataSafety` "no warnings" string, and the empty-section body are
  covered across the `fund-composition-*.test.ts` suite. NOT 100% lines (audit
  finding 26 — this bullet used to claim it was): `:119-120` is the
  invalidation-watch push inside `formatCompositionReport` (a fold with at
  least one live invalidation level never gets rendered in the suite), and
  `:388-391` is the per-rung `"!! … encumbering nothing"` line in
  `formatAvailableCapital` for an unmatched resting order — the operator-facing
  signal that a resting order could not be attributed to a Reserve. Both are
  real, reachable behavior; neither is unreachable-by-design. Tracked as open,
  same posture as the §5 spine remainder.

What remains uncovered after #72, beyond the two real gaps just named in
`dashboard.ts` and `format.ts`, is the §2 defensive guards — each listed there
with a concrete reason.

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

- **`packages/engine/src/events/*.ts`** (92.56% lines, measured) — the covered
  core is the fold itself (`events/fold.ts`, 96.91% lines) and the ingest
  cross-reference (`events/crossref.ts`, 96.23% lines), exercised by
  `event-ingest.test.ts` and `fold.test.ts` — and, since the date-ordering
  gates landed, by `position-born-by.test.ts` (29 tests) and
  `position-seal.test.ts` (PR #261). Uncovered in both: **per-field
  rejection-message branches**. `events/parse.ts` (83.33% lines) is the bulk of
  the gap — 78 lines across 39 ranges, EVERY one the same shape: a
  `return eventError(...)` for one malformed field in one `parse*` function
  (`parseDeposit`/`parseWithdraw`, `parseTransfer`, `parsePositionTrimmed`,
  `parsePositionAddedTo`, and siblings), the "not every malformed-field
  fixture exists yet" gap the rest of the file already documents. This is a
  summary, not the full list (that would misrepresent a partial excerpt as
  complete) — the two largest blocks sit inside `:554-583`
  (`parsePositionTrimmed`'s `positionId`/`removals`/`settlement.reserveId`/
  `settlement.proceeds` fields) and `:607-623` (`parsePositionAddedTo`'s
  `positionId`/`funding.reserveId`/`funding.amount` fields).
  `events/crossref.ts` (re-measured 2026-08-08, after PR #261) adds `:330-333`
  (the `_never` exhaustiveness latch on the event-type switch — unreachable at
  runtime by construction, same category as `events/fold.ts`'s `:492-498` and
  the other `_never` rows in §7), `:558-562` (`ReserveOpened` colliding with an
  existing position id), `:1090-1097` (`PositionTrimmed`'s settlement-proceeds
  deviation-threshold rejection), `:1141-1142` (`PositionAddedTo`'s
  funding-leg debit-check error-message wrapping), and `:1204-1205,1267-1268`
  (the `Transfer`/`PositionOpened` cross-reference error-message wrapping) —
  the validator/cross-reference logic runs, but not every individual
  malformed-field or error-wrapping fixture exists yet. (PR #261's
  `position-seal.test.ts` closed the `PositionTrimmed` unknown-position-id and
  already-closed rejection branches this bullet used to cite as open — they
  measure covered in the fresh run.)

  `events/fold.ts` has four branches open, not the two this bullet
  used to claim: `:649-650` (the lot-selection helper's zero-`tierTotal` early
  return) and `:688-689` (the zero-`totalQuantity` guard in
  `weightedAverageCost`) are real fold branches still open, but so are `:47-48`
  — the degenerate zero-cost-lot arm in the tier-delta allocator, which
  attributes the whole delta to `lots[0]?.tier ?? "c1"` rather than splitting
  it by tier, a real tier-attribution fallback — and `:492-498`, the
  `foldEvents` exhaustiveness latch (`const _never: never = event; throw new
  Error(...)`), categorized like the other `_never` latch rows (§7's
  `skip-message.ts`/`orders/ingest.ts`/`orders/select.ts`): unreachable at
  runtime by construction, kept live so a new verb fails the build rather than
  falling through silently. The `PriceMarked`-carries-`usdMxn` FX-update branch
  this bullet used to name is now covered.
- **`packages/event-store/src/event-store.ts`** (the read path, 96.03% lines) —
  the covered core is `loadEventLog`'s quarantine handling and
  `loadFoldedReview`'s fail-loud fold, exercised by
  `packages/event-store/src/event-store.test.ts`. Uncovered (`:85-86,222-223`):
  `loadGenesis`'s validation-failure throw (a corrupt `genesis.json`, defensive)
  and `readOptional`'s non-`ENOENT` rethrow (an unexpected fs error the call path
  does not otherwise produce — defensive).
- **`apps/tui/src/event-store.ts`** (the write/ingest path, 87.5% lines,
  uncovered `:99-100,102-103,164-166,210-211,234-237,249-253,262-266`) — the
  covered core is the validated ingest boundary, dedup, atomic append, archive,
  and quarantine (`event-store.test.ts`). Argv/env parsing (`parseAsOfArg`,
  `parseMagnitudeThresholdArg`) no longer lives here at all — audit finding 35
  extracted it to `spine-args.ts` (100% covered, see below). The gap is NOT
  exclusively `migrateLegacyLog`'s abort paths (this bullet used to claim it
  was): `ingestInbox` itself is still open in two places — `:99-100` the
  invalid-JSON throw and `:102-103` the non-array-shape throw on a malformed
  inbox, both ahead of the walk — and `:164-166` the best-effort
  durable-log-capture `catch`, which downgrades a fold/git failure in
  `captureIngestCommit` to a `process.stderr.write` warning rather than
  failing the ingest (the append already landed atomically by that point).
  `migrateLegacyLog`'s own remainder is `:210-211` (the empty-log no-op early
  return, not a throw) and its genuine ABORT paths — `:234-237` the
  invalid-JSON-line throw, `:249-253` the not-a-migratable-legacy-event throw,
  and `:262-266` the invalid-remigrated-event throw.
- **`apps/tui/src/spine-args.ts`** (100% lines/branches) — the argv/env knobs
  lifted out of `event-store.ts` (audit finding 35): `parseAsOfArg` (both the
  space-separated and `--as-of=<date>` equals-form) and
  `parseMagnitudeThresholdArg` (flag, env var, and the malformed/non-positive
  fail-loud paths), exercised by `spine-args.test.ts`.

`startup.ts` is at 100% (`startup.test.ts`).

## 6. `apps/web` coverage posture (PRD #121 / slice #122)

Slice #122 brings `apps/web` into the repo's co-located `*.test.ts` convention.
Before it, `apps/web` matched the coverage include glob (`apps/*/src/**/*.ts`) with
zero tests, so it reported a dishonest 0%. This section is the committed decision
for what that number measures.

**Measured (`.ts`, under the number):**

- **`apps/web/src/projection/contract.ts`** — the single writer/reader source of
  truth (ADR-007), and PG-FREE by construction (audit finding 8): 100% covered.
  `contract.test.ts` exercises `toProjectionReport`'s narrowing, `fundIdOf` slug
  derivation across casing, punctuation runs, and leading/trailing separators,
  `SUPPRESSION_KEYS`, and — the load-bearing assertion — that this module's
  dependency graph never reaches `pg` (so a shared runtime value can live here
  without dragging the driver toward the client bundle,
  `client-bundle.integration.test.ts`).
- **`apps/web/src/projection/snapshot-reader.ts`** — the Postgres reader that
  used to sit at the bottom of `contract.ts`, split out (audit finding 8) because
  everything imports the contract but only the server-side dashboard needs the
  driver. 100% covered by `snapshot-reader.test.ts`: `getSnapshotHistory`'s
  empty/stale/ok arbitration, the real version comparison against
  `COMPOSITION_SNAPSHOT_SCHEMA_VERSION` (pg pool mocked, arbitration not
  stubbed), and the lazy `getReaderPool()` singleton (missing env throws, lazy
  construction memoizes, injected stub short-circuits) via the test-only
  `setReaderPoolForTests()` seam. That seam resets/injects the module-level
  `readerPool` so no pool leaks between tests; production lazy construction from
  `PROJECTION_DATABASE_URL` is unchanged. The dependency runs one way — this
  module imports the contract, never the reverse — which is what keeps the
  contract half importable from anywhere.
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
  is 100% covered; without it, `provisionProjection()`'s whole body (`:117-125`,
  9 lines: the DDL apply plus the grant-statement loop, 83.33% functions —
  the one uncovered function) shows uncovered, not merely "two `pool.query`
  lines" (the integration test skips) — flagged honestly, not hidden. The
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
  88.88% (8/9), the one gap being `loadReserveFloorAsOf`'s no-policy-in-effect arm
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
resolved):** `SummaryCard`, `SectionTable`, `FillPath` and `PriceDropPathChart`
(and the route/router `.tsx` files) are outside instrumentation because the include
glob is `*.ts`, not `*.tsx`. The ladder's two — added to this ledger by spec #302
slice E (M4) — were the largest uninstrumented surfaces in the app while going
unnamed here, which is the one thing this document exists to prevent: **no gap is
silent, including a gap in the account of the gaps.** Their entry is below, after
the dashboard pair.

For `SummaryCard` and `SectionTable` the exclusion
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

**`FillPath.tsx` and `PriceDropPathChart.tsx` — the ladder's two (M4, spec #302
slice E).** Same exclusion, same reason (the glob is `*.ts`), and by line count
the two largest uninstrumented files in `apps/web`. They went unnamed in this
ledger through the whole `prototype/tanstack-charts` spike; naming them is the
policy, because a gap this document does not mention is exactly the gap it exists
to prevent.

*What compensates, and how much.* The strong part of the answer is that the
quantitative logic these two used to hold **is no longer in them**: spec #302
slice A lifted `cumulate`, `withRadius`, `splitAt`, `spotMarkFor`,
`deployedMarkFor` and the compact-USD formatter into
`apps/web/src/ladder/price-drop-path.ts`, which IS measured — the repo's own rule
from the trigger paragraph below ("any branch that cannot be lifted into a pure
module should buy the toolchain") applied in the direction it was written for, and
these branches *could* be lifted. Every state a rung can be in is likewise decided
in the measured `ladder/fill-path-view.ts` and its state copy authored in the
measured `ladder/rung-state-copy.ts`; the components read decided fields. So the
chart's arithmetic — the ring scale's floor, the running total's ordering
dependency, the out-of-domain clamp — is under the number, in `price-drop-path.ts`
and its tests, rather than inside the blind spot.

*What is left uncovered, stated plainly.* Mark composition and JSX: which mark
draws which decided field, the `aria-hidden` wrapper and its `.sr-only`
substitute, the legend's three entries and their swatch classes, the row tints.
A wrong prop on the right value, or a legend swatch pointed at the wrong token,
is not catchable here. Two things stand in: the **fixture surface** added by spec
#302 slice B (`/ladder-fixture/{day-zero,partly-walked,out-of-order,overfilled}`
under `pnpm --filter @numisma/web dev`), which is the first time any started-ladder
branch could be rendered by a person at all — a reviewer can open every state
without touching real data — and the **a11y invariant, which remains unasserted**
(the chart subtree is `aria-hidden`, nothing in it is focusable, a substitute node
exists). That last one is the audit's T7, blocked on the deferred component-test
harness (D1) and held meanwhile by
[ADR-019](../context/adr/ADR-019-the-chart-is-presentation-its-accessible-substitute-is-generated.md)
rather than by a test. It is a real, open gap — recorded, not closed by analogy.
The generated caption that substitute consists of is fully measured
(`ladder/convexity-caption.test.ts`).

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

## 7. Every other measured module below 100% — the honesty ledger (audit finding 3)

§§1-6 named specific files because a specific PR or decision put them there.
Between those sections and a fresh `pnpm coverage` run, 38 measured files sat
with no row anywhere in this document — the repo's stated "no gap is silent"
promise was false for exactly the files a reviewer would most want it to be
true for. This section is the fix: every currently measured file below 100%
that §§1-6 do not already name, in one place, so a `grep` for a module name in
this file never comes back empty for a real gap. Not all 38 rows are lines
gaps — about a third are branch-only (100% statements/lines, a branch below
100%), marked as such in the "Lines" column. Line numbers are the fresh run's;
re-run `pnpm coverage` for the current picture.

All of the following are the same shape: a rejection/error-path branch that
runs only on a malformed input, a network/provider failure, or a lock/fs race
— real, reachable code, not dressed up as unreachable, just not yet each
individually itemized with its own paragraph. Grouped by package.

**`apps/tui/src`**

| File | Lines | Uncovered | What's there |
| --- | --- | --- | --- |
| `record-fill.ts` | 79.76% | `:259-260,304-305,339-340,347-348,352-353,355-360,368-369,496-505,514-515,518-519,525-530,537-542,555-556,558-559,584-589,596-597,600-605,610-616` | Not the "worst gap in the repo" on either measure (audit finding 3's headline overstated it): by line COUNT `events/parse.ts`'s 78 uncovered lines are more; by PERCENTAGE `apps/web/src/lib/dashboard.ts`'s 78.26% is lower. What is real: 69 lines across 18 ranges, the largest share of any single file in this table. `:496-505` is the interactive "Also record N confirmed cancellation(s) in this act?" prompt arm — an operator-facing branch, not a rejection path. The remaining ranges are earlier refusal/assembly branches (`reject(io, …)` calls and the fill act's own re-parse/re-cross-reference of the transaction it just built) plus the `ordersToAppend` cancellation-sibling assembly; `record-fill.test.ts`/`record-fill-reliable.test.ts` drive the refusals earlier in the flow but not this full set of late-stage branches. |
| `import-orders.ts` | 93.75% | `:282-284,298-299,315-316,473-476` | `:282-284` the `unreadable-export` refusal when the CSV itself cannot be read, `:298-299` the `no-orders` refusal for a header-valid CSV with zero resting orders, `:315-316` the `unreadable-sidecar-lines` refusal (a partially-read orders book), and `:473-476` one `io.err(...)` skip-line branch in the funding-declaration report join. |
| `ingest-commit.ts` | 96.72% | `:101-102,129-130` | Two `git` exec-failure branches in the commit-capture path. |
| `skip-message.ts` | 87.87% | `:45-48` | The `default: { const _never: never = … }` exhaustiveness latch — by construction, unreachable until a new `OrderRecordProblem` variant ships; it exists to make that day a compile error, not a runtime path any current fixture takes. |
| `available-capital.ts` | 100% lines, 92.3% branch | `:61` | One branch-only gap. |
| `gap-lines.ts` | 100% lines, 87.5% branch | `:56` | One branch-only gap. |
| `review-file.ts` | 100% lines, 98.11% branch | `:116` | One branch-only gap (the root-only `EACCES` skip noted in §2 is separate). |

**`apps/price-feed/src`**

| File | Lines | Uncovered | What's there |
| --- | --- | --- | --- |
| `banxico-provider.ts` | 91.83% | `:64-65,76-77` | `extractLatestDatum`'s malformed-payload throws (unexpected SIE response shape, no FIX observation, unexpected observation shape) — provider IO, same category as the Twelve Data row below. |
| `binance-provider.ts` | 90.47% | `:51-52,56-57` | The equivalent malformed-kline-payload throws for the Binance provider. |
| `twelvedata-provider.ts` | 93.1% | `:108-109,141-142,176-177` | `:108-109` `observationFromBody`'s unexpected-payload-shape throw (a non-record body), plus its rejected-symbol / non-positive-close throws at `:141-142`, and `barDateFromRow`'s no-usable-date throw at `:176-177`. |
| `price-store.ts` | 92.85% | `:33-34` | The non-`ENOENT` rethrow in the per-instrument file read (an unexpected fs error the call path does not otherwise produce — defensive, same shape as `event-store.ts`'s `readOptional`). |
| `provider.ts` | 100% lines, 81.25% branch | `:74,87-88` | `fetchJson`'s `AbortError`-timeout branch and the non-`Error` rejection-message fallback. |
| `rejection-check.ts` | 93.2% | `:169,174-178,279` | The pre-check's own swallow-into-non-fatal-note paths (unreadable log, missing genesis) documented in the package README as advisory-only. |
| `fetch-prices.ts` | 100% lines, 77.5% branch | `:161,162,164,260,286,356,385` | `:161,162,164` are the `?? fetch` / `?? (() => new Date())` / `?? (…setTimeout…)` default-value branches for `runPriceFetch`'s three injectable seams (`fetchImpl`/`now`/`sleepImpl`) — every test injects its own, so the real-default arm never runs; defensive, not a gap in behavior coverage. The four per-symbol/FIX `catch` blocks at `:260,286,356,385` push a failure record — `runPriceFetch`'s "partial progress always kept" contract; each is a real provider-failure path, exercised in aggregate by `fetch-prices.test.ts` but not with every individual thrown-error shape. |

**`apps/web/src`**

| File | Lines | Uncovered | What's there |
| --- | --- | --- | --- |
| `glance/row-view.ts` | 98.57% | `:141` | One rendering branch. |
| `glance/verdict.ts` | 99.02% | `:560-561` | One branch in the verdict's precedence sort. |
| `push/anchor-fixture.ts` | 83.72% | `:83-88,90-91` | `loadAnchorFixture`'s schema-version-mismatch and empty-anchors-array throws — a fixture-regeneration guard, real but low-probability (the fixture is checked in and regenerated deliberately via `--fixture-only`). |
| `push/backfill-core.ts` | 93.54% | `:206-210` | An error-path branch in the replay loop. |
| `push/fixture-synthesis.ts` | 97.28% | `:284-285,308,381-382,388-389,661-662` | Five synthesis-edge branches in the fixture generator (test infrastructure adjacent, but the module itself is product code per the `**/*.fixtures.ts` exclude boundary): `:284-285` and `:308` are degenerate-input guards in the non-cost scale/percentage math (zero weight, zero free room), `:381-382` is the no-pinned-rows fallback `investedPct` in `resolveTargetInvestedPct`, and `:388-389,661-662` are the two originally-named gaps. |
| `push/gap-report-core.ts` | 100% lines, 97.67% branch | `:232` | One branch-only gap. |
| `push/glance.ts` | 100% lines, 92.5% branch | `:136-137,151` | Branch-only gaps in the suppression-list assembly (see E2's seam test, `glance/suppression-seam.test.ts`, for the cross-module contract this feeds). |
| `auth/verify-rate-limit-core.ts` | 100% lines, 92% branch | `:117,171` | Branch-only gaps in the attack script's decision core. |

**`packages/engine/src`**

| File | Lines | Uncovered | What's there |
| --- | --- | --- | --- |
| `parse.ts` | 97.72% | `:263-264,403-404` | Two more per-field genesis-door rejection branches, same category as §5's `events/parse.ts` gap. |
| `report.ts` (compose) | 99.63% | `:216` | One rendering branch. |
| `profit-split.ts` (compose) | 100% lines, 89.28% branch | `:65,114,123` | Branch-only gaps in the profit-split obligation renderer. |
| `durable-log.ts` | 100% lines, 85.71% branch | `:87` | One branch-only gap. |
| `orders/bitget.ts` | 92.13% | `:149-150,308-312,340-342,420-422,429-433` | `:149-150` the quoted-CSV-field escaped-quote-toggle branch in the line splitter; `:308-312` the malformed-column-count skip and `:340-342` the malformed-`side` skip in the open-orders row reader; `:420-422,429-433` are the `total_quantity`/`trigger_price` malformed-cell rejections — same per-field CSV-row rejection shape this module already documents elsewhere. |
| `orders/ingest.ts` | 96.55% | `:211,452-455,487-488` | `:211` is the `filledQuantity` presence branch in the "one id, one claim" cumulative-fill merge — a real comparison arm no current fixture's colliding-id merge exercises. `:452-455` is a `const _never: never = record` exhaustiveness latch (compile-time only, same defensive pattern as `skip-message.ts`/`orders/select.ts` below — `parseOrderRecord` refuses an unknown `kind` before it can reach here). `:487-488` is the live `timeInForce` difference-detection branch in `detectChangedClaims` — a real comparison arm no current fixture's claim/observation pair exercises. |
| `orders/records.ts` | 84.36% | `:458-459,510-511,522-523,525-526,531-536,538-543,555-560,574-579,610-615` | Per-field malformed-value rejections across the `orderPlaced`/`orderFilled` record parsers — the same per-field pattern as `events/parse.ts`; `:574-579,610-615` (`timeInForce`, `triggerPrice`, `filledQuantity`) were the originally-named gap, `:458-459,510-511,522-523,525-526,531-536,538-543,555-560` are the rest of that same field-by-field rejection sweep. |
| `orders/select.ts` | 93.44% | `:161-164` | The same `_never` exhaustiveness latch as `orders/ingest.ts:452-455` — unreachable at runtime by construction, kept live rather than assumed so a new `OrderRecord` kind fails the build instead of silently falling through. |
| `orders/fill.ts` | 98.07% | `:72-73` | A malformed-capture guard in the sidecar-comment order-id/observedAt parser, returning `undefined` for a shape no current fixture produces. |
| `orders/coverage.ts` | 100% lines, 91.66% branch | `:185` | One branch-only gap (the O1 guard extracted by audit finding 33 / C1). |
| `orders/monotonicity.ts` | 100% lines, 97.67% branch | `:350` | One branch-only gap. |
| `price-feed/derive.ts` | 96.36% | `:104-105` | `parseIsoDateUtc`'s malformed-date-format throw — defensive, every caller passes an already-validated `YYYY-MM-DD`. |
| `price-feed/mark.ts` | 90.47% | `:118-119,132-133,137-138` | `:118-119` is `localDateParts`'s "unable to resolve trading day for timezone" throw when the `Intl.DateTimeFormat` parts lack a year/month/day; `:132-133,137-138` are `parseMarkTime`'s malformed-format and out-of-range-hour/minute throws — all defensive, `DEFAULT_CONFIG.markTime` and any override are validated shapes, not raw operator input. |

**`packages/event-store/src` and `packages/preferences/src`**

| File | Lines | Uncovered | What's there |
| --- | --- | --- | --- |
| `heartbeat.ts` | 97.82% | `:199-200` | One branch past the documented "taken as written for v2, never synthesized" guard. |
| `preferences.ts` | 100% lines, 96.55% branch | `:214,225` | Re-derived after spec #320 made the loader total: **the non-`ENOENT` rethrow this row used to name no longer exists** — that path is now the `load-failed` arm of the returned envelope and is covered, as is the split-denominator guard the row's other citation pointed at. What remains is two branch-only arms, neither of them a behavior: `:214` is `String(error)`, the non-`Error` arm of the `load-failed` message (reachable only if something other than an `Error` is thrown out of `readFile`); `:225` is the `?? ""` arm of `lines[index]`, unreachable by construction — `index` is always in range — and present only because `noUncheckedIndexedAccess` types the access as possibly-`undefined`. |
| `orders.ts` (preferences package) | 89.74% | `:73-75,181-182,222-223,225-227,229-230` | `:73-75` is `defaultWarn`'s `console.warn` fallback when no `warn` is injected; `:181-182` is the non-`ENOENT` rethrow on the sidecar read (same shape as `price-store.ts`'s); `:222-223,225-227,229-230` are the lock-contention retry path in the sidecar's advisory file lock (`open(lockPath, "wx")` racing another writer) — a real concurrency branch, exercised only under contention. |

None of the above is claimed unreachable. Each is a real branch this table now
names instead of omits — closing the gap finding 3 identified, without
pretending every one is individually itemized to the depth §§2/§4/§5 give their
named files. A future increment that wants to close one starts here, not by
re-discovering it.

## What this number means

Every Node module's behavior below 100% has a row in this document — §1 for
what is excluded from instrumentation entirely, §2 for defensive/unreachable
guards, §3 (currently empty) for low-value presentation branches, §4 for what
was closed by #72, §5 for the event-sourcing spine remainder, §6 for
`apps/web`'s posture, and §7 (audit finding 3) for every other currently
measured file below 100% that the earlier sections do not individually
name. "Reliable" here means *measured and accounted for* — not "100% of
everything," and explicitly not covering the Bun-only wiring. This is a
point-in-time accounting against one `pnpm coverage` run; re-run it and diff
against this document's numbers before trusting either.
