# Coverage rationale

`pnpm coverage` reports a measured Node-side number (see
[`packages/tui/README.md`](../packages/tui/README.md#coverage) for the Node/Bun
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
| `packages/tui/src/app.ts` | Self-executing Bun entry: top-level `await`, openTUI renderer construction, `process.exit` startup glue. Never runs under Node's `vitest run`. | `pnpm dev` (manual) + the keypress smoke for the wiring it delegates to. |
| `packages/tui/src/mount-app.ts` | Bun-only openTUI wiring (`@opentui/core` import, keypress subscription, `requestRender`). Never runs under Node. | `pnpm smoke:tui` drives real `j`/`k`/`enter` through it on the real openTUI test renderer. |
| `packages/tui/src/smoke-openTui.ts` | The Bun smoke harness itself. | It *is* the test; running it (`pnpm smoke:tui`) is the assertion. |
| `packages/tui/src/report.ts` | A 22-line `tsx` CLI script: a top-level `try/catch` orchestrating already-tested functions (`resolveFundReviewFilePath`, `loadFundReview`, `buildCompositionReport`, `formatCompositionReport`). Same category as the script entries above — no unit to assert beyond a `process.stdout.write`. | Its constituent functions are unit-tested directly (`review-file.test.ts`, `fund-composition.test.ts`). |

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

**`packages/tui/src/review-file.ts`**

- `normalizeLoadFundReviewError` `error instanceof Error ? error : new
  Error(String(error))` false branch (~L108) — the only throwers reaching it
  (`readFile`, `parseFundReviewError`) throw `Error` instances; the
  non-`Error` fallback is a defensive coercion. (The `ENOENT`/`EISDIR`/`EACCES`
  branches above it *are* tested, the last one skipped only when running as
  root — see `review-file.test.ts`.)

**`packages/engine/src/compose.ts`**

- `buildCanonicalState` Reserve `portfolioLabel` fallback
  `portfolios.get(reserve.portfolioId)?.name ?? reserve.portfolioId` (~L329) and
  the Position `portfolioLabel` fallback (~L480) — both run only after
  `validateCapitalBase` has already excluded any record whose `portfolioId` is
  missing, so `portfolios.get(...)` always resolves and the optional-chain /
  `?? id` miss is unreachable.
- `accountLabel` `account ? … : fallback` false branch (~L736) — same reason:
  `validateCapitalBase` excludes any record with a missing `accountId`, so every
  record that reaches `accountLabel` has a resolved Account.

**`packages/engine/src/format.ts`**

- `sectionRows` `?.rows ?? []` miss (~L150) — the five composition sections are
  always present in the report, so `.find(...)` never returns undefined and the
  `?? []` fallback is unreachable from `formatCompositionReport`.

**`packages/tui/src/dashboard.ts`**

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

- **`packages/engine/src/compose.ts`** (100% lines) — Reserve missing-reference
  exclusion, Position `unsupported-execution-mode`, Account/Instrument
  `currency-mismatch`, Lot-level invalid-numeric warnings (quantity/cost/
  `entryFx`, plus the empty-`lots` guard for non-parse callers), and
  `detailLinesForRow` portfolio/tempo/account drill-down filtering — all in
  `fund-composition.test.ts`. (`parseFundReview` rejects empty `lots`, so that
  one guard is exercised through the public `buildCompositionReport` with a
  directly-built `FundReviewData`, the same way the TUI tests do.)
- **`packages/tui/src/dashboard.ts`** (100% branches) — empty-section "No live
  records." rows, the Portfolio empty-detail message, typed vs untyped detail
  columns, zero-denominator tier-table guards, and the `detailTitle` /
  summary-focus placeholder branches — all in `dashboard.test.ts`.
- **`packages/engine/src/format.ts`** (100% lines) — the `formatRowFocus`
  "No live records" placeholder, the `formatDataSafety` "no warnings" string,
  and the empty-section body — all in `fund-composition.test.ts`.

What remains uncovered after #72 is only the §2 defensive guards and the §3
tie-break — each listed there with a concrete reason.

## What this number means

After this pass, every Node module's *meaningful, reachable* behavior is
unit-tested; §1–§3 account, concretely, for everything still outside the number.
"Reliable" here means *measured and accounted for* — not "100% of everything,"
and explicitly not covering the Bun-only wiring.
