# Numisma

Numisma builds a canonical Fund composition read model and renders it for review
— both as a one-shot text report and as an interactive terminal dashboard. The
durable source of truth is an append-only **event log** of material actions —
nine verbs (`PositionOpened` / `PositionClosed` / `PositionTrimmed` /
`PositionAddedTo` / `PriceMarked` / `Deposit` / `Withdraw` / `Transfer` /
`InvalidationMarked`) layered on an immutable **genesis seed**; current state and
any as-of view are a pure **fold** of the log into the read model
([ADR-003](./context/adr/ADR-003-event-log-genesis-fold-persistence.md), amended
for the trim/add verbs). The two new position verbs move an already-open
Position: **`PositionTrimmed`** partially takes profit — it names
`removals: [{tier, quantity}]` plus an atomic `settlement` cash leg, removes
pro-rata within each named Tier, and emits a **partial** `ClosedPositionRecord`
(`partial: true`) that shares the surviving Position's id (the Position always
survives; a full-retirement trim is rejected — use `PositionClosed`).
**`PositionAddedTo`** scales in — it appends a new lot with its own entry FX and
Tier (never weighted-average merged) funded by a `funding` debit, and produces no
realized P&L.

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
NAV. The split policy lives in a **preferences sidecar**
(`preferences.jsonl`, in the durable-data root) — append-only, validated on load,
and decoupled from the event log; the engine-pure `pickPolicyAsOf(prefs, asOf)` selects the policy in
effect at any as-of date, while the sidecar's file IO stays in the TUI
([ADR-001](./context/adr/ADR-001-package-boundary-and-runtime-split.md),
[ADR-004](./context/adr/ADR-004-preferences-sidecar.md)).

## Architecture

A private pnpm workspace (`packages/*`) split along a runtime boundary
([ADR-001](./context/adr/ADR-001-package-boundary-and-runtime-split.md)):

| Package                                          | Runtime                         | Owns                                                                                                                                                                                                |
| ------------------------------------------------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@numisma/engine`](./packages/engine/README.md) | Node-compatible, no Bun/openTUI | Parsing untrusted input, validating events, folding genesis + log into the `CompositionReport` read model, and the shared formatters. The reusable domain.                                          |
| [`@numisma/tui`](./packages/tui/README.md)       | Bun + openTUI                   | The local access surface: durable event-store IO (ingest / dedup / atomic append / archive / quarantine), startup orchestration, the interactive dashboard, and smoke rendering. Consumes the engine through its package root only. |
| `@numisma/price-feed`                            | Node-compatible, headless (no Bun/openTUI) | The market-data runtime shell (ADR-005): the provider fetchers (Binance, Twelve Data, Banxico FIX), the disposable price-store IO, the atomic inbox emit, the fetch-time spine-guard pre-check, and the `prices:fetch` CLI. Depends only on `@numisma/engine`; all domain decisions (registry, mark-instant rule, MXN derivation) stay in the engine's pure core. |

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
| `pnpm prices:fetch` | Fetch free market data (crypto via keyless Binance, US equities via Twelve Data, and MXN-listed instruments derived as `USD close × Banxico USD/MXN FIX`) into the disposable price store and queue one `PriceMarked` per instrument per trading day in the inbox; at/after the mark time it also pre-checks each mark against the spine's ±50% guard and exits non-zero on a provider failure or a would-be rejection. Never writes the event log — `pnpm spine` owns the guarded append. |
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

The durable store does **not** live inside this checkout. It lives in a **private
sibling repository, `accumulus`**, so the git-ignored ledger gains a versioned,
restorable history without ever exposing trade data (ADR-006). Every runtime plane
resolves the same root through one rule (`resolveDataDir` in `@numisma/engine`):

- **Default:** `~/Dev/accumulus/data` — absolute, derived from `os.homedir()` (never a
  CWD-relative `data/`, never a hardcoded `/Users/...`).
- **Override:** `NUMISMA_DATA_DIR` — the single knob that moves every plane (the TUI
  event-store, `pnpm prices:fetch`, the preferences sidecar, the launchd job). It must
  be **absolute or `~/`-prefixed**; a relative value is rejected loudly. launchd cannot
  expand `~`, so the plist sets an absolute value (see `docs/price-feed-ops.md`).

Under that root (`<dataDir>`, e.g. `~/Dev/accumulus/data`):

| Path                                   | Role                                                                                  | In git history? |
| -------------------------------------- | ------------------------------------------------------------------------------------- | --------------- |
| `<dataDir>/genesis.json`               | Immutable t0 seed (a `FundReviewData` shape) — the start of recorded history.         | tracked         |
| `<dataDir>/events.jsonl`               | Append-only event log, one JSON event per line. Appended atomically (temp + rename).  | tracked         |
| `<dataDir>/head-digest.json`           | Derived, versioned summary of the folded head (the Head Digest) — a breadcrumb that makes a bad-NAV search cheap; never a source of truth (nothing folds it back). | tracked |
| `<dataDir>/preferences.jsonl`          | Append-only profit-split policy sidecar, validated on load.                           | tracked         |
| `<dataDir>/inbox/transactions.json`    | Disposable write channel: drop an array of new events here to be ingested on startup. | ignored         |
| `<dataDir>/ingested/<wall-clock>.json` | Archive of a consumed inbox — stamped, never clobbered.                               | ignored         |
| `<dataDir>/prices/`                     | Disposable price-quote cache (upserted every fetch).                                  | ignored         |
| `<dataDir>/events.jsonl.quarantine`    | The side lane for corrupt log lines, surfaced rather than aborting the load.          | ignored         |

`accumulus`'s `.gitignore` is an **allowlist**: only the four durable files are
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

For the hands-off daily price run (scheduling, provider-token storage, and how to
triage a failed or rejected run), see
[`docs/price-feed-ops.md`](./docs/price-feed-ops.md). Provider tokens live in a
private file outside the repo; the disposable `<dataDir>/prices/` store is git-ignored.
