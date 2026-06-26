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

## 3. Low-value presentation branches (deferred with #72)

**`packages/engine/src/format.ts`** (99.3% lines) — display-string branches in
the CLI report that carry no logic, reachable only by hand-building zero-state
`CompositionReport`s:

- `formatRowFocus` `if (!row) return "No live records"` (~L128) — an undefined
  summary focus (empty section).
- `formatDataSafety` `shortDeferred > 0` ternary and the `warnings.length > 0 ?
  … : "no warnings"` strings (~L141-142, L150, L173).

These are pure presentation. They share the display layer with the renderer work
in **#72** and are folded into that issue rather than tested here.

**`packages/engine/src/price-journey.ts`** (100% lines) — the journeys sort
comparator's `|| a.label.localeCompare(b.label)` tie-break (~L104 branch) runs
only when two journeys have equal point counts. A tie-break ordering detail; not
worth a crafted multi-journey fixture this increment.

## 4. Real, reachable behavior — not yet tested (tracked in #72)

This is the honest part: the following are **not** defensive and **not**
low-value. They are shippable behavior that the suite does not yet exercise, so a
regression could pass green. They are deferred to a dedicated increment, not
excused. See **[#72](https://github.com/AmetAlvirde/numisma/issues/72)**.

**`packages/engine/src/compose.ts`** (94.0% lines / 90.1% branches)

- Reserve missing-reference exclusion (~L286-289).
- Position `unsupported-execution-mode` warning + exclusion (~L342-351).
- Position `currency-mismatch` warnings against Account and Instrument currency
  (~L399-417).
- Lot-level invalid-numeric warnings: empty lots, non-numeric quantity/cost,
  invalid `entryFx` (~L429-437).
- `detailLinesForRow` portfolio / tempo / account drill-down filtering
  (~L530-556).

**`packages/tui/src/dashboard.ts`** (94.5% lines / 86.4% branches)

- Empty-section "No live records." line (~L141-143).
- Empty-detail body message and `emptyDetailMessage` variants (~L297, L341-351).
- Tier-expansion row rendering and `detailTitle` tempo/account branches
  (~L336-351).
- Summary "No live records" fallback (~L383-384).
- Typed-row detail-table rendering branches (tempo/account/reserve) still
  partially uncovered (~L243-258 branches).

## What this number means

After this pass, every Node module's *meaningful, reachable* behavior is either
unit-tested or listed in §4 with an owning issue. §1–§3 account for what is
deliberately not in the number. "Reliable" here means *measured and accounted
for* — not "100% of everything," and explicitly not yet covering the §4 behavior
or the Bun-only wiring.
