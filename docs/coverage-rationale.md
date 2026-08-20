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

**Vintages, stated once.** §§2, 4, 5 and 6 are re-derived from ONE run at
`c336139` (#389), on a checkout with no gated integration Postgres:
`push-core.integration.test.ts`, `backfill.integration.test.ts` and
`provision.integration.test.ts` all skip, and the figures that turn on that say
so where they stand. §7 carries its own vintage, `e1d6265`, and was NOT
re-derived here; several of its rows have drifted since (`record-fill.ts` and
`import-orders.ts` among them), which is that section's own re-derivation to do,
not this one's to quietly half-fix.

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
| `apps/tui/src/import-orders-cli.ts` | The `pnpm orders:import` entry: WIRING ONLY — it binds the real `readFile`, the real orders sidecar path, the real fold (`loadFoldedReview`) and a real readline prompt to `importBitgetOpenOrders`, which holds the flow and every refusal. Importing this file *runs the import* (top-level `await`), so there is no unit to assert as written — which is exactly why the flow was extracted to its own module. STILL EXCLUDED FROM THE NUMBER — v8 does not instrument a spawned subprocess — but no longer untested: `import-orders-cli.test.ts` spawns the real shell under `tsx` against a throwaway `mkdtemp` data dir and pins the wiring the flow suites structurally cannot see (the usage branch, the three-way exit-code mapping including the deliberate `imported-partial` zero, the one env var it resolves three paths from, and the `finally` that closes the prompt). | The flow module `import-orders.ts` and its seven siblings ARE measured, across eight test files: `import-orders.test.ts`, `import-orders-report.test.ts`, `import-orders-append-filter.test.ts`, `import-orders-changed-claims.test.ts`, `import-orders-merge-notice.test.ts`, `import-orders-funding-declaration.test.ts`, `import-orders-unattributed-refusal.test.ts`, plus the engine-side ingest/attribution units. The injected clock (`now`) is what lets those tests freeze the observation instant. The shell's own argv/exit-code/env wiring is guarded by `import-orders-cli.test.ts`'s subprocess spawn. |
| `apps/tui/src/record-fill-cli.ts` | The `pnpm orders:fill` entry: WIRING ONLY — it binds the real fs, the real data dir, the real genesis + log and a real readline prompt to `recordFill`, which holds the flow, every refusal, the write ordering and the rollback. Importing this file *runs the act*; the header says so itself, and states the split as the reason. STILL EXCLUDED FROM THE NUMBER — v8 does not instrument a spawned subprocess — but it is no longer untested: `record-fill-cli.test.ts` (audit finding 2) drives the shell itself via `spawnSync(tsx, …)` against a throwaway `mkdtemp` data dir, the same shape `durable-log-guards.test.ts` already uses for `spine-reset`, and asserts this exact seam — the shell now pairs `loadEventLog` with `assertLogFullyLoaded` — end to end. | The flow module `record-fill.ts` IS measured by `record-fill.test.ts` and `record-fill-reliable.test.ts`, which drive the refusals, the append/write ordering and the log rollback through the injected `readLogImage` / `writeLogImage` / `restoreLogImage` seams — no real log touched. The shell's own wiring (the assertion this row used to have no test surface for at all) is now guarded by `record-fill-cli.test.ts`'s subprocess spawn. |
| `apps/tui/src/cancel-order-cli.ts` | The `pnpm orders:cancel <orderId> [observedAt]` entry: WIRING ONLY — argv plus the real orders sidecar, clock and streams bound to `cancelOrder`. No readline (the whole assertion is in argv), but importing it still *runs the act*, so there is no unit to assert as written. STILL EXCLUDED FROM THE NUMBER — v8 does not instrument a spawned subprocess — but no longer untested: `cancel-order-cli.test.ts` spawns the real shell under `tsx` with stdin CLOSED and pins the usage branch, the positional `argv[3]` stamp mapping, the `NUMISMA_DATA_DIR` → `resolveOrdersPath()` plumbing, the exit-code mapping, and the header's stated no-TTY contract. | The flow module `cancel-order.ts` IS measured by `cancel-order.test.ts`, which drives the retire path and every refusal through injected `loadOrders` / `appendOrders` / `now`. The shell's own argv/exit-code wiring is guarded by `cancel-order-cli.test.ts`'s subprocess spawn. |
| `apps/tui/src/migrate-legacy-log.ts` | The `pnpm migrate:log` one-shot runner (ADR-003 amendment, PRD #82 slice M1): reads the git-ignored operator mapping `data/migration-cash-legs.json` and hands it to `migrateLegacyLog`. Self-executing `main().catch(..., process.exitCode)` — same category as `apps/web/src/push/push.ts`; importing it rewrites the durable log in place. STILL EXCLUDED FROM THE NUMBER — v8 does not instrument a spawned subprocess — but no longer untested: `migrate-legacy-log.test.ts` spawns the real shell under `tsx`, pointing `NUMISMA_DATA_DIR` and the spawn's `cwd` at two DIFFERENT throwaway dirs so the CWD-relative mapping literal cannot pass by coincidence. | `migrateLegacyLog` itself lives in `apps/tui/src/event-store.ts`, which IS measured (`event-store.test.ts`) — including its fail-loud abort paths, which are what make the rewrite safe. The only logic here is the ENOENT-tolerant mapping read, deliberately delegating the "which ids still need a leg" error to `migrateLegacyLog`; that read, the two stdout sentences and the `touched === 0` boundary, the exit-code mapping and the relative-path rejection are what `migrate-legacy-log.test.ts` pins. |
| `apps/price-feed/src/cli.ts` | The `pnpm prices:fetch` entry (`tsx` script): WIRING ONLY, and now genuinely so — it reads `process.argv`, calls `runPriceFetchCli` and assigns the exit code. Importing it *runs the fetch*, so there is no unit to assert as written; same script category as `spine.ts`. The reporting and the exit contract it used to hold inline were extracted to `cli-main.ts` for exactly this reason. | `cli-main.ts` (the console report, the owed / marked / absent classification and the exit contract) and `cli-args.ts` (the argv parser) are NOT excluded — both are measured, by `cli-main.test.ts` and `cli-args.test.ts`. Underneath them, `runPriceFetch` is unit-tested by `fetch-prices.test.ts` and `scanFetchedMarks` by `rejection-check.test.ts`; the end-to-end path is also driven by the manual dry run in `docs/price-feed-ops.md`. |
| `apps/tui/src/plans-cli.ts` | The `pnpm plans` entry: a bare top-level `try/catch` that resolves the fold (`loadFoldedReview`), the `plans.jsonl` sidecar and the `reconciliations.jsonl` trail and hands all three to `formatPlansReport`, then sets `process.exitCode`. Importing it *runs the act*, same shape as the orders CLI shells above. It also inherits the event log's write-on-read quarantine maintenance, which its own header names — so importing it is not even read-only. Excluded as of the increment that added it to `vitest.config.ts`; before that it reported a dishonest 0% and §7 carried a row saying so. | `formatPlansReport` IS measured (`plans-report.test.ts`), as is the engine-side `listPlansAsOf` it renders. The three reads it wires are each measured in their own modules (`loadFoldedReview` by `packages/event-store/src/event-store.test.ts`, the sidecar and trail loaders by their own suites). The shell's own argv/exit-code wiring has no spawn test today — nothing in the tree imports or spawns it (the only other mentions of the filename are prose in `plans-report.ts`'s header, `apps/tui/README.md` and the `pnpm plans` script), so it is one of the TWO shells the paragraph below this table names as untested by any suite. |
| `apps/price-feed/src/operator-notice-cli.ts` | The `pnpm operator-notice` entry: a module-level `writeOperatorNotice(resolveEventStorePaths(resolveDataDirDefault()), { now })` `.then(onSuccess, onFailure)`. Deliberately zero-argument (its header rules that an unattended step taking a date eventually writes the wrong one), so there is no argv to assert and importing it performs the write. Same category as `apps/web/src/push/push.ts`. Excluded in the same increment, for the same reason, as `plans-cli.ts`. | Everything it delegates to IS measured in `@numisma/event-store`: what the notice says (`operator-notice.ts`, pure) and where it goes and how it is written (`operator-notice-io.ts`). The data-dir resolution it performs is ADR-006's single rule (`resolveDataDirDefault`), measured in its own suite. The shell itself, though, has no driver, and the one place that looks like it does is not: the wrapper harness (`run-daily-fetch.test.ts`) drives step 5b through a *fake* bin — `wrapper-harness/fake-bin.testkit.ts`'s `"writes-operator-notice"` behavior, armed at `wrapper-harness/operator-notice.testkit.ts:195` — precisely so the wrapper is under test and not this CLI. So this shell is the second of the two the paragraph below this table names. |
| `apps/web/src/push/push.ts` | Self-executing `tsx` script (`pnpm push` / `db:init`): top-level `main().then(..., process.exit)` — argv + credential + `process.exit` wiring only. Importing it runs `main()`, so there is no unit to assert as written. Slice #127 extracted the two pieces worth asserting into the measured `push/push-core.ts` (see below), leaving this a thin wrapper. PRD #134 slice 2 then moved `push.ts` off the committed fixture onto `loadCurrentFold()` (the real fold of the durable log). | `push-core.ts` is measured: `deriveSnapshot` / `loadCurrentFold` by `push-core.test.ts`, the real upsert (`upsertSnapshot`) by the gated `push-core.integration.test.ts`. The DDL `push.ts` applies via `--init` / `--init-only` is the tested `readSchemaDdl()` from `provision.ts`. |
| `apps/web/src/push/backfill.ts` | Self-executing `tsx` script (`pnpm backfill`): argv (`parseBackfillArgs`) + credential + `process.exit` wiring over `backfill-core.ts`. Same category as `push.ts`. | `backfill-core.ts` is measured (`backfill-core.test.ts`) — it drives the whole replay loop, including `--fixture` / `--fixture-only`, with no database. |
| `apps/web/src/push/gap-report.ts` | Self-executing `tsx` script (`pnpm gap-report`): argv + console + exit-code wiring over `gap-report-core.ts`. No database or environment required by design (D-series). | `gap-report-core.ts` is measured (`gap-report-core.test.ts`) — argument validation, the calendar window bound, and the exit contract are unit-tested with an injected clock and a throwaway store. |
| `apps/web/src/auth/verify-rate-limit.ts` | Self-executing rate-limit attack script (D5/D10, `pnpm auth:verify-limit`): argv + env + console + exit-code wiring over `verify-rate-limit-core.ts`. Fires real HTTP requests, so it cannot be run as a unit test. | `verify-rate-limit-core.ts` IS measured — its decision logic (observe-a-429 exit contract) is unit-tested with an injected fetch/clock, no network. |
| `apps/web/src/push/push-core.ts` | **Measured**, not excluded — listed here only for the map. The importable, self-exec-free half of the push shell. | `deriveSnapshot` (pure report→derivation) and `loadCurrentFold` (the real genesis+log fold, via `@numisma/event-store` — the single entry point both `push.ts` and `backfill-core.ts` call, with no report-only wrapper beside it) are unit-tested (`push-core.test.ts`); `upsertSnapshot` (the real `ON CONFLICT ... DO UPDATE`) is exercised by the gated `push-core.integration.test.ts` against a throwaway Postgres. Without the test DB it measures 95.83% statements/lines, 100% functions, 69.56% branch (16/23) — `backfill-core.test.ts` runs `upsertSnapshot` through a fake pool, so the SQL executes but is never parsed by Postgres, and only the gated test proves the `ON CONFLICT` clause is real. This cell used to read 100% statements/lines/functions and 88.88% branch, naming `loadReserveFloorAsOf`'s no-policy arm as the one gap; §6's re-derivation (#389) found both figures stale and that arm covered. The row is corrected here rather than left to contradict §6 one section away, though §1 was otherwise outside #389's scope. Spelled out rather than rounded up — same posture as `provision.ts`. |
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

**"Excluded from instrumentation" is not "untestable."** The six CLI shells above
— the four orders/migration entries plus `plans-cli.ts` and
`operator-notice-cli.ts` — and the other self-executing scripts in this table are
excluded because v8 cannot report a spawned subprocess's coverage back to this
process, and because importing one in-process runs the real act — not because
nothing can drive them. `record-fill-cli.test.ts` proves the counterexample: it
spawns the shell for real, against a throwaway data dir, and asserts its own
wiring, and it is no longer alone. Three more of these shells have since gained
one of their own, each the same `spawnSync(tsx, …)` shape against a throwaway
`mkdtemp` data dir: `import-orders-cli.test.ts`, `cancel-order-cli.test.ts` and
`migrate-legacy-log.test.ts`. Four of the six shells in this table are therefore
driven by a real suite that asserts the shell's own argv, env plumbing and exit
codes; they stay excluded only because v8 cannot see into the subprocess.

TWO shells are genuinely driverless at HEAD: `plans-cli.ts` and
`operator-notice-cli.ts`. That is the count to read off this section. Both joined
this list by being excluded rather than by being tested, so this paragraph is the
only thing saying so, and it has to say it precisely. Until they were excluded,
both reported a dishonest 0%, and that 0% was itself the flag; an exclude trades
a dishonest number for an honest accounting, and this is the accounting. Neither
has a driver. Nothing in the tree imports or spawns `plans-cli.ts`: the filename
appears in the `pnpm plans` script, in `apps/tui/README.md`, in the
`plans-report.ts` header and in this document, and not one of those is a test.
`operator-notice-cli.ts` has an apparent driver that is not one, because the
wrapper harness spawns a fake bin for the operator-notice step and never the real
CLI. A `grep` for either filename therefore returns hits and still returns no
driver, which is the reason both are spelled out here by name.

The `.tsx` render components (`SummaryCard`, `SectionTable`, `FillPath`,
`PriceDropPathChart`) and the route/router `.tsx` files are **not** matched by the
coverage include glob (`apps/*/src/**/*.ts` matches `.ts`, not `.tsx`) — a
deliberate posture recorded in §6, not an oversight.

## 2. Defensive / unreachable guards (kept on purpose, cannot be tested honestly)

These branches exist to make each function safe in isolation, but a prior check
in the real call path makes them unreachable. Testing them would require faking a
state the pipeline already excludes, so they are documented rather than tested.

**`packages/engine/src/parse.ts`**

- `validateNamedRecords` `!Array.isArray(value)` (~L149-151) — every caller
  (`portfolios` directly, plus `validateAccounts` / `validateInstruments`) only
  runs after the top-level `requiredArrays` loop has already confirmed the value
  is an array.
- `validateReserves` `!Array.isArray(value)` (~L234-236) and `validatePositions`
  `!Array.isArray(value)` (~L262-264) — `reserves` and `positions` are both in
  the same top-level `requiredArrays` check, so these are unreachable from
  `parseFundReview`.
- `validateCapitalRecordIds` `if (!isRecord(record) || typeof record.id !==
  "string") continue` (~L402-404) — by the time this runs, every reserve and
  position has passed `validateCapitalRecordShape`, which already required a
  record carrying a non-empty string `id`.
- `parseReviewInput` invalid-json catch, `error instanceof Error ? error.message
  : String(error)` false branch (~L435) — `JSON.parse` only throws `SyntaxError`
  (an `Error`), so the `String(error)` fallback never runs.

**`apps/tui/src/review-file.ts`**

- `normalizeLoadFundReviewError` `error instanceof Error ? error : new
  Error(String(error))` false branch (~L116) — the only throwers reaching it
  (`readFile`, `parseFundReviewError`) throw `Error` instances; the
  non-`Error` fallback is a defensive coercion. (The `ENOENT`/`EISDIR`/`EACCES`
  branches above it *are* tested, the last one skipped only when running as
  root — see `review-file.test.ts`.)

**`packages/engine/src/compose/canonical.ts`**

- `buildCanonicalState` Reserve `portfolioLabel` fallback
  `portfolios.get(reserve.portfolioId)?.name ?? reserve.portfolioId` (~L176) and
  the Position `portfolioLabel` fallback (~L344) — both run only after
  `validateCapitalBase` has already excluded any record whose `portfolioId` is
  missing, so `portfolios.get(...)` always resolves and the optional-chain /
  `?? id` miss is unreachable.
- `accountLabel` `account ? … : fallback` false branch (~L441) — same reason:
  `validateCapitalBase` excludes any record with a missing `accountId`, so every
  record that reaches `accountLabel` has a resolved Account.

**`packages/engine/src/format.ts`**

- `sectionRows` `?.rows ?? []` miss (~L275) — the five composition sections are
  always present in the report, so `.find(...)` never returns undefined and the
  `?? []` fallback is unreachable from `formatCompositionReport`.

**`apps/tui/src/dashboard.ts`**

- `emptyDetailMessage` Tempo branch (`:387-389`) and Account branches
  (`:390-392`) — `emptyDetailMessage` is reached only when a drill-down's detail
  body is empty, and only a Portfolio drill-down can be empty (it filters to
  Positions, so a Portfolio holding only Reserves yields no rows). A Tempo row
  exists only because a line carries that Tempo, and an Account row only because
  a line carries that Account, so their drill-downs are never empty and these
  messages never render. The Portfolio branch (`:384-385`) *is* tested
  (`dashboard.test.ts`). **These six lines are the whole of what the run reports
  as `dashboard.ts`'s uncovered range, `:387-392`** — the range §4 names below.
  They are accounted for here, and §4 used to say they were not.

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
  them into ONE predicate, `invalidLotFields` (`packages/engine/src/internal.ts:209-240`),
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
  bullet used to claim it was). What the remaining `:387-392` IS, however, this
  bullet also got wrong: it called the range "a real, reachable render arm not
  yet itemized here," and it is neither unitemized nor reachable. It is
  `emptyDetailMessage`'s Tempo arm (`:387-389`) and Account arms (`:390-392`) —
  §2's entry, which gives the concrete reason no Tempo or Account drill-down can
  ever be empty. One gap, one accounting, in §2.
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

What remains uncovered after #72, beyond the two real gaps named in
`format.ts`, is the §2 defensive guards — `dashboard.ts`'s whole remainder among
them — each listed there with a concrete reason.

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

- **`packages/engine/src/events/*.ts`** (93.87% lines, re-measured at `c336139`) —
  the covered core is the fold itself (`events/fold.ts` — its figure and its
  vintage are quoted ONLY in its own paragraph below, so the two cannot drift
  apart) and the ingest
  cross-reference (`events/crossref.ts`, 97.61% lines), exercised by
  `event-ingest.test.ts` and `fold.test.ts` — and, since the date-ordering
  gates landed, by `position-born-by.test.ts` (29 tests) and
  `position-seal.test.ts` (PR #261). Uncovered in both: **per-field
  rejection-message branches**. `events/parse.ts` (83.33% lines) is the bulk of
  the gap — 78 lines across 39 ranges, EVERY one the same shape: a
  `return eventError(...)` for one malformed field in one `parse*` function
  (`parseReserveMove`, which serves both `Deposit` and `Withdraw`,
  `parseTransfer`, `parsePositionTrimmed`, `parsePositionAddedTo`, and
  siblings), the "not every malformed-field fixture exists yet" gap the rest of
  the file already documents. This is a summary, not the full list (that would
  misrepresent a partial excerpt as complete) — the two largest blocks sit inside `:554-583`
  (`parsePositionTrimmed`'s `positionId`/`removals`/`settlement.reserveId`/
  `settlement.proceeds` fields) and `:607-623` (`parsePositionAddedTo`'s
  `positionId`/`funding.reserveId`/`funding.amount` fields).
  `events/crossref.ts` (re-measured at `c336139`) adds `:452-455`
  (the `_never` exhaustiveness latch on the event-type switch — unreachable at
  runtime by construction, same category as `events/fold.ts`'s own `_never`
  latch, cited once in the `fold.ts` paragraph below and deliberately not
  renumbered here as well, and the other `_never` rows in §7), `:719-723`
  (`ReserveOpened` colliding with an existing position id), and three
  error-message wrappings of a cash-leg debit check that failed: `:1371-1372`
  (`PositionAddedTo`'s funding leg), `:1434-1435` (`Transfer`'s source leg),
  and `:1497-1498` (`PositionOpened`'s funding leg) — the
  validator/cross-reference logic runs, but not every individual
  malformed-field or error-wrapping fixture exists yet. (PR #261's
  `position-seal.test.ts` closed the `PositionTrimmed` unknown-position-id and
  already-closed rejection branches this bullet used to cite as open — they
  measure covered in the fresh run.) The `PositionTrimmed` settlement-proceeds
  deviation-threshold rejection this bullet used to carry as a fourth range is
  covered too, and is withdrawn rather than renumbered: it sits at `:1288-1295`
  now, and the run counts four hits on it.

  `events/fold.ts` (98.04% lines, re-measured at `c336139`) has
  **three** ranges open — the same three as the previous vintage, and not one
  of them has moved a line since. The ranges below are the UNCOVERED-LINE
  report (v8 provider, the "Uncovered Line #s" column), which is the unit the
  rest of this file uses; a branch-location span is a different measurement and
  is not what is quoted here:

  - `:732-733` — the `Withdraw` arm's `recordSkip(event, order,
    "reserve-absent")`, taken when `applyToReserve` finds no such reserve. A
    Discard-Channel skip record rather than a numeric guard. The `if` at `:731`
    is covered — the arm runs on every applying `Withdraw` — so the range starts
    inside it. Cited as `:691-692` before; only the lines moved.
  - `:794-800` — the `foldEvents` exhaustiveness latch (`const _never:
    never = event; throw new Error(...)`), categorized like the other `_never`
    latch rows (§7's `skip-message.ts`/`orders/ingest.ts`/`orders/select.ts`):
    unreachable at runtime by construction, kept live so a new verb fails the
    build rather than falling through silently. **This citation is a correction,
    not a move.** It read `:794-797,799-800` before, on the reasoning that `:798`
    measures covered and a contiguous range would therefore claim a line that is
    not uncovered. `:798` measures nothing. It is the last line of the thrown
    message's string concatenation, it carries NO STATEMENT AT ALL, and the text
    reporter bridges it rather than breaking the range there — the exact case
    §7's derivation rule spells out. Citing the split range meant quoting raw
    statement hits where every other citation in this file quotes the run. The
    line numbers themselves are unchanged since `9e888d7`; only the reading of
    `:798` was wrong.
  - `:1119-1120` — the zero-`totalQuantity` early `return 0` in
    `weightedAverageCost`. The `if` at `:1118` is covered. Cited as `:1045-1046`
    before #371 moved it; unchanged since.

  The `Transfer` arm's own `reserve-absent` skip is NO LONGER among them. #371
  replaced its two per-leg `applyToReserve` failure branches with a single
  pre-flight existence check that the new both-legs-or-neither tests exercise
  directly, so that branch measures covered where its predecessor did not. The
  `Withdraw` arm above is now the only `reserve-absent` record in the file that
  no test reaches.

  Two claims this paragraph used to make are now false and are withdrawn rather
  than renumbered. **The `:47-48` c1-fallback branch no longer exists:** #329
  deleted the `lots[0]?.tier ?? "c1"` arm of the tier-delta allocator, and
  `fold.ts:47-48` is now `SKIP_DETAIL` prose for the `"position-absent"` skip
  reason. In its place `tierWeightedDeltas` sends a zero-cost-lot delta to
  `present[0]` — the canonically first Tier holding a lot, in `c1`/`c2`/`c3`
  order, which is order-independent and invents no Tier — and returns `[]` for
  no-lots-at-all, a Discard-Channel discard, the file's own comment recording
  that the old fallback "minted a full-magnitude c1 delta for a cash movement
  carrying no provenance whatsoever… Not a bad attribution: an invented one."
  Both arms measure covered. And **`:649-650`, the lot-selection helper's
  zero-`tierTotal` early return, is no longer uncovered** — the helper still
  exists (`splitTierRemoval`, `fold.ts:1044`, its `if (tierTotal === 0)` early
  return at `:1053-1055`), it simply measures covered. Those two numbers are
  re-measured at `c336139` with the rest of this paragraph; #371 moved them and
  the first re-measurement pass renumbered the open ranges above without
  reaching this sentence. The `PriceMarked`-carries-`usdMxn` FX-update branch
  this bullet used to name is covered too.
- **`packages/event-store/src/event-store.ts`** (the read path, 97.27% lines) —
  the covered core is `loadEventLog`'s quarantine handling and
  `loadFoldedReview`'s fail-loud fold, exercised by
  `packages/event-store/src/event-store.test.ts`. Uncovered (`:117-118,419-420`):
  `loadGenesis`'s validation-failure throw (a corrupt `genesis.json`, defensive)
  and `readOptional`'s non-`ENOENT` rethrow (an unexpected fs error the call path
  does not otherwise produce — defensive).
- **`apps/tui/src/event-store.ts`** (the write/ingest path, 88.44% lines,
  uncovered `:101-102,104-105,171-173,276-277,302-305,317-321,330-334`) — the
  covered core is the validated ingest boundary, dedup, atomic append, archive,
  and quarantine (`event-store.test.ts`). Argv/env parsing (`parseAsOfArg`,
  `parseMagnitudeThresholdArg`) no longer lives here at all — audit finding 35
  extracted it to `spine-args.ts` (100% covered, see below). The gap is NOT
  exclusively `migrateLegacyLog`'s abort paths (this bullet used to claim it
  was): `ingestInbox` itself is still open in two places — `:101-102` the
  invalid-JSON throw and `:104-105` the non-array-shape throw on a malformed
  inbox, both ahead of the walk — and `:171-173` the best-effort
  durable-log-capture `catch`, which downgrades a fold/git failure in
  `captureIngestCommit` to a `process.stderr.write` warning rather than
  failing the ingest (the append already landed atomically by that point).
  `migrateLegacyLog`'s own remainder is `:276-277` (the empty-log no-op early
  return, not a throw) and its genuine ABORT paths — `:302-305` the
  invalid-JSON-line throw, `:317-321` the not-a-migratable-legacy-event throw,
  and `:330-334` the invalid-remigrated-event throw.
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
  the assertion a stubbed session return cannot make). `loadDashboard` itself is
  fully covered. The FILE measures 78.26% lines, 100% branch, 100% functions,
  uncovered `:84-88` — a figure this bullet never carried, so a reader had to
  take "the remaining uncovered lines" on trust. Those five lines are the thin
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
  is 100% covered; without it — which is how the run behind these figures ran —
  `provisionProjection()`'s whole body (`:117-125`, 9 lines: the DDL apply plus
  the grant-statement loop) shows uncovered, not merely "two `pool.query` lines",
  and the file measures 82.35% lines, 100% branch, 83.33% functions: it is the
  one uncovered function in the package. Flagged honestly, not hidden. The
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
  on the #123 throwaway-Postgres substrate. **Both figures this paragraph used to
  carry are now false and are replaced, not adjusted.** With the test DB absent it
  measures 95.83% statements / 95.83% lines / 100% functions / 69.56% branch
  (16/23), where the text said 100/100/100 and 88.88% branch — the branch number
  off by nineteen points in the direction that flatters the code, which is the one
  direction a documented figure must never drift. The line figure was still worth
  spelling out and still is, because it overstates the assurance either way:
  `backfill-core.test.ts` drives `upsertSnapshot` through a fake pool, so the SQL
  string is executed but never parsed by Postgres. Only the gated integration test
  proves the `ON CONFLICT` clause is valid and idempotent against a real server; a
  green line count here says the branch ran, not that the statement is correct SQL.
  The ONE arm this paragraph used to name as the whole gap is not in it any
  more: `loadReserveFloorAsOf`'s no-policy-in-effect arm
  (`pickPolicyAsOf(...)?.reserveTargetPct` returning `undefined`), R1's absent
  floor, measures covered in this run at 13 hits. What is open instead, cited
  the way §7's derivation rule requires — the run's zero-hit statement lines,
  because this file is below 100% lines — is `:302-303,380-381,384-385`:
  `loadVenueDarkAsOf`'s `catch` body, which answers an unreadable durable log
  with `undefined` rather than a fabricated verdict, and `loadFillInputs`'s two
  refusals to guess, on an unreadable orders sidecar and on a book that came
  back partially read. Three more branch-only companions sit outside that
  column: `:330` is `fold.data.closedPositions ?? []`'s default-array arm,
  `:382` is the `absent`-status empty-book arm of the orders ternary, and
  `:567` is `pushAnchorAndReport`'s `input.emit ?? console.error` default,
  never taken because every test injects its own sink. (The remaining branch
  lines, `:301`, `:379` and `:383`, are the guards ahead of the three cited
  bodies, not separate behavior.) Seven unexercised arms in all, every one real
  and reachable, in the same two shapes §7's preamble names.

  The blast radius this real fold opens — `apps/web` now depends on
  `@numisma/event-store`, the reader for the whole private event log — is
  guarded structurally, not by
  a coverage number: `apps/web/src/event-store-import-guard.test.ts` asserts no
  `apps/web` source file outside `src/push/` imports that package.

**Excluded (`.ts` dead weight — see §1 table, which is the authority and which
this list now names file for file, having previously named three of them):**
`push/push.ts`, `push/backfill.ts` and `push/gap-report.ts` (self-executing
scripts, each a thin argv/credential/exit-code wrapper over a measured core:
`push-core.ts`, `backfill-core.ts`, `gap-report-core.ts`),
`auth/seed-account.ts` and `auth/verify-rate-limit.ts` (the single-tenant seed
and the rate-limit attack script, both self-executing over cores that are
themselves measured), `projection/provision-projection.ts` and
`auth/apply-auth-schema.ts` (the provisioning and auth-schema CLIs, named again
in the `provision.ts` bullet above), `lib/auth.ts` /
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
The generated caption that substitute consists of measures 100% lines and
95.65% branch (`ladder/convexity-caption.test.ts`) — NOT "fully measured", which
this sentence used to claim while §7's own row for the file named the one open
arm, `:135`'s empty caption. A prose adjective and a figure in the same document
now agree.

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
Between those sections and a fresh `pnpm coverage` run, measured files sat
with no row anywhere in this document — the repo's stated "no gap is silent"
promise was false for exactly the files a reviewer would most want it to be
true for. This section is the fix: every currently measured file below 100%
that §§1-6 do not name WITH A FIGURE, in one place, so a `grep` for a module
name in this file never comes back empty for a real gap. It opened at 38 rows
(audit finding 3); ten more were added at `d5fe02c` (#377); this fix (PR #387
review) adds the two files a filename collision hid from every earlier
`grep` sweep — `reconciliations.ts` (engine package) and `gap-report.ts`
(event-store package), each sharing a bare filename with a different
measured or excluded file below — plus two files an earlier section only
mentioned in passing, with no figure and no gap accounted:
`apps/price-feed/src/cli-main.ts` (§1) and `apps/web/src/ladder/fill-path-view.ts`
(§6). A passing mention without a figure does not satisfy this section's own
contract, so both get a row rather than a tightened mention. That took it to 55.
Two then left: the increment that excluded `apps/tui/src/plans-cli.ts` and
`apps/price-feed/src/operator-notice-cli.ts` in `vitest.config.ts` did the very
thing both of their rows asked for, so they stopped being measured and moved to
§1's table. They were relocated, not resolved — the shells are still untested by
any suite, which is now §1's paragraph to say and no longer this section's, since
this section only speaks for files the coverage run still measures. **53 rows, as
of that relocation.** Not all 53 are lines gaps — 18, about a third, are branch-only
(100% statements/lines, a branch below 100%), marked as such in the "Lines"
column.

**Derivation rule, stated once and honored in every row below.** The
"Uncovered" column cites exactly what `pnpm coverage`'s v8-provider text
reporter prints in its own "Uncovered Line #s" column for that file: the
zero-hit statement lines when the file's line/statement percentage is below
100% (istanbul bridges its printed range across a line that carries no
statement at all — a comment, a string continuation — without treating it as
a break), or the lines carrying an uncovered branch arm when lines measure
100% but branches do not. A row never unions the two metrics into one range
list, because the promise two paragraphs up is that this column reproduces
the run literally. A file below 100% lines that also carries branch-only
gaps elsewhere in the same function still describes them — in the "What's
there" prose, not in the Uncovered column — so nothing is silently dropped;
it just is not where a line-by-line diff against a fresh run would look for
it. Line numbers are the fresh run's, at `e1d6265`; re-run `pnpm coverage`
for the current picture.

All of the following are broadly one of two shapes: a rejection/error-path
branch that runs only on a malformed input, a network/provider failure, or a
lock/fs race; or a default-value/fallback arm no current fixture happens to
exercise — real, reachable code either way, not dressed up as unreachable,
just not yet each individually itemized with its own paragraph. Grouped by
package. One row below says plainly that it does NOT fit even that:
`lib/binance-spot.ts` is an instrumentation-posture problem — a genuine 0%
— not a branch shape, and is named as such in its own row rather than folded
into this sentence. It is the LAST of what used to be three. `plans-cli.ts`
and `operator-notice-cli.ts` were the other two, and both have since been
excluded in `vitest.config.ts` alongside their sibling CLI shells; they now
appear in §1 and are no longer measured, so §7 is not the place for them.
`binance-spot.ts` stays here because an exclude is the WRONG fix for it: it is
a browser hook caught by the `*.ts`-only include glob where §6's excused
components are `.tsx`, so it needs the RTL toolchain §6 anticipates, or a
logic extraction — not a line in the exclude list.

**`apps/tui/src`**

| File | Lines | Uncovered | What's there |
| --- | --- | --- | --- |
| `record-fill.ts` | 85.19% | `:303-304,544-545,579-580,602-607,615-616,743-752,761-766,787-792,799-804,817-818,820-821,846-851,858-859,873-878,883-889` | Not the "worst gap in the repo" on either measure (audit finding 3's headline overstated it): by line COUNT `events/parse.ts`'s 78 uncovered lines are more; by PERCENTAGE `apps/web/src/lib/dashboard.ts`'s 78.26% is lower. What is real: 65 lines across 15 ranges (`:761-766` bridges lines 763-764, which carry no statement, rather than splitting there — the run's own range, not a rounder-looking substitute), the largest share of any single file in this table. `:743-752` is the interactive "Also record N confirmed cancellation(s) in this act?" prompt arm — an operator-facing branch, not a rejection path. The remaining ranges are earlier refusal/assembly branches (`reject(io, …)` calls and the fill act's own re-parse/re-cross-reference of the transaction it just built) plus the `ordersToAppend` cancellation-sibling assembly; `record-fill.test.ts`/`record-fill-reliable.test.ts` drive the refusals earlier in the flow but not this full set of late-stage branches. |
| `import-orders.ts` | 89.21% | `:331-337,339-344,348-349,369-370,394-396,410-411,427-428,585-588` | Re-measured at `d5fe02c`, after #386 (the `interview-abandoned` refusal and the write-door guard, both now exercised — see below). `:331-337` is `loadInForceLadders`'s `catch` when `io.loadPlans` itself throws (an unreadable `plans.jsonl`); `:339-344` is its `load-failed` status branch (a malformed `plans.jsonl`; the run's own range bridges line 341, a continuation string with no statement, rather than splitting there); `:348-349` is its skipped-plan-line `io.err` report, entered only when the plans file carries a skip. `:369-370` is `declaredJoinsOnFile` picking up a record that already carries an explicit `planId`+`rungId` (a re-import of an already-declared join). `:394-396` is the `unreadable-export` refusal when the CSV itself cannot be read, `:410-411` is the `no-orders` refusal for a header-valid CSV with zero resting orders, and `:427-428` is the `unreadable-sidecar` refusal — the whole orders book could not be read at all (distinct from `unreadable-sidecar-lines`, a partially-read book, which is covered now). `:585-588` is the restatement-construction guard the file's own comment calls "UNREACHABLE, AND HANDLED ANYWAY" — defensive. The `interview-abandoned` refusal (#386) and the write-door guard ahead of every append are both covered; the funding-declaration report-join `io.err` this row used to cite is covered too. |
| `import-orders-rung-picks.ts` | 100% lines, 95.74% branch | `:150-151` | Added at `d5fe02c` — no row existed for this import-orders sibling before now. Two branch-only gaps, both in the batch-confirmation summary's per-order rendering: `:150-151` is each side's `?? "no rung declared at this price"` fallback (`silences.get(order.id)` on the un-proposed side, `labelOf(choices, proposed)` on the proposed side) — the fallback text itself is never produced by any current fixture, both sides always resolve to a real label. |
| `ingest-commit.ts` | 96.77% | `:114-115,142-143` | `:114-115` is the `git` spawn-failure branch (`spawnSync` itself erroring — a missing/unspawnable `git` binary) in the commit-capture path; `:142-143` is `resolveWorkspaceRoot`'s not-found-marker fallback to `process.cwd()` — defensive, real only if the walk up never finds `pnpm-workspace.yaml`. |
| `skip-message.ts` | 87.87% | `:45-48` | The `default: { const _never: never = … }` exhaustiveness latch — by construction, unreachable until a new `OrderRecordProblem` variant ships; it exists to make that day a compile error, not a runtime path any current fixture takes. |
| `available-capital.ts` | 100% lines, 92.3% branch | `:61` | One branch-only gap. |
| `gap-lines.ts` | 100% lines, 84.61% branch | `:86,156` | Two branch-only gaps: `:86` is `formatGapCheckFailure`'s non-`Error` fallback (`String(error)`); `:156` is one arm of `withheldLine`'s two-part concatenation (`lost > 0` / `venueDark > 0`) — both truthy together is not a combination any current fixture drives. |
| `fold-lines.ts` | 100% lines, 80% branch | `:50` | Added at `d5fe02c` — no row existed before #377. One branch-only gap: `formatFoldCheckFailure`'s non-`Error` fallback (`String(error)`) — the same defensive shape as `gap-lines.ts`'s `formatGapCheckFailure` above. |
| `review-file.ts` | 100% lines, 98.11% branch | `:116` | One branch-only gap (the root-only `EACCES` skip noted in §2 is separate). |

**`apps/price-feed/src`**

| File | Lines | Uncovered | What's there |
| --- | --- | --- | --- |
| `cli-main.ts` | 100% lines, 90.32% branch | `:98-100,111` | Added at `e1d6265` (PR #387 review finding 8 — §1 line 36 named this file only to say it is NOT excluded, with no figure and no gap accounted; that is not an accounting, so it gets a row). Four branch-only gaps in `runPriceFetchCli`: `:98-100` are the `deps.log ?? …` / `deps.logError ?? …` / `deps.run ?? runPriceFetch` default-value arms — every test injects its own `log`/`logError`/`run`, so the real defaults never execute; `:111` is `!(error instanceof PriceFetchRefusal)`'s true arm in the argv-parse `catch` — every current fixture's argv failure IS a `PriceFetchRefusal`, so the re-thrown-defect path is real, reachable, but untaken. |
| `banxico-provider.ts` | 92.59% | `:88-89,100-101` | `extractLatestDatum`'s malformed-payload throws: `:88-89` the unexpected SIE response shape, `:100-101` the unexpected FIX-observation shape. The middle throw (no FIX observation in the payload) is covered now — provider IO, same category as the Twelve Data row below. |
| `binance-provider.ts` | 89.65% | `:63-64,97-98,102-103` | Three malformed-kline-payload throws for the Binance provider: `:63-64` the invalid-target-date throw when the requested day can't be parsed, `:97-98` the unexpected-payload-shape throw (the settled row is not an array), `:102-103` the non-positive-close throw. One more than the previous vintage — the invalid-target-date throw was covered before and is not now. |
| `twelvedata-provider.ts` | 92.79% | `:128-129,181-182,190-191,226-227` | `:128-129` is the batched fetch's own unexpected-payload-shape throw (`failAll`, before any per-symbol dispatch); `:181-182` and `:190-191` are `observationFromBody`'s two unexpected-payload-shape throws (the symbol body itself, then its `values` array); `:226-227` is `barDateFromRow`'s no-usable-date throw. The rejected-symbol and non-positive-close throws this row used to cite are both covered now. |
| `price-store.ts` | 92.85% | `:33-34` | The non-`ENOENT` rethrow in the per-instrument file read (an unexpected fs error the call path does not otherwise produce — defensive, same shape as `event-store.ts`'s `readOptional`). |
| `provider.ts` | 100% lines, 91.17% branch | `:128,143-144` | `:128` is `fetchJson`'s `options.fetchImpl ?? fetch` default-value arm — every test injects its own `fetchImpl`, so the real default never runs; `:143-144` is the non-`Error` rejection-message fallback. The `AbortError`-timeout branch this row used to cite is covered now. |
| `rejection-check.ts` | 93.2% | `:168,173-177,278` | The pre-check's own swallow-into-non-fatal-note paths (unreadable log, missing genesis) documented in the package README as advisory-only. |
| `fetch-prices.ts` | 100% lines, 91.93% branch | `:223,405,431,506,535` | `:223` is `runPriceFetch`'s `options.now ?? (() => new Date())` default-value branch — every test injects its own `now`, so the real-default arm never runs; the `fetchImpl`/`sleepImpl` equivalents this row used to cite are covered now. `:405,431,506,535` are the four per-symbol/FIX `catch` blocks' non-triggered fallback arm in each failure-message construction — each catch itself runs (`fetch-prices.test.ts` drives real provider failures), just not with every individual thrown-error shape. |

**`apps/web/src`**

| File | Lines | Uncovered | What's there |
| --- | --- | --- | --- |
| `glance/row-view.ts` | 98.57% | `:141` | One rendering branch. |
| `glance/verdict.ts` | 99.08% | `:621-622` | `referenceLabel`'s invalid-calendar-date throw — defensive, every caller passes an already-validated `asOf`. The precedence-sort branch this row used to cite is covered now. |
| `lib/binance-spot.ts` | 0% | `:33-95` | Added at `d5fe02c` — no row existed before #377, and this one does not fit the defensive/unreached-fixture/real-branch taxonomy cleanly. `useBinanceSpotUsd` is a browser-only React hook (`useEffect`/`useState`) — the live-spot fetch, its success/failure/abort paths, and the last-close fallback are real, reachable browser behavior, not a script that runs on import (importing this file is inert; nothing executes until a mounted component calls the hook). It is uninstrumented for the same underlying reason §6 names for `SummaryCard`/`SectionTable`/`FillPath.tsx`/`PriceDropPathChart.tsx` — no RTL/jsdom toolchain to mount a component and drive the hook — except those are `.tsx` and excluded by the `*.ts`-only include glob, while this file is a `.ts` hook that IS in the glob and so reports a genuine, uninstrumented-in-practice 0% rather than being named as excluded. Flagged rather than forced into a label; closing it means either the RTL toolchain §6 already anticipates buying, or extracting the fetch/state-transition logic into a plain `.ts` function the way `price-drop-path.ts` did for the chart math. |
| `push/dca-block.ts` | 98.41% | `:278,283` | `:278` and `:283` are the `placedQuantity`/`venueFilledFraction` omit-when-undefined spread guards' omission arms — real, reachable: every current fixture supplies both fields, so the arm that would drop them from the view never fires. The file also carries four branch-only gaps this column does not cite (per the derivation rule above, a file below 100% lines cites only its line gaps): `:161` is `torn ?? []`'s default-array arm (every fixture supplies a torn-acts array); `:232` is `position?.lots ?? []`'s equivalent; `:236-237` are the `currency`/`reviewFx` field-presence spread guards, one arm each unexercised — same default-value shape, not a rejection path. |
| `push/unattended-report.ts` | 100% lines, 94.44% branch | `:78` | One branch-only gap: `linesFor`'s `this.#byKind.get(kind) ?? []` default-array arm — a real, reachable case (querying a `kind` nothing has been filed under yet), just not one any current fixture drives. |
| `ladder/convexity-caption.ts` | 100% lines, 95.65% branch | `:135` | One branch-only gap: the `clauses.length === 0` empty-caption arm — real, reachable (a ladder with nothing left to say), just not one any current fixture produces. |
| `ladder/fill-path-view.ts` | 98.52% | `:502,613,675-676` | Added at `e1d6265` (PR #387 review finding 8 — §6 line 483 named this file only in passing, "the measured `ladder/fill-path-view.ts`", with no figure and no gap accounted; that is not an accounting, so it gets a row). `:502` is the "this row carries no plan body" fallback in the price-axis kind check — real, reachable for a row whose kind is neither `dcaLadder` nor `dcaTime`, just not one any current fixture produces. `:613` is the zero-rungs arm of the reconciled progress percent (`rungs.length === 0 ? 0 : …`) — no current fixture drives a reconciled row with an empty rung list. `:675-676` is the `spot.status === "loading"` arm of the spot-price status derivation — a real, reachable mid-fetch state no current fixture captures. Branch-only companions (`:442,452,501,509,612,674,703,716`) live in the same functions but are not carried in this column, per the derivation rule above. |
| `push/anchor-fixture.ts` | 83.72% | `:88-93,95-96` | `loadAnchorFixture`'s schema-version-mismatch and empty-anchors-array throws — a fixture-regeneration guard, real but low-probability (the fixture is checked in and regenerated deliberately via `--fixture-only`). |
| `push/backfill-core.ts` | 95.78% | `:262-266` | An error-path branch in the replay loop: `deriveSnapshot`'s fold-as-of/requested-as-of mismatch guard. |
| `push/fixture-synthesis.ts` | 94.93% | `:440,445-447,462,464,470,511,571-574,586-589,712-713,736,809-810,816-817,1101-1102` | More synthesis-edge branches than the previous vintage (test infrastructure adjacent, but the module itself is product code per the `**/*.fixtures.ts` exclude boundary): `:440,445-447` a rung-axis weighting fallback and `:462,464,470,511` degenerate empty-object-spread guards in the non-cost scale/percentage math; `:571-574,586-589` are two defensive throws the file's own comments call "Unreachable through `synthesizeAnchors`" — a synthetic id/plan-id lookup that must never fall back to the real (private) value; `:712-713` a no-op early return; `:736` a percentage fallback; `:809-810` `resolveTargetInvestedPct`'s no-pinned-rows minimum; `:816-817` a zero-weights map guard; `:1101-1102` the synthetic-NAV seed fallback. |
| `push/gap-report-core.ts` | 100% lines, 97.61% branch | `:209` | One branch-only gap. |
| `push/glance.ts` | 100% lines, 93.18% branch | `:93-94,108` | Branch-only gaps: `:93` is `data.closes ?? []`'s default-array arm (the fold always carries a `closes` array in every fixture), `:94` is the future-dated-close skip (`close.asOf > asOf`) never taken, and `:108` is `data.instruments ?? []`'s equivalent default-array arm. |
| `auth/verify-rate-limit-core.ts` | 100% lines, 92% branch | `:117,171` | Branch-only gaps in the attack script's decision core. |

**`packages/engine/src`**

| File | Lines | Uncovered | What's there |
| --- | --- | --- | --- |
| `parse.ts` | 97.72% | `:150-151,235-236,263-264,403-404` | Four per-field genesis-door rejection branches, same category as §5's `events/parse.ts` gap: `:150-151` is `validateNamedRecords`'s `!Array.isArray(value)` guard, `:235-236` is `validateReserves`'s equivalent, `:263-264` is `validatePositions`'s equivalent, and `:403-404` is `validateCapitalRecordIds`'s non-object/non-string-`id` skip. |
| `calendar.ts` | 95.12% | `:80-81` | Added at `d5fe02c` — no row existed before #377. `utcWeekday`'s invalid-calendar-date throw — defensive, its callers (`isWeekend` at `:51` and `weekdayName` at `:74`) both pass an already-validated `asOf`; the `caller` parameter `utcWeekday` takes to label its throw is itself the tell that it has more than one. |
| `fill-path.ts` | 97.75% | `:176,262-263,265-266` | Added at `d5fe02c` — no row existed before #377. `:176` is a rendering branch in the "filled" label (the `book === "not-recorded"` false arm, "filled at venue — partly recorded"). `:262-263` is the retired-placement join's declared-join-invalid fallback to `undefined` and the no-declaration price-match fallback — both real, reachable, but no current fixture has a retired/cancelled placement that fails its declared join or carries no declaration at all; `:265-266` is the resulting skip (`rungId === undefined`, or `joined.has(rungId)`) that never fires because those fallbacks never run. The file also carries branch-only gaps this column does not cite: `:175` and `:258,261-262,264,270` are the same rendering label and retired-placement join's other arms (`:270` is `declaresSomething ? "declared" : "price-matched"`'s `"price-matched"` arm, unreachable for the same reason as `:262-266`); and `:444` — not `:443`, which executes 198 times and carries no branch at all — is one arm of the `bookAxis` three-way classification (`booked <= 0 ? "not-recorded" : booked >= consumed ? "recorded" : "partly-recorded"`), measuring 2/3. All real, reachable branches — none defensive, none low-value. |
| `report.ts` (compose) | 99.63% | `:216` | One rendering branch. |
| `profit-split.ts` (compose) | 100% lines, 89.28% branch | `:136,185,194` | Branch-only gaps in the profit-split obligation renderer. |
| `durable-log.ts` | 100% lines, 85.71% branch | `:136` | One branch-only gap. |
| `orders/bitget.ts` | 92.13% | `:149-150,308-312,340-342,420-422,429-433` | `:149-150` the quoted-CSV-field escaped-quote-toggle branch in the line splitter; `:308-312` the malformed-column-count skip and `:340-342` the malformed-`side` skip in the open-orders row reader; `:420-422,429-433` are the `total_quantity`/`trigger_price` malformed-cell rejections — same per-field CSV-row rejection shape this module already documents elsewhere. |
| `orders/ingest.ts` | 96.71% | `:212,453-456,488-489` | `:212` is the `filledQuantity` presence branch in the "one id, one claim" cumulative-fill merge — a real comparison arm no current fixture's colliding-id merge exercises. `:453-456` is a `const _never: never = record` exhaustiveness latch (compile-time only, same defensive pattern as `skip-message.ts`/`orders/select.ts` below — `parseOrderRecord` refuses an unknown `kind` before it can reach here). `:488-489` is the live `orderType` difference-detection branch in `detectChangedClaims` — a real comparison arm no current fixture's claim/observation pair exercises. (The `timeInForce` equivalent this row used to cite is covered now.) |
| `orders/records.ts` | 86.02% | `:542-543,594-595,606-607,609-610,615-620,622-627,639-644,658-663,713-718` | Per-field malformed-value rejections across the `orderPlaced`/`orderFilled` record parsers — the same per-field pattern as `events/parse.ts`; `:658-663` (`timeInForce`) and `:713-718` (`filledQuantity`) were the originally-named gap fields, the rest are the remainder of that same field-by-field rejection sweep. |
| `orders/select.ts` | 94.8% | `:226-229` | The same `_never` exhaustiveness latch as `orders/ingest.ts:453-456` — unreachable at runtime by construction, kept live rather than assumed so a new `OrderRecord` kind fails the build instead of silently falling through. |
| `orders/fill.ts` | 98.07% | `:72-73` | A malformed-capture guard in the sidecar-comment order-id/observedAt parser, returning `undefined` for a shape no current fixture produces. |
| `orders/coverage.ts` | 100% lines, 91.66% branch | `:185` | One branch-only gap (the O1 guard extracted by audit finding 33 / C1). |
| `orders/monotonicity.ts` | 100% lines, 97.67% branch | `:350` | One branch-only gap. |
| `price-feed/derive.ts` | 96.36% | `:104-105` | `parseIsoDateUtc`'s malformed-date-format throw — defensive, every caller passes an already-validated `YYYY-MM-DD`. |
| `price-feed/mark.ts` | 90.9% | `:150-151,164-165,169-170` | `:150-151` is `localDateParts`'s "unable to resolve trading day for timezone" throw when the `Intl.DateTimeFormat` parts lack a year/month/day; `:164-165,169-170` are `parseMarkTime`'s malformed-format and out-of-range-hour/minute throws — all defensive, `DEFAULT_CONFIG.markTime` and any override are validated shapes, not raw operator input. |
| `reconciliations.ts` (engine package — distinct from `reconciliations.ts` (preferences package) below) | 98.02% lines, 98.46% branch | `:357-359` | Added at `e1d6265` (PR #387 review finding 1 — this file had no row anywhere in the document; it hid behind the preferences package's same-named `reconciliations.ts` row, which every earlier `grep "reconciliations"` sweep matched and stopped at). `:357-359` is the body of the `default: { … }` exhaustiveness latch on `lookup.status` (`const unreachable: never = lookup; return unreachable;` — the `default:` line itself, `:356`, carries the branch but no statement, so it is a branch-only companion this column does not cite) — same `_never`-style category as `skip-message.ts` / `orders/ingest.ts` / `orders/select.ts` above and `events/fold.ts`'s `foldEvents` latch in §5: unreachable at runtime by construction, kept live so a new `PlanLookup` status variant fails the build rather than falling through silently. |

**`packages/event-store/src` and `packages/preferences/src`**

| File | Lines | Uncovered | What's there |
| --- | --- | --- | --- |
| `heartbeat.ts` | 97.82% | `:199-200` | One branch past the documented "taken as written for v2, never synthesized" guard. |
| `gap-report.ts` (event-store package — distinct from `apps/web/src/push/gap-report.ts` (§1, the excluded self-executing shell) and `push/gap-report-core.ts` above (§7, its measured core)) | 100% lines, 98.14% branch | `:398` | Added at `e1d6265` (PR #387 review finding 1 — this file had no row anywhere in the document; it hid behind two other same-named or near-same-named files, both already accounted for elsewhere, that every earlier `grep "gap-report"` sweep matched and stopped at). One branch-only gap: `EXPECTED_BY_SOURCE[source] ?? 0`'s default-value arm in the venue-dark accounting loop — real, reachable (a `PriceSource` whose expected-count table carries no entry for it), just not one any current fixture drives. |
| `preferences.ts` | 98.78% lines, 95.31% branch | `:252-253` | Re-measured at `d5fe02c`, after #385 (+27/-19). Spec #320 made the loader total, so **the non-`ENOENT` rethrow this row originally named no longer exists** — that path is the `load-failed` arm of the returned envelope and is covered, as is the split-denominator guard the original row's other citation pointed at. What remains is one arm and it is not a behavior: `:252-253` is `readFailureCode`'s `return "unknown-read-error"` — the non-`Error` fallback, reachable only if something other than an `Error` is thrown out of `readFile`. |
| `orders.ts` (preferences package) | 94.64% lines, 90.9% branch | `:73-75` | Re-measured at `d5fe02c` — unchanged since `0428f75` despite #385 touching the package (that PR's edits landed in `sidecar-io.ts` and `preferences.ts`, not here). Two of this row's three original citations pointed **past the end of the file** — `orders.ts` is 147 lines — because the code they named moved out: the non-`ENOENT` rethrow on the sidecar read (cited `:181-182`) and the lock-contention retry path in the advisory file lock (cited `:222-223,225-227,229-230`, `open(lockPath, "wx")` racing another writer) now live in the shared `sidecar-io.ts` and are not in this file at all. What is left is the row's first citation, at its new lines: `:73-75` is `defaultWarn`'s `console.warn` fallback when no `warn` is injected. |
| `sidecar-io.ts` | 92.47% lines, 93.93% branch | `:152-153,200-205` | Added at `d5fe02c` — no row existed before #377. `:152-153` is the private `readOptional`'s non-`ENOENT` rethrow — the same shape `orders.ts`'s row above notes was split out of that file into this one (see ADR-013's note on the deliberate duplication) — defensive. `:200-205` is `withAppendLock`'s `LOCK_TIMEOUT_MS`-exceeded refusal throw, taken when another writer has held the append lock past 10s — real, reachable lock-contention behavior no current fixture drives. |
| `plans.ts` (preferences package) | 96.39% lines, 93.6% branch | `:160-161,203-204,206-207,301-302,325-326,391-392` | Added at `d5fe02c` — no row existed before #377. All six are per-field malformed-value rejections, same shape as `orders/records.ts` above: `:160-161` `tierOrderProblem`'s non-array/empty-array guard, `:203-204` and `:206-207` `rungsProblem`'s non-object-rung and missing-`id` guards, `:301-302` the top-level `kind`-must-be-a-string guard, `:325-326` the `noPlan` variant's `reason`-must-be-a-string-when-present guard, and `:391-392` the `dcaTime` variant's `cadence`-must-be-a-string guard. |
| `reconciliations.ts` (preferences package — distinct from `reconciliations.ts` (engine package) above) | 86.66% lines, 85.05% branch | `:186-190,200-201,203-207,215-218,222-227,239-243,277-278,329-330,350-355,524-526` | Added at `d5fe02c` — no row existed before #377. Re-derived from scratch off `coverage-final.json` at `e1d6265` (PR #387 review finding 6: the previous version of this row was #377's stale table with `+3` added to every number, including two break points today's run does not produce — a shift, not a fresh measurement, however the PR body described it). Nine of the ten ranges are the same per-field malformed-value rejection shape, spread across `readDeclared` (`:186-190` the `ended` variant's `effectiveAt` guard, `:200-201` the `kind` guard, `:203-207` the in-force `effectiveAt` guard, `:215-218` the `tierOrder` guard, `:222-227` the `planId` guard, `:239-243` the unknown-`status` default) and `readReconciliationLine` (`:277-278` the whole-line-not-an-object guard, `:329-330` the `fillKind` guard, `:350-355` the `mismatches`-must-be-an-array guard). The tenth, `:524-526`, is different in kind: `appendReconciliation`'s round-trip self-check — a `JSON.parse` catch on the string this module's own serializer just produced, reachable only if the serializer itself emits invalid JSON — defensive against its own bug, not malformed input. |

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
