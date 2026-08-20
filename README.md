# Numisma

Numisma builds a canonical Fund composition read model and renders it for review
— as a one-shot text report, an interactive terminal dashboard, and a hosted
phone-checkable projection. The durable source of truth is an append-only
**event log** of ten verbs layered on an immutable **genesis seed**; current
state and any as-of view are a pure **fold** of the log into the read model.
Orders (claims on capital) and profit-split preferences live in their own
append-only sidecars, joined at read time and never folded into NAV. See
[`docs/domain-model.md`](./docs/domain-model.md) for the full domain prose.

## Getting started

- `pnpm dev` — run the interactive dashboard (Bun).
- `pnpm report` — print the one-shot text composition report.
- `pnpm verify` — the full quality gate (`typecheck` → `test` →
  `smoke:startup`).

See [`docs/scripts.md`](./docs/scripts.md) for the full script reference,
including Orders, market data, and the hosted projection.

## Architecture

A private pnpm workspace (`packages/*` for imported libraries, `apps/*` for
runnable surfaces) split along a runtime boundary
([ADR-001](./context/adr/ADR-001-package-boundary-and-runtime-split.md)). All
six members are versioned together at the monorepo version.

| Package                                                    | Runtime                                    | Owns                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`@numisma/engine`](./packages/engine/README.md)           | Node-compatible, IO-free, no Bun/openTUI   | The pure fund domain: parsing untrusted input, validating events, folding genesis + log into the `CompositionReport` read model, the shared formatters, the pure half of the two-plane price model, the whole Orders model, and the pure halves of the plans and reconciliations sidecars. It also holds `resolveDataDir` and the one `normalizeDataDirOverride` predicate every data-dir door routes through. Exposes `.`, `./format`, `./calendar`, and `./testkit` subpath exports. |
| [`@numisma/event-store`](./packages/event-store/README.md) | Node-compatible                            | The durable log's **read** path — path resolution, genesis load, log load with quarantine, `loadFoldedReview` — plus the gap-report, job-heartbeat, and operator-notice sidecars. Consumed by both the TUI and the web push. Exposes `.` and the `./testkit` subpath export.                                                                                 |
| [`@numisma/preferences`](./packages/preferences/README.md) | Node-compatible                            | Sidecar file IO for `preferences.jsonl` (profit-split policy), `orders.jsonl` (resting claims), `plans.jsonl` (per-position DCA plans), and `reconciliations.jsonl` (the record of what a reader showed the operator). Append-only, validated on load; the orders, plans, and reconciliations appends share one lock + temp + rename shell, while the one-line preferences seed appends inline.                                                                                                                        |
| [`@numisma/tui`](./apps/tui/README.md)                     | Bun + openTUI (dashboard); Node for CLIs   | The local access surface: the durable log's **write** half (ingest / dedup / atomic append / archive / legacy migration), startup orchestration, the interactive dashboard, the three Orders CLIs, the `pnpm plans` desk report, and the smoke renders.                                                                  |
| [`@numisma/price-feed`](./apps/price-feed/README.md)       | Node-compatible, headless (no Bun/openTUI) | The market-data runtime shell (ADR-005): the provider fetchers (Binance, Twelve Data, Banxico FIX), the disposable price-store IO, the atomic inbox emit, the fetch-time spine-guard pre-check, the `prices:fetch` and `operator-notice` CLIs, and the harness that drives the real launchd wrapper script.                                                                |
| [`@numisma/web`](./apps/web/README.md)                     | TanStack Start (Vite + Nitro), React 19    | The hosted read-projection dashboard (ADR-007/009) — a phone-checkable composition view backed by a disposable Postgres projection fed by one-way local→cloud push, plus its Better Auth server and provisioning scripts.                                                                  |

Per ADR-003 the fold and all event validation are pure `@numisma/engine` domain.
File IO is split by direction: the **read** path (genesis, log, quarantine)
lives in `@numisma/event-store`, the **write/ingest** path (inbox detection,
dedup persistence, atomic append, archive) and startup orchestration stay in
`@numisma/tui`, and sidecar IO lives in `@numisma/preferences`. Every app
consumes its libraries through a package's declared entry points — the root
plus the four deliberate subpath exports (`@numisma/engine/format`,
`@numisma/engine/calendar`, `@numisma/engine/testkit`,
`@numisma/event-store/testkit`) — never an undeclared deep import; `pnpm
typecheck` mechanically bars those.

Outside the workspace globs, `ops/` holds repo tooling that ships with no
package of its own: the launchd wrapper for the daily price run
(`ops/price-feed/`) and the git-backed substrate the guard tests and test
discovery share (`ops/testkit/`). No package tsconfig includes that directory,
so `tsconfig.ops.json` typechecks it and `vitest.config.ts` together, and `pnpm
typecheck` runs it last.

## Documentation

Start at the [codebase map](./docs/codebase-map.md) for deep orientation — it
names every package, runbook, and ADR with a one-line "what it answers". This
table is a fast index; the map is the tour.

| Doc                                                                        | What it answers                                                                                                         |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [`docs/codebase-map.md`](./docs/codebase-map.md)                           | Deep orientation entry point — every package, runbook, and ADR at a glance.                                             |
| [`docs/domain-model.md`](./docs/domain-model.md)                           | The domain: the ten verbs, position-moving semantics, closed book, invalidation watch, profit-split obligation, Orders. |
| [`docs/scripts.md`](./docs/scripts.md)                                     | The full root script reference — local review, orders, market data, hosted projection, quality gates.                   |
| [`docs/local-data.md`](./docs/local-data.md)                               | Where the durable store lives, `resolveDataDir`, the `<dataDir>` layout, reversibility, ingest validation.              |
| [`docs/ladder-fill-path.md`](./docs/ladder-fill-path.md)                   | The DCA ladder card: the day-zero projection and the state key the chart and the rung list share.                       |
| [`docs/plans-authoring-runbook.md`](./docs/plans-authoring-runbook.md)     | Writing a `plans.jsonl` line by hand, and what `pnpm plans` says back.                                                  |
| [`docs/price-feed-ops.md`](./docs/price-feed-ops.md)                       | The hands-off daily price-fetch run.                                                                                    |
| [`docs/durable-log-ops.md`](./docs/durable-log-ops.md)                     | Durable-log operations.                                                                                                 |
| [`docs/accumulus-restore-runbook.md`](./docs/accumulus-restore-runbook.md) | How to locate and revert a bad-but-valid ingest.                                                                        |
| [`docs/hosted-cutover-runbook.md`](./docs/hosted-cutover-runbook.md)       | Cutting the hosted projection over to a new deploy.                                                                     |
| [`docs/projection-provisioning.md`](./docs/projection-provisioning.md)     | Provisioning the hosted projection database.                                                                            |
| [`docs/web-deploy-runbook.md`](./docs/web-deploy-runbook.md)               | Deploying `apps/web`.                                                                                                   |
| [`docs/coverage-rationale.md`](./docs/coverage-rationale.md)               | Why the measured coverage number is what it is.                                                                         |
| [`context/adr/INDEX.md`](./context/adr/INDEX.md)                           | Every architecture decision and its current status.                                                                     |
| [`context/product.md`](./context/product.md)                               | Product intent and work boundaries.                                                                                     |
| [`context/ubiquitous-language.md`](./context/ubiquitous-language.md)       | Domain vocabulary.                                                                                                      |
| [`packages/engine/README.md`](./packages/engine/README.md)                 | The pure fund domain package.                                                                                           |
| [`packages/event-store/README.md`](./packages/event-store/README.md)       | The durable log's read path.                                                                                            |
| [`packages/preferences/README.md`](./packages/preferences/README.md)       | Sidecar file IO for preferences and orders.                                                                             |
| [`apps/tui/README.md`](./apps/tui/README.md)                               | The local dashboard and write-path CLIs.                                                                                |
| [`apps/price-feed/README.md`](./apps/price-feed/README.md)                 | The market-data runtime shell.                                                                                          |
| [`apps/web/README.md`](./apps/web/README.md)                               | The hosted read-projection dashboard.                                                                                   |

## Local data

The durable store lives outside this checkout, in a private sibling repository
(see [`docs/local-data.md`](./docs/local-data.md) for the `<fund>` /
`<exchange>` placeholder convention). Every runtime plane resolves the same root
via `resolveDataDir`, defaulting to `~/Dev/<fund>/data` and overridable with
`NUMISMA_DATA_DIR`. The repo intentionally does not ship real or sample
portfolio data; see [`docs/local-data.md`](./docs/local-data.md) for the full
layout, the allowlist, and how a bad ingest is located and reverted.
