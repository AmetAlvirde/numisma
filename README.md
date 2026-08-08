# Numisma

Numisma builds a canonical Fund composition read model and renders it for review
— as a one-shot text report, an interactive terminal dashboard, and a hosted
phone-checkable projection. The durable source of truth is an append-only
**event log** of material actions — ten verbs (`PositionOpened` /
`PositionClosed` / `PositionTrimmed` / `PositionAddedTo` / `PriceMarked` /
`Deposit` / `Withdraw` / `Transfer` / `InvalidationMarked` / `ReserveOpened`)
layered on an immutable **genesis seed**; current state and any as-of view are a
pure **fold** of the log into the read model
([ADR-003](./context/adr/ADR-003-event-log-genesis-fold-persistence.md), amended
for the trim/add verbs; the tenth verb is
[ADR-012](./context/adr/ADR-012-reserve-opened-tenth-event-verb.md), shipped to
`main` in PR #162). All ten verbs are shipped and reliable.

The two position-moving verbs act on an already-open Position:
**`PositionTrimmed`** partially takes profit — it names `removals: [{tier,
quantity}]` plus an atomic `settlement` cash leg, removes pro-rata within each
named Tier, and emits a **partial** `ClosedPositionRecord` (`partial: true`) that
shares the surviving Position's id (the Position always survives; a
full-retirement trim is rejected — use `PositionClosed`). **`PositionAddedTo`**
scales in — it appends a new lot with its own entry FX and Tier (never
weighted-average merged) funded by a `funding` debit, and produces no realized
P&L.

Beyond live composition, the fold also emits two descriptive review sections. The
**closed book** (realized-P&L blotter) records each closed Position's realized
Trading P&L — proceeds minus the lot USD cost basis, attributed per Capital Tier
— and rolls it up by Tempo and Tier. It is **descriptive only**: realized profit
already sits in a Reserve from the close's cash leg, so it is never re-added to
NAV. The **invalidation watch** lists open Positions against the latest
`InvalidationMarked` level and `direction` (`below`/`above`), flagging any whose
mark has crossed it.

On top of the closed book sits a derived, **descriptive-only profit-split
obligation** (`composeProfitSplit`). It computes the fund's split obligation on
the exact cumulative total realized (default **60/40** high-water-mark, no
clawback; a `perClose` basis is selectable to prove the behavior is
configuration), and renders **obligation-only** — the obligation plus a RESERVE
%-of-NAV-vs-10%-target line, with no routed-flow / unallocated balance (a deferred
fast-follow). It is empty-guarded and, like the closed book, is never fed into
NAV. The split policy lives in a **preferences sidecar** (`preferences.jsonl`, in
the durable-data root) — append-only, validated on load, and decoupled from the
event log; the engine-pure `pickPolicyAsOf(prefs, asOf)` selects the policy in
effect at any as-of date, while the sidecar's file IO lives in
[`@numisma/preferences`](./packages/preferences/README.md)
([ADR-001](./context/adr/ADR-001-package-boundary-and-runtime-split.md),
[ADR-004](./context/adr/ADR-004-preferences-sidecar.md)).

## Orders — claims on capital, recorded beside the log

An **Order** is a claim on capital that has not yet become a transaction. Orders
are deliberately **not events**: they live in their own append-only sidecar
(`orders.jsonl`) and are joined to the fold at read time, never folded into
`FundReviewData` or NAV
([ADR-013](./context/adr/ADR-013-order-a-claim-on-capital-recorded-beside-the-log.md),
[ADR-014](./context/adr/ADR-014-a-skipped-export-row-not-persisted-because-it-could-never-be-retired.md)).
Four kinds are recorded — `orderPlaced`, `orderCancelled`, `orderFilled`,
`orderFillObserved` — and the engine derives **committed** and **available**
capital from them, so resting rungs cannot be double-spent.

The intake is a manual Bitget open-orders CSV export, not a live broker
connection: `pnpm orders:import` parses it behind a funding-coverage guard.
`pnpm orders:cancel` retires one resting rung. `pnpm orders:fill` is the only
orders command that touches the event log — it atomically retires the claim in
`orders.jsonl` **and** appends the resulting `PositionOpened` / `PositionAddedTo`
to `events.jsonl`.

## Architecture

A private pnpm workspace (`packages/*` for imported libraries, `apps/*` for
runnable surfaces) split along a runtime boundary
([ADR-001](./context/adr/ADR-001-package-boundary-and-runtime-split.md)). All six
members are versioned together at the monorepo version.

| Package                                                          | Runtime                                    | Owns                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@numisma/engine`](./packages/engine/README.md)                 | Node-compatible, IO-free, no Bun/openTUI   | The pure fund domain: parsing untrusted input, validating events, folding genesis + log into the `CompositionReport` read model, the shared formatters, the pure half of the two-plane price model, and the whole Orders model. Exposes `.`, `./format`, and `./calendar` subpath exports. |
| [`@numisma/event-store`](./packages/event-store/README.md)       | Node-compatible                            | The durable log's **read** path — path resolution, genesis load, log load with quarantine, `loadFoldedReview` — plus the gap-report and job-heartbeat sidecars. Consumed by both the TUI and the web push.                                                                                |
| [`@numisma/preferences`](./packages/preferences/README.md)       | Node-compatible                            | Sidecar file IO for `preferences.jsonl` (profit-split policy) and `orders.jsonl` (resting claims). Append-only, validated on load, cross-process locked for orders.                                                                                                                       |
| [`@numisma/tui`](./apps/tui/README.md)                           | Bun + openTUI (dashboard); Node for CLIs   | The local access surface: the durable log's **write** half (ingest / dedup / atomic append / archive / legacy migration), startup orchestration, the interactive dashboard, the three Orders CLIs, and the smoke renders.                                                                  |
| [`@numisma/price-feed`](./apps/price-feed/README.md)             | Node-compatible, headless (no Bun/openTUI) | The market-data runtime shell (ADR-005): the provider fetchers (Binance, Twelve Data, Banxico FIX), the disposable price-store IO, the atomic inbox emit, the fetch-time spine-guard pre-check, and the `prices:fetch` CLI.                                                                |
| [`@numisma/web`](./apps/web/README.md)                           | TanStack Start (Vite + Nitro), React 19    | The hosted read-projection dashboard (ADR-007/009) — a phone-checkable composition view backed by a disposable Postgres projection fed by one-way local→cloud push, plus its Better Auth server and provisioning scripts.                                                                  |

Per ADR-003 the fold and all event validation are pure `@numisma/engine` domain.
File IO is split by direction: the **read** path (genesis, log, quarantine) lives
in `@numisma/event-store`, the **write/ingest** path (inbox detection, dedup
persistence, atomic append, archive) and startup orchestration stay in
`@numisma/tui`, and sidecar IO lives in `@numisma/preferences`. Every app
consumes its libraries through the package root only — `pnpm typecheck`
mechanically bars deep imports.

The engine is decomposed into concern-sized modules (contracts, an internal
kernel, parse, compose, price-journey, events, orders, format, calendar,
data-dir) behind a curated `index.ts` with no `export *`; see its
[README](./packages/engine/README.md) for the module layout and public surface.

## Scripts

Root scripts own the user-facing commands and stay stable across internal
refactors.

### Local review and the spine

| Script               | What it does                                                                                                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`           | Run the interactive openTUI dashboard (Bun). On startup it ingests any dropped inbox, then folds genesis + log to current state (or `--as-of`), joining the orders sidecar at read time.            |
| `pnpm report`        | Print the one-shot text composition report (tsx), rendered from the fold over genesis + log. Read-only — it folds and renders, never ingests.                                                       |
| `pnpm spine`         | Node tracer for the event-sourcing spine (no Bun/openTUI): ingest the inbox (dedup / append / archive), fold to `--as-of` (or current), then render. Accepts `--magnitude-threshold=<n>` (or `SPINE_MAGNITUDE_THRESHOLD`). |
| `pnpm spine:reset`   | Iteration helper: clear the event log and restore the most recent archived inbox so an edited inbox can be re-folded. Genesis is never touched. **Refuses to run against the default accumulus dataDir** — requires a non-default `NUMISMA_DATA_DIR`. |
| `pnpm migrate:log`   | One-shot ADR-003 v2 cash-leg migration driven by `migration-cash-legs.json`; rewrites `events.jsonl` in place and fails loud on any invalid or missing leg.                                          |

`pnpm dev`, `pnpm report`, and `pnpm spine` accept an optional `--as-of
<YYYY-MM-DD>` to render the composition as of a prior date; with no flag they
render current state. An `--as-of` earlier than the genesis date fails loud.

### Orders

| Script                            | What it does                                                                                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm orders:import <csv>`        | Import a Bitget open-orders CSV export into `orders.jsonl` behind a funding-coverage guard. Never touches the event log; exits 0 on a partial import by design (ADR-014). |
| `pnpm orders:fill`                | Interactive: record a fill — atomically retires the claim in `orders.jsonl` **and** appends the resulting transaction to `events.jsonl`. The only orders command that writes the log. |
| `pnpm orders:cancel <orderId> [YYYY-MM-DDTHH:MM:SS]` | Retire one resting rung in `orders.jsonl`. Scriptable — the whole assertion is in argv, no readline; never touches the event log.                |

### Market data

| Script              | What it does                                                                                                                                                                                                                                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm prices:fetch` | Fetch free market data (crypto via keyless Binance, US equities via Twelve Data, and MXN-listed instruments derived as `USD close × Banxico USD/MXN FIX`) into the disposable price store and queue one `PriceMarked` per instrument per trading day in the inbox; at/after the mark time it also pre-checks each mark against the spine's ±50% guard and exits non-zero on a provider failure or a would-be rejection. Never writes the event log — `pnpm spine` owns the guarded append. |

### Hosted projection

| Script             | What it does                                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm push`        | Fold the local log, narrow it to the ADR-007 allow-listed shape, and upsert one row into `composition_snapshot` via `PROJECTION_WRITE_DATABASE_URL`.             |
| `pnpm backfill`    | Idempotently replay every anchored date in the log into the projection database.                                                                                |
| `pnpm gap-report`  | Report missing days in the event log against a calendar window. No database or env required; exits 0 even when days are lost.                                    |
| `pnpm db:init`     | Apply only the `composition_snapshot` DDL — no fold, no upsert.                                                                                                 |
| `pnpm db:provision`| Idempotent DDL plus the ADR-007 two-role grants, via `PROJECTION_ADMIN_DATABASE_URL`.                                                                           |

### Quality gates

| Script               | What it does                                                                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`     | Typecheck all six workspace members — the guard for each package's public surface and the no-deep-import boundary.                                                   |
| `pnpm test`          | Run the full Vitest suite, including characterization snapshots and the engine↔TUI formatter contract test.                                                          |
| `pnpm verify`        | The full gate: `typecheck` → `test` → `smoke:startup`.                                                                                                              |
| `pnpm coverage`      | The measured Node-side coverage number (see [`docs/coverage-rationale.md`](./docs/coverage-rationale.md)).                                                           |
| `pnpm smoke:tui`     | Headless openTUI keypress smoke render (Bun).                                                                                                                       |
| `pnpm smoke:startup` | Bun: drives the real startup data path + `mountApp` through the openTUI test renderer against an on-disk store, asserting the spine targets on the rendered surface. |

The web app additionally carries its own `dev` / `build` / `start` and six
`auth:*` scripts; they are scoped to `apps/web` rather than hoisted to the root.
See [its README](./apps/web/README.md).

## Local data

The durable store does **not** live inside this checkout. It lives in a **private
sibling repository, `accumulus`**, so the git-ignored ledger gains a versioned,
restorable history without ever exposing trade data (ADR-006). Every runtime plane
resolves the same root through one rule (`resolveDataDir` in `@numisma/engine`):

- **Default:** `~/Dev/accumulus/data` — absolute, derived from `os.homedir()` (never a
  CWD-relative `data/`, never a hardcoded `/Users/...`).
- **Override:** `NUMISMA_DATA_DIR` — the single knob that moves every plane (the TUI
  event-store, `pnpm prices:fetch`, the sidecars, the launchd job). It must be
  **absolute or `~/`-prefixed**; `~` is expanded, a relative value is rejected loudly
  rather than silently split-braining the store. launchd cannot expand `~`, so the
  plist sets an absolute value (see `docs/price-feed-ops.md`).

Under that root (`<dataDir>`, e.g. `~/Dev/accumulus/data`):

| Path                                   | Role                                                                                  | In git history? |
| -------------------------------------- | ------------------------------------------------------------------------------------- | --------------- |
| `<dataDir>/genesis.json`               | Immutable t0 seed (a `FundReviewData` shape) — the start of recorded history.         | tracked         |
| `<dataDir>/events.jsonl`               | Append-only event log, one JSON event per line. Appended atomically (temp + rename).  | tracked         |
| `<dataDir>/head-digest.json`           | Derived, versioned summary of the folded head (the Head Digest) — a breadcrumb that makes a bad-NAV search cheap; never a source of truth (nothing folds it back). | tracked |
| `<dataDir>/preferences.jsonl`          | Append-only profit-split policy sidecar, validated on load.                           | tracked         |
| `<dataDir>/orders.jsonl`               | Append-only Orders sidecar — resting claims on capital, joined to the fold at read time and never folded into NAV (ADR-013). | tracked |
| `<dataDir>/inbox/transactions.json`    | Disposable write channel: drop an array of new events here to be ingested on startup. | ignored         |
| `<dataDir>/ingested/<wall-clock>.json` | Archive of a consumed inbox — stamped, never clobbered.                               | ignored         |
| `<dataDir>/prices/`                    | Disposable price-quote cache (upserted every fetch).                                  | ignored         |
| `<dataDir>/events.jsonl.quarantine`    | The side lane for corrupt log lines, surfaced rather than aborting the load.          | ignored         |

`accumulus`'s `.gitignore` is an **allowlist**: only the five durable files are
tracked; `prices/`, `inbox/`, `ingested/`, `*.tmp`, and `*.quarantine` are structurally
excluded, so the disposable cache can never enter history.

Because each successful ingest commits `events.jsonl` + `head-digest.json` under the
operator's own git identity, a bad-but-valid append is **locatable and reversible**:
`git log -p head-digest.json` pins the NAV jump to one commit, and `git revert` +
re-fold (`pnpm report`) restores the correct NAV — the fold over events, not the
breadcrumb, is the source of truth. The step-by-step procedure is the
[accumulus restore runbook](./docs/accumulus-restore-runbook.md).

Ingest is a validated boundary: every event must pass structural `parseEvent`,
cross-reference against genesis ids, and a `PriceMarked` magnitude guard before it
reaches the log. Any rejection leaves the durable log byte-for-byte unchanged and
the inbox in place so it can be fixed and re-dropped.

The repo intentionally does not ship real or sample portfolio data.

## Documentation

Start at the [codebase map](./docs/codebase-map.md) — it names every package,
runbook, and ADR with a one-line "what it answers".

- **Decisions:** [`context/adr/INDEX.md`](./context/adr/INDEX.md) — 14 ADRs with
  their current status.
- **Domain vocabulary:** [`context/ubiquitous-language.md`](./context/ubiquitous-language.md).
- **Product intent and work boundaries:** [`context/product.md`](./context/product.md).
- **Operations:** the hands-off daily price run
  ([`docs/price-feed-ops.md`](./docs/price-feed-ops.md)), durable-log operations
  ([`docs/durable-log-ops.md`](./docs/durable-log-ops.md)), and the hosted
  deploy, provisioning, and cutover runbooks under [`docs/`](./docs).

Provider tokens live in a private file outside the repo; the disposable
`<dataDir>/prices/` store is git-ignored.
