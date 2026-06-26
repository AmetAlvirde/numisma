# @numisma/engine

The Node-compatible Fund composition domain. It parses an untrusted Fund review
file, builds the canonical composition read model, and formats it for display.
It has **no** dependency on Bun, openTUI, or terminal rendering, so any access
surface (the TUI today, a web or automation surface later) can consume it
through one curated entry point — see
[ADR-001](../../context/adr/ADR-001-package-boundary-and-runtime-split.md).

## Public surface

Everything the package exports is enumerated explicitly in `src/index.ts` (no
blanket `export *`). The public surface is:

| Export                                                                                                            | Kind      | Purpose                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parseFundReview`                                                                                                 | function  | Turn untrusted input into a typed `FundReviewData` or a blocking `ParseResult`.                                                                                         |
| `buildCompositionReport`                                                                                          | function  | Build the canonical `CompositionReport` read model from parsed data.                                                                                                    |
| `buildDashboardDetail`                                                                                            | function  | Drill a dashboard row down into its contributing records.                                                                                                               |
| `formatCompositionReport`                                                                                         | function  | Render the CLI text report from a `CompositionReport`.                                                                                                                  |
| `formatUsd`, `formatMaybeUsd`, `formatPrice`, `formatSignedPercent`, `formatPercent`, `pad`, `padLeft`, `divider` | functions | The shared formatters — the **one** source of truth for the "USD to cents" / padding / precision conventions. The TUI imports these rather than keeping private copies. |
| `validationSeverityByCode`                                                                                        | value     | Maps each validation code to its severity.                                                                                                                              |
| domain types & read models                                                                                        | types     | `FundReviewData`, `CompositionReport`, `DashboardDetail`, `Warning`, `ParseResult`, …                                                                                   |

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
| `format.ts`        | formatters + `formatCompositionReport`           | The shared formatters (exported) and the CLI composition renderer.                                                                                                                                                                     |

Dependency direction: `contracts.ts` → (`internal.ts`, `price-journey.ts`) →
`parse.ts` / `compose.ts` / `format.ts` → `index.ts`. `contracts.ts` depends on
nothing else in the package, so there are no cycles.

> Note: `src/fund-composition.test.ts` is the behavioral suite. It predates the
> split and still lives under its original name; splitting it to mirror the new
> modules is deferred until navigation cost demands it.

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
