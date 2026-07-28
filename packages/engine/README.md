# @numisma/engine

The Node-compatible Fund composition domain. It parses untrusted input, validates
portfolio events, folds an immutable genesis seed plus an append-only event log
into the canonical composition read model, and formats it for display. It is also
the pure core of the two-plane price model
([ADR-005](../../context/adr/ADR-005-two-plane-price-model.md)): the instrument
registry, the trading-day/mark-instant contract, quote → `PriceMarked`
construction, and the USD×FIX MXN derivation — all IO-free, with the fetch/IO
shell in `@numisma/price-feed`. It has
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
| `applyReserveDelta`, `reserveDeltasForOpen`, `reserveDeltasForClose`, `splitTierRemoval`                          | functions | The fold's reserve-mutation helpers — the cash leg that rides atomically on each trade leg (funding on open, settlement on close/trim) — plus `splitTierRemoval`, which removes a trim's `quantity` pro-rata across the lots within one Capital Tier.                                       |
| `composeProfitSplit`, `pickPolicyAsOf`, `defaultProfitPolicyEntry`                                                | functions | The derived, descriptive-only profit-split layer: `composeProfitSplit` computes the split obligation on the exact cumulative total realized (default 60/40 high-water-mark, no clawback; `perClose` selectable), obligation-only and empty-guarded so it is never fed into NAV; `pickPolicyAsOf` is the pure as-of selector over the preferences sidecar; `defaultProfitPolicyEntry` is the fund's locked 60/40 default. |
| `migrateLegacyEvent`, `EVENT_SCHEMA_VERSION`                                                                      | function, value | The durable-log versioning contract (ADR-003 amendment): the current schema-version marker and the one-shot, operator-supplied migration from a legacy log line.  |
| `buildEventReference`, `applyEventToReference`, `crossReferenceEvent`                                             | functions | The ingest cross-reference: a reference of known ids + last Closes from genesis, advanced per event, that rejects unknown-id / colliding-id / implausible-magnitude events. |
| `PRICE_MARK_MAGNITUDE_THRESHOLD`, `SETTLEMENT_MAGNITUDE_THRESHOLD`                                                | values    | The tunable deviation thresholds the `PriceMarked` and settlement magnitude guards use (catch currency-unit / fat-finger marks and implausible cash settlements).       |
| `instrumentsForSource`, `resolveInstrument`, `tradingDayAsOf`, `isAtOrAfterMarkTime`, `priceMarkId`, `markFromQuote`, `requireFreshFix`, `deriveMxnMark`, `mergeInbox`, `priceStoreFileName`, `INBOX_PATH_SEGMENTS`, `PRICE_STORE_DIR_SEGMENT` | functions, values | The pure price-feed core (ADR-005): the typed instrument registry lookup, the timezone-anchored trading-day / mark-time contract and deterministic `pm-<id>-<asOf>` id, quote → real `PriceMarkedEvent` construction, the fresh-FIX guard + `USD × FIX` MXN derivation, the non-clobbering inbox merge, and the shared store/inbox path segments. All IO-free — the fetch/store/schedule shell is `@numisma/price-feed`. |
| `formatCompositionReport`, `formatReserveReconciliation`, `formatClosedBook`, `formatInvalidationWatch`, `formatProfitSplit` | functions | Render, from a `CompositionReport`: the CLI composition report, the reserve-reconciliation view, the realized-P&L closed-book blotter (descriptive only — realized profit already sits in a Reserve, never re-added to NAV), the invalidation watch, and the obligation-only profit-split block (obligation + RESERVE %-of-NAV-vs-target; no routed-flow line). The descriptive review sections render nothing when empty. |
| `formatUsd`, `formatMaybeUsd`, `formatPrice`, `formatSignedPercent`, `formatPercent`, `pad`, `padLeft`, `divider` | functions | The shared formatters — the **one** source of truth for the "USD to cents" / padding / precision conventions. The TUI imports these rather than keeping private copies. |
| `validationSeverityByCode`                                                                                        | value     | Maps each validation code to its severity.                                                                                                                              |
| domain & event types, read models                                                                                 | types     | `FundReviewData`, `CompositionReport`, `DashboardDetail`, `Warning`, `ParseResult`, the ten-verb event union (`PortfolioEvent`, `PositionOpenedEvent`, …, `PositionTrimmedEvent` with its `TierRemoval`, `PositionAddedToEvent`, `InvalidationMarkedEvent` with its `InvalidationDirection`, `ReserveOpenedEvent` — ADR-012, currently `assurance: prototype`), the closed-book / invalidation read models (`ClosedPositionRecord` incl. its `partial` / `markVsFill` trim disclosure, `RealizedTierAttribution`, `ClosedBook`, `RealizedRollupRow`, `InvalidationLevel`, `InvalidationWatchRow`), the profit-split layer (`ProfitSplit`, `ProfitPolicy`, `ProfitPolicyEntry`, `SplitBasis`), the price-feed core (`PriceSource`, `InstrumentRegistryEntry`, `Quote`, `MarkClock`, `FixObservation`, `InboxRecord`, `InboxMergeResult`), `EventParseResult`, `EventReference`, … |

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
| `compose/canonical.ts` | internal                                     | Canonical-state construction, grouping, and Capital-Tier rollup. `buildCanonicalState` feeds both the report and the drill-down; the canonical-state types (`CanonicalLine`, `GroupAccumulator`) stay internal.                          |
| `compose/report.ts`    | `buildCompositionReport`                     | The `CompositionReport` read model, built over the canonical state — including the realized-P&L closed book (the fold's `closedPositions[]` as a blotter, rolled up by Tempo and Tier) and the invalidation watch. |
| `compose/detail.ts`    | `buildDashboardDetail`                        | Dashboard detail drill-down, built over the canonical state.                                                                           |
| `price-journey.ts`     | internal                                     | `buildPriceJourneys`, `latestCloseByInstrument`, and the markPrice/Close coherence tolerance. Consumed by `compose/canonical.ts`; not on the public surface.                                                                            |
| `events/types.ts`      | event types                                  | The ten-verb `PortfolioEvent` union and its members (incl. `PositionTrimmedEvent { positionId, removals: TierRemoval[], settlement }` — partial profit-taking that keeps the Position open; `PositionAddedToEvent { positionId, lot, funding }` — scale-in that appends a lot, no realized P&L; `InvalidationMarkedEvent { positionId, price, direction }` with `InvalidationDirection` = `below`/`above`, latest-wins per Position; `ReserveOpenedEvent { reserve: {id, portfolioId, tempo, executionMode, accountId, currency} }` — births an empty, NAV-neutral cash container, ADR-012, currently `assurance: prototype` on an unmerged branch), the cash-leg shapes (`OpenFunding`, `CloseSettlement`), and the event result types (`EventParseResult`, `EventError`, …). |
| `events/parse.ts`      | `parseEvent`, `migrateLegacyEvent`, `EVENT_SCHEMA_VERSION` | Structural validation of one untrusted line into a typed event, plus the durable-log version marker (still `2` — the trim/add and `ReserveOpened` verbs are additive, no migration) and the one-shot legacy migration (ADR-003 amendment).                                                       |
| `events/fold.ts`       | `foldEvents` + reserve-delta helpers         | The genesis-bound fold to `FundReviewData`. Reserves are mutated by the fold via `applyReserveDelta` / `reserveDeltasForOpen` / `reserveDeltasForClose` (the cash leg) while the fold stays a pure projection. On close it also emits `closedPositions[]` — realized Trading P&L (proceeds − lot USD cost basis, per Tier), descriptive-only and never added to NAV — and folds `InvalidationMarked` levels onto the open Positions. A `PositionTrimmed` removes lots pro-rata within a Tier via `splitTierRemoval`, settles the cash leg, and emits a **partial** `closedPositions[]` row (`partial: true`, sharing the surviving Position's id, with a `markVsFill` NAV-honesty disclosure); a `PositionAddedTo` appends a new lot funded by its cash leg; a `ReserveOpened` inserts a new Reserve at `amount: 0, lots: []` (the empty array, not an absent field, matters — see ADR-012). |
| `events/crossref.ts`   | the ingest cross-reference + magnitude guards | `buildEventReference` / `applyEventToReference` / `crossReferenceEvent` over known ids + last Closes, plus the `PRICE_MARK_MAGNITUDE_THRESHOLD` and `SETTLEMENT_MAGNITUDE_THRESHOLD` guards; `crossReferenceReserveOpened` hard-rejects an id collision or a Reserve/account currency mismatch at ingest (ADR-012).                                             |
| `compose/profit-split.ts` | `composeProfitSplit`, `pickPolicyAsOf`, `defaultProfitPolicyEntry` | The derived, descriptive-only profit-split layer + its preferences-sidecar policy types. `composeProfitSplit` computes the split obligation on the exact cumulative total realized (default 60/40 high-water-mark, no clawback; `perClose` selectable), obligation-only and empty-guarded so nothing reaches NAV. `pickPolicyAsOf` is the pure as-of selector over the append-only `data/preferences.jsonl` sidecar (decoupled from the event log; sidecar file IO stays in the TUI per ADR-001 / ADR-004). |
| `format.ts`            | formatters + `formatCompositionReport` + `formatReserveReconciliation` + `formatClosedBook` + `formatInvalidationWatch` + `formatProfitSplit` | The shared formatters (exported), the CLI composition renderer, the reserve-reconciliation renderer, and the closed-book blotter + invalidation-watch + obligation-only profit-split renderers (each renders nothing when empty). |
| `price-feed/registry.ts`, `price-feed/mark.ts`, `price-feed/derive.ts`, `price-feed/inbox-merge.ts` | the price-feed core exports | The pure two-plane price core (ADR-005), IO-free: `registry.ts` is the typed instrument registry (crypto via Binance, US equities + `*-mxn` SIC rows via Twelve Data) with `instrumentsForSource` / `resolveInstrument`; `mark.ts` is the `Quote` shape + the timezone-anchored `tradingDayAsOf` / `isAtOrAfterMarkTime` mark-instant rule, the deterministic `priceMarkId`, and `markFromQuote`; `derive.ts` is `requireFreshFix` (loud stale/missing-FIX guard) + `deriveMxnMark` (`USD close × Banxico FIX`, `usdMxn` attached); `inbox-merge.ts` is the non-clobbering `mergeInbox` + shared store/inbox path segments. The fetch/store/schedule shell consuming these is `@numisma/price-feed`. |

Dependency direction: `contracts.ts` → (`internal.ts`, `price-journey.ts`) →
`parse.ts` / `compose/*` / `events/*` / `price-feed/*` / `format.ts` → `index.ts`.
The `price-feed/*` modules depend only on `contracts.ts` (the `Currency` type) and
`events/types.ts` (the `PriceMarkedEvent` they construct). The event
modules reuse `parseFundReview` (to re-validate genesis) and the composition read
model; `contracts.ts` depends on nothing else in the package, so there are no
cycles.

> Note: the behavioral suite is split to mirror the modules —
> `fund-composition-{parse,tiers,warnings,dashboard}.test.ts` over a shared
> `fund-composition.fixtures.ts`, with a `fund-composition.test.ts` remainder for
> the `buildCompositionReport` core; `cash-settlement.test.ts` and
> `cash-settlement-scenarios.test.ts` over `cash-settlement.fixtures.ts` (the cash
> leg); `fold.test.ts` and `event-ingest.test.ts` (the event-sourcing spine);
> `parse-validation.test.ts`; and `engine-internals.test.ts`.

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
