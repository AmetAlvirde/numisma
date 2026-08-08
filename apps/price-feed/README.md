# `@numisma/price-feed`

Headless, Node-compatible (no Bun/openTUI) runtime shell for the two-plane price
model (ADR-005). It owns the provider fetch, the disposable price-store IO, the
atomic inbox emit, the fetch-time spine-guard pre-check, and the `prices:fetch`
CLI. All domain decisions (the instrument registry, the mark-instant/trading-day
rule, quote→mark construction, the MXN derivation) live in `@numisma/engine`'s
pure core — this package is IO and orchestration only (ADR-001/R1).

It never writes the durable event log: it drops `PriceMarked` candidates in the
shared inbox, and `pnpm spine` (in `apps/tui`) owns the guarded, validated append
(R6).

## What it owns

- **Fetch orchestration** (`src/fetch-prices.ts`, `runPriceFetch`) — sequences
  fetch → store → derive → emit and tallies the run. Holds no domain decisions.
- **Three provider adapters**, IO only, each returning a
  `ProviderObservation { close, observationDate, fetchedAt }`:
  - `src/binance-provider.ts` — Binance public REST (crypto, keyless). Requests
    the newest two 1d klines and takes the older, SETTLED candle — never the
    still-running current-day one.
  - `src/twelvedata-provider.ts` — Twelve Data `time_series` (US equities).
    Auth: `TWELVEDATA_API_KEY` (free key). Batches all equity symbols into one
    comma-separated request per chunk; a request-level failure (bad key, HTTP
    error) fails every symbol in the chunk, a per-symbol failure (bad status,
    missing row) fails only that one.
  - `src/banxico-provider.ts` — Banxico SIE series `SF43718` (USD/MXN FIX).
    Auth: `BANXICO_TOKEN` (free SIE token), sent as the `Bmx-Token` header. Not
    an instrument — never written to the price store; it rides on a derived
    `*-mxn` mark as the `usdMxn` snapshot.
  - `src/provider.ts` — the shared `fetchJson` envelope every provider rides:
    one `AbortController` timeout (`requestTimeoutMs`, default 30s) covering
    CONNECT + HEADERS + BODY DECODE, returning a `{ ok, reason }` Result rather
    than throwing (R4 — a stalled provider can never hang a scheduled run).
- **The disposable price store** (`src/price-store.ts`) — one
  `<pricesDir>/<instrumentId>.jsonl` file per instrument, one line per trading
  day, upsert-by-`asOf` latest-wins, full-file rewrite per upsert. Disposable
  (no durability contract beyond the `<fund>` repo's git-ignore), but writes
  are atomic (temp+rename, `src/atomic-write.ts`) so a crash mid-write cannot
  corrupt a price file.
- **The inbox emit** (`src/inbox.ts`) — merges fresh marks into the shared
  inbox (`mergeInbox` from `@numisma/engine`) without clobbering pending
  hand-authored events; a mark whose id is already queued is skipped
  (idempotent re-runs). Also atomic (temp+rename).
- **The fetch-time spine-guard pre-check** (`src/rejection-check.ts`) —
  advisory only, changes no engine/tui code. Reconstructs the spine's exact
  known world (genesis + durable log + pending inbox events folded in order,
  mirroring `apps/tui`'s `ingestInbox`) and runs each freshly queued mark
  through the SAME `crossReferenceEvent` ±50% magnitude guard the spine uses,
  so a doomed mark is surfaced at fetch time instead of silently rejected
  later when `pnpm spine` runs. `pnpm spine` stays the one authoritative
  guard; a failed pre-check (unreadable log, missing genesis) is swallowed
  into a non-fatal note, never a crash.
- **The CLI** (`src/cli.ts`, `pnpm prices:fetch`) — thin console/exit-code
  wiring over `runPriceFetch` + `scanFetchedMarks`. No domain logic.

## Runtime constraints

- **Two-plane invariant (ADR-005):** every run upserts the disposable price
  store; a `PriceMarked` candidate is queued to the inbox only at/after the
  configured mark time (`DEFAULT_CONFIG.markTime`, default `18:00`
  `America/Mexico_City`). Before the mark time, a fetch stores quotes and
  emits zero marks.
- **Freshness gate:** every mark — crypto, US equity, and derived `*-mxn`
  alike — is built only when the provider bar's `observationDate` equals the
  run's trading-day `asOf`. A stale bar (market-closed weekend/holiday for
  equities, a late/missed fire or provider hiccup for crypto) is an INFO skip
  (`staleMarkSkips`), never a failure.
- **MXN honesty:** `*-mxn` instruments store their raw USD leg as the
  disposable quote; the derived `USD × FIX` value lives only on the mark
  (with the `usdMxn` snapshot attached), never in the store. A missing or
  stale FIX (`fixMaxStaleDays`, default 4 calendar days) fails those
  derivations loudly rather than reusing an old rate.
- **Twelve Data pacing:** the free Basic tier caps at 8 API credits/minute; a
  batched `time_series` request costs 1 credit per symbol, and the registry
  holds 9 Twelve Data symbols — so a single request would 429. Equities are
  chunked to `twelveDataMaxSymbolsPerMinute` (default 8) and paced
  `twelveDataPauseMs` (default 60s) apart. A daily run with all 9 symbols
  therefore takes ~1 extra minute.
- **Partial progress always kept:** a per-symbol fetch failure is recorded
  and the run continues; the process exits non-zero (`process.exitCode = 1`)
  if any symbol failed OR the spine pre-check found a mark the guard would
  reject, so a scheduler notices — but only after everything that DID succeed
  has already been stored/emitted.
- **`NUMISMA_DATA_DIR` resolution:** the data root is resolved once via
  `@numisma/engine`'s `resolveDataDir()` at import time (`src/config.ts`) —
  unset/empty → the absolute, homedir-derived `<fund>` default
  (`~/Dev/<fund>/data`); `~`-prefixed → expanded; absolute → normalized; a
  relative path is REJECTED loudly (never a CWD-relative `"data"`). See
  `packages/engine/src/data-dir.ts`.

## What it writes

- `<dataDir>/prices/<instrumentId>.jsonl` — the disposable price store (every
  run, regardless of mark time).
- `<dataDir>/inbox/transactions.json` — `PriceMarked` candidates (only
  at/after the mark time), merged non-destructively with whatever is already
  pending.
- **Never** the durable event log (`<dataDir>/events.jsonl`) or
  `genesis.json` — those are read-only inputs to the spine pre-check, never
  written here (R6).

## CLI

```sh
pnpm prices:fetch
```

No argv flags. All configuration is environment/`DEFAULT_CONFIG`-driven:

| Variable | Purpose |
| --- | --- |
| `TWELVEDATA_API_KEY` | Twelve Data free key (US equities). Missing → that provider's symbols fail loud, per-symbol; crypto still runs keyless. |
| `BANXICO_TOKEN` | Banxico SIE free token (USD/MXN FIX). Missing → `*-mxn` derivations fail loud; direct crypto/equity marks still emit. |
| `NUMISMA_DATA_DIR` | Overrides the data root (see resolution rule above). |

Exit code is non-zero if any provider fetch failed or the spine-guard
pre-check found a would-be-rejected mark; zero otherwise (including a clean
pre-mark-time run that stored quotes but emitted no marks).

See `docs/price-feed-ops.md` for the scheduled (launchd) operation of this
CLI, token setup, and triage; `ops/price-feed/launchagent-reinstall.md` for
pushing a plist change live.

## Workspace dependencies

```json
"dependencies": {
  "@numisma/engine": "workspace:*",
  "@numisma/event-store": "workspace:*"
}
```

Deliberately **not** dependent on `@numisma/tui` (or any UI package), so any
future access surface (web, a different scheduler) can reuse this pipeline
unchanged.

## Tests

Every non-trivial module is co-located with a `*.test.ts` file directly beside
it in `src/`: `atomic-write.test.ts`, `banxico-provider.test.ts`,
`binance-provider.test.ts`, `fetch-prices.test.ts`, `inbox.test.ts`,
`index.test.ts` (the barrel's exact-set runtime-surface lock — see
`docs/codebase-map.md`), `rejection-check.test.ts`, `schedule-window.test.ts`
(asserts properties of the launchd plist template and the wrapper script that
have an oracle elsewhere — see its own header comment),
`twelvedata-provider.test.ts`. Run via the repo root:

```sh
pnpm test        # whole monorepo, vitest run
pnpm typecheck    # this package: tsc --noEmit -p tsconfig.json
```

`src/cli.ts` is excluded from the coverage number (thin console/exit-code
wiring over the tested `runPriceFetch` — see `vitest.config.ts` and
`docs/coverage-rationale.md`).
