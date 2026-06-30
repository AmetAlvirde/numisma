# Numisma

Numisma builds a canonical Fund composition read model and renders it for review
— both as a one-shot text report and as an interactive terminal dashboard. The
durable source of truth is an append-only **event log** of material actions
(`PositionOpened` / `PositionClosed` / `PriceMarked`) layered on an immutable
**genesis seed**; current state and any as-of view are a pure **fold** of the log
into the read model
([ADR-003](./context/adr/ADR-003-event-log-genesis-fold-persistence.md)).

## Architecture

A private pnpm workspace (`packages/*`) split along a runtime boundary
([ADR-001](./context/adr/ADR-001-package-boundary-and-runtime-split.md)):

| Package                                          | Runtime                         | Owns                                                                                                                                                                                                |
| ------------------------------------------------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@numisma/engine`](./packages/engine/README.md) | Node-compatible, no Bun/openTUI | Parsing untrusted input, validating events, folding genesis + log into the `CompositionReport` read model, and the shared formatters. The reusable domain.                                          |
| [`@numisma/tui`](./packages/tui/README.md)       | Bun + openTUI                   | The local access surface: durable event-store IO (ingest / dedup / atomic append / archive / quarantine), startup orchestration, the interactive dashboard, and smoke rendering. Consumes the engine through its package root only. |

Per ADR-003 the fold and event validation are pure `@numisma/engine` domain,
while file IO, inbox detection, dedup persistence, and startup orchestration stay
in `@numisma/tui`.

The engine is decomposed into concern-sized modules (contracts, an internal
kernel, parse, compose, price-journey, fold, format) behind a curated `index.ts`;
see its [README](./packages/engine/README.md) for the module layout and public
surface.

### Scripts

Root scripts own the user-facing commands and stay stable across internal
refactors:

| Script             | What it does                                                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`         | Run the interactive openTUI dashboard (Bun). On startup it ingests any dropped inbox, then folds genesis + log to current state (or `--as-of`).      |
| `pnpm report`      | Print the one-shot text composition report (tsx), rendered from the fold over genesis + log. Read-only — it folds and renders, never ingests.        |
| `pnpm spine`       | Node tracer for the event-sourcing spine (no Bun/openTUI): ingest the inbox (dedup / append / archive), fold to `--as-of` (or current), then render. |
| `pnpm spine:reset` | Iteration helper: clear the event log and restore the most recent archived inbox so an edited inbox can be re-folded. Genesis is never touched.      |
| `pnpm smoke:tui`   | Headless openTUI keypress smoke render.                                                                                                              |
| `pnpm smoke:startup` | Bun: drives the real startup data path + `mountApp` through the openTUI test renderer against an on-disk store, asserting the spine targets on the rendered surface. |
| `pnpm typecheck`   | Typecheck both packages — the guard for the engine's public surface and the no-deep-import boundary.                                                  |
| `pnpm test`        | Run the full Vitest suite, including characterization snapshots and the engine↔TUI formatter contract test.                                          |
| `pnpm coverage`    | The measured Node-side coverage number (see [`docs/coverage-rationale.md`](./docs/coverage-rationale.md)).                                            |

`pnpm dev`, `pnpm report`, and `pnpm spine` accept an optional
`--as-of <YYYY-MM-DD>` to render the composition as of a prior date; with no flag
they render current state. An `--as-of` earlier than the genesis date fails loud.

## Local data

The durable store lives under `data/` and is local-only — `data/.gitignore`
keeps every `*.json` / `*.jsonl` / archive / quarantine file out of git:

| Path                              | Role                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| `data/genesis.json`               | Immutable t0 seed (a `FundReviewData` shape) — the start of recorded history.         |
| `data/events.jsonl`               | Append-only event log, one JSON event per line. Appended atomically (temp + rename).  |
| `data/inbox/transactions.json`    | Disposable write channel: drop an array of new events here to be ingested on startup. |
| `data/ingested/<wall-clock>.json` | Archive of a consumed inbox — stamped, never clobbered.                               |
| `data/events.jsonl.quarantine`    | The side lane for corrupt log lines, surfaced rather than aborting the load.          |

Ingest is a validated boundary: every event must pass structural `parseEvent`,
cross-reference against genesis ids, and a `PriceMarked` magnitude guard before it
reaches the log. Any rejection leaves the durable log byte-for-byte unchanged and
the inbox in place so it can be fixed and re-dropped.

The repo intentionally does not ship real or sample portfolio data.
