# @numisma/engine

The Node-compatible Fund composition domain. It parses untrusted input, validates
portfolio events, folds an immutable genesis seed plus an append-only event log
into the canonical composition read model, and formats it for display. It has
**no** dependency on Bun, openTUI, or terminal rendering, so any access surface
(the TUI today, a web or automation surface later) can consume it through one
curated entry point — see
[ADR-001](../../context/adr/ADR-001-package-boundary-and-runtime-split.md). The
event log + genesis fold model is
[ADR-003](../../context/adr/ADR-003-event-log-genesis-fold-persistence.md); the
pure fold and event validation live here, while the file IO that drives them
stays in `@numisma/tui`.

## Public surface

Everything the package exports is enumerated explicitly in `src/index.ts` (no
blanket `export *`). The public surface is:

| Export                                                                                                            | Kind      | Purpose                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parseFundReview`                                                                                                 | function  | Turn untrusted input into a typed `FundReviewData` or a blocking `ParseResult`.                                                                                         |
| `buildCompositionReport`                                                                                          | function  | Build the canonical `CompositionReport` read model from parsed data.                                                                                                    |
| `buildDashboardDetail`                                                                                            | function  | Drill a dashboard row down into its contributing records.                                                                                                               |
| `parseEvent`                                                                                                      | function  | Structurally validate one untrusted log line / inbox entry into a typed `PortfolioEvent` or an `EventError`.                                                            |
| `foldEvents`                                                                                                      | function  | Fold a genesis `FundReviewData` + ordered events into the read model, optionally as of a date (an `asOf` before genesis fails loud).                                     |
| `buildEventReference`, `applyEventToReference`, `crossReferenceEvent`                                             | functions | The ingest cross-reference: a reference of known ids + last Closes from genesis, advanced per event, that rejects unknown-id / colliding-id / implausible-magnitude events. |
| `PRICE_MARK_MAGNITUDE_THRESHOLD`                                                                                  | value     | The tunable deviation threshold the `PriceMarked` magnitude guard uses (catches currency-unit / fat-finger marks).                                                       |
| `formatCompositionReport`                                                                                         | function  | Render the CLI text report from a `CompositionReport`.                                                                                                                  |
| `formatUsd`, `formatMaybeUsd`, `formatPrice`, `formatSignedPercent`, `formatPercent`, `pad`, `padLeft`, `divider` | functions | The shared formatters — the **one** source of truth for the "USD to cents" / padding / precision conventions. The TUI imports these rather than keeping private copies. |
| `validationSeverityByCode`                                                                                        | value     | Maps each validation code to its severity.                                                                                                                              |
| domain & event types, read models                                                                                 | types     | `FundReviewData`, `CompositionReport`, `DashboardDetail`, `Warning`, `ParseResult`, the event union (`PortfolioEvent`, `PositionOpenedEvent`, …), `EventParseResult`, `EventReference`, … |

Consumers must import only from the package root (`@numisma/engine`). Deep
imports into engine internals are not part of the contract; `pnpm typecheck` is
the mechanical guard for both the public surface and the no-deep-import
boundary.

## Module layout

The domain is split into concern-sized modules behind the curated barrel. Each
imports the shared kernel rather than re-copying cross-concern helpers.

| Module             | Public?                                          | Responsibility                                                                                                                                                                                                                         |
| ------------------ | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`         | entry                                            | Curated public surface — names every export deliberately.                                                                                                                                                                              |
| `contracts.ts`     | types only                                       | Domain types, read models, `ParseResult`/`Warning` unions, and the assurance vocabulary. The leaf of the dependency graph (shapes, no behavior).                                                                                       |
| `internal.ts`      | internal                                         | The shared kernel: cross-concern helpers (`toUsd`, `percentOfFund`, `roundNumber`, `indexById`, `pushWarning`, `schemaError`, `requireNonEmptyString`, `isIsoDate`, and the `is*` type guards). Defined exactly once; not re-exported. |
| `parse.ts`         | `parseFundReview`                                | `parseFundReview` plus every `validate*` / `require*` / guard that validates the review file.                                                                                                                                          |
| `compose.ts`       | `buildCompositionReport`, `buildDashboardDetail` | Canonical-state construction, grouping, Capital-Tier rollup, and dashboard detail drill-down. The canonical-state types (`CanonicalLine`, `GroupAccumulator`) stay internal.                                                           |
| `price-journey.ts` | internal                                         | `buildPriceJourneys`, `latestCloseByInstrument`, and the markPrice/Close coherence tolerance. Consumed by `compose.ts`; not on the public surface.                                                                                     |
| `fold.ts`          | event verbs + `foldEvents` + the cross-reference | The event-sourcing spine (ADR-003): the `PortfolioEvent` union, `parseEvent`, the genesis-bound fold to `FundReviewData`, and the ingest cross-reference (`buildEventReference` / `applyEventToReference` / `crossReferenceEvent` + the magnitude guard). |
| `format.ts`        | formatters + `formatCompositionReport`           | The shared formatters (exported) and the CLI composition renderer.                                                                                                                                                                     |

Dependency direction: `contracts.ts` → (`internal.ts`, `price-journey.ts`) →
`parse.ts` / `compose.ts` / `fold.ts` / `format.ts` → `index.ts`. `fold.ts`
reuses `parseFundReview` (to re-validate genesis) and the composition read model;
`contracts.ts` depends on nothing else in the package, so there are no cycles.

> Note: the behavioral suite spans `fund-composition.test.ts` (the composition
> read model — predates the module split and still lives under its original name),
> `fold.test.ts` and `event-ingest.test.ts` (the event-sourcing spine),
> `parse-validation.test.ts`, and `engine-internals.test.ts`. Splitting
> `fund-composition.test.ts` to mirror the new modules is deferred until
> navigation cost demands it.

## Conventions

- ESM with explicit `.js` import extensions
  (`import { toUsd } from "./internal.js"`), matching the rest of the workspace.
- Internal symbols (the kernel, `price-journey` builders, canonical-state types,
  and the package-internal `NamedRecord` / `CapitalRecordBase` contracts) are
  never re-exported from `index.ts`.

## Verification

From the repo root:

- `pnpm typecheck` — guards the public surface and the no-deep-import boundary.
- `pnpm test` — the behavioral suite plus the characterization snapshots and the
  engine↔TUI formatter contract test.
- `pnpm coverage` — the measured Node-side coverage number. Everything it does
  not cover (defensive/unreachable guards, a low-value sort tie-break, and the
  newly-added event-sourcing spine's partially-covered remainder) is accounted
  for in [`docs/coverage-rationale.md`](../../docs/coverage-rationale.md).
