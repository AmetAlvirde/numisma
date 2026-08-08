# Local data

Where the durable store lives and how every runtime plane finds it, for the
[root README](../README.md).

## Placeholder convention

Two names are kept out of the written record deliberately, the same way
`<dataDir>` stands in for a resolved path: `<fund>` stands for the operator's
private data repository, and `<exchange>` stands for the trading venue.
Wherever this doc (or any doc that links here) says `<fund>` or `<exchange>`
in **prose**, it means the real private repo name / the real exchange name —
substituted out so neither appears in the written record.

The substitution applies to prose only. **Doc filenames, source paths, and
code identifiers keep their literal names** — e.g. the
[accumulus restore runbook](./accumulus-restore-runbook.md) is deliberately
still named `accumulus-restore-runbook.md`, and a fetcher or CSV-parser
source file may legitimately contain the real exchange name in its filename
(e.g. `packages/engine/src/orders/bitget.ts`). Seeing the placeholder in
prose and the literal name in a path or link in the same document is
deliberate, not an inconsistency.

## Where the store lives

The durable store does **not** live inside this checkout. It lives in a
**private sibling repository, `<fund>`**, so the git-ignored ledger gains a
versioned, restorable history without ever exposing trade data (ADR-006).
Every runtime plane resolves the same root through one rule
(`resolveDataDir` in `@numisma/engine`):

- **Default:** `~/Dev/<fund>/data` — absolute, derived from `os.homedir()`
  (never a CWD-relative `data/`, never a hardcoded `/Users/...`).
- **Override:** `NUMISMA_DATA_DIR` — the single knob that moves every plane
  (the TUI event-store, `pnpm prices:fetch`, the sidecars, the launchd job).
  It must be **absolute or `~/`-prefixed**; `~` is expanded, a relative value
  is rejected loudly rather than silently split-braining the store. launchd
  cannot expand `~`, so the plist sets an absolute value (see
  [`docs/price-feed-ops.md`](./price-feed-ops.md)).

## Layout

Under that root (`<dataDir>`, e.g. `~/Dev/<fund>/data`):

| Path                                   | Role                                                                                  | In git history? |
| --------------------------------------- | -------------------------------------------------------------------------------------- | ---------------- |
| `<dataDir>/genesis.json`               | Immutable t0 seed (a `FundReviewData` shape) — the start of recorded history.         | tracked         |
| `<dataDir>/events.jsonl`               | Append-only event log, one JSON event per line. Appended atomically (temp + rename).  | tracked         |
| `<dataDir>/head-digest.json`           | Derived, versioned summary of the folded head (the Head Digest) — a breadcrumb that makes a bad-NAV search cheap; never a source of truth (nothing folds it back). | tracked |
| `<dataDir>/preferences.jsonl`          | Append-only profit-split policy sidecar, validated on load.                           | tracked         |
| `<dataDir>/orders.jsonl`               | Append-only Orders sidecar — resting claims on capital, joined to the fold at read time and never folded into NAV (ADR-013). | tracked |
| `<dataDir>/orders.jsonl.lock`          | Transient exclusive-create lock guarding a concurrent `orders.jsonl` write.           | ignored         |
| `<dataDir>/gap-report.json`            | Derived standup artifact — dates/counts of the fetch window, overwritten every run, no rotation or history. | ignored         |
| `<dataDir>/job-heartbeat.json`         | Derived launchd-run outcome (one slot, overwritten every run) — where and how the last scheduled run ended. | ignored         |
| `<dataDir>/inbox/transactions.json`    | Disposable write channel: drop an array of new events here to be ingested on startup. | ignored         |
| `<dataDir>/ingested/<wall-clock>.json` | Archive of a consumed inbox — stamped, never clobbered.                               | ignored         |
| `<dataDir>/prices/`                    | Disposable price-quote cache (upserted every fetch).                                  | ignored         |
| `<dataDir>/events.jsonl.quarantine`    | The side lane for corrupt log lines, surfaced rather than aborting the load.          | ignored         |

`<fund>`'s `.gitignore` is an **allowlist**: only the five durable files are
tracked; `prices/`, `inbox/`, `ingested/`, `*.tmp`, `*.quarantine`, the
`orders.jsonl.lock` lock file, and the derived `gap-report.json` /
`job-heartbeat.json` sidecars are structurally excluded, so the disposable
cache can never enter history.

## Reversibility

Because each successful ingest commits `events.jsonl` + `head-digest.json`
under the operator's own git identity, a bad-but-valid append is **locatable
and reversible**: `git log -p head-digest.json` pins the NAV jump to one
commit, and `git revert` + re-fold (`pnpm report`) restores the correct NAV —
the fold over events, not the breadcrumb, is the source of truth. The
step-by-step procedure is the
[accumulus restore runbook](./accumulus-restore-runbook.md) — its filename
keeps the literal repo name; see the placeholder convention above.

## Validated ingest boundary

Ingest is a validated boundary: every event must pass structural
`parseEvent`, cross-reference against the known ids (genesis plus everything
the log has already introduced), the `PriceMarked` and settlement magnitude
guards, and the date-ordering rules — a verb may not be dated before its
target exists, and a `PositionClosed` may not be dated before a verb the log
has already accepted for that same position — before it reaches the log. Any
rejection leaves the durable
log byte-for-byte unchanged and the inbox in place so it can be fixed and
re-dropped.

The repo intentionally does not ship real or sample portfolio data.
