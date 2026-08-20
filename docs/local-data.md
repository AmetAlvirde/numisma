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

### The line is authorship, not syntax

The exemption above covers identifiers **this repository authors** — source
paths, doc filenames, section ids, row kinds, `portfolio:accumulus`. It does
**not** cover identifier-shaped strings **read out of the private store**,
however much they look like code. Those are data, and anything committed here
that derives from them must be synthesized.

The case that set this rule: a plan `positionId` such as
`dca-<asset>-<strategy>-<n>-<exchange>` is authored by the operator in the
private plans sidecar, and the convention spells out a live position's venue,
instrument and strategy. It was treated as a code identifier and kept verbatim
in the committed anchor fixture, which put one real id into this public repo
(PR #282). `apps/web/src/push/fixture-synthesis.ts` now replaces every
`positionId` with `synthetic-position-N`, and `anchor-fixture.test.ts` asserts
it against the committed bytes.

So when a new field reaches a committed fixture, the question is not "is it a
magnitude" — it is **"did we write this string, or did the operator's private
file?"** Only the first is kept.

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
- **Set but blank is refused, not treated as unset.** `""` or whitespace-only
  throws, naming what accepting it would have cost. An empty value is what an
  unset shell variable expands to, and silently falling through to the default
  would send every write to the real ledger instead of the store the caller
  meant to configure. To choose the default deliberately, unset the variable.

That rule has exactly one implementation. Five doors take a data root — the env
knob plus four caller-supplied arguments — and they route every **present**
value through `normalizeDataDirOverride` in `@numisma/engine`, so no plane can
disagree with another about any input. Only the `undefined` arm is per-door,
because the defaults genuinely differ (the engine's is the accumulus root; the
sidecar and store doors delegate to `resolveDataDir()`; the price-feed door's
argument is required and has no default). `@numisma/engine/testkit` publishes
the one input→outcome table, and each door's own suite runs it, so a door that
stops routing through the shared predicate fails in its own package naming the
input it disagreed on.

## Layout

Under that root (`<dataDir>`, e.g. `~/Dev/<fund>/data`):

| Path                                   | Role                                                                                  | In git history? |
| --------------------------------------- | -------------------------------------------------------------------------------------- | ---------------- |
| `<dataDir>/genesis.json`               | Immutable t0 seed (a `FundReviewData` shape) — the start of recorded history.         | tracked         |
| `<dataDir>/events.jsonl`               | Append-only event log, one JSON event per line. Appended atomically (temp + rename).  | tracked         |
| `<dataDir>/head-digest.json`           | Derived, versioned summary of the folded head (the Head Digest) — a breadcrumb that makes a bad-NAV search cheap; schema v2 adds `discardedEventCount`, the number of distinct events the fold read and could not apply — counted through the channel's own dedup key, so it matches the evening run's fold line for the same log (ADR-020, the Discard Channel); never a source of truth (nothing folds it back). | tracked |
| `<dataDir>/preferences.jsonl`          | Append-only profit-split policy sidecar, validated on load.                           | tracked         |
| `<dataDir>/orders.jsonl`               | Append-only Orders sidecar — resting claims on capital, joined to the fold at read time and never folded into NAV (ADR-013). | tracked |
| `<dataDir>/plans.jsonl`                | Append-only per-position plan sidecar — what the operator declared a position's ladder or cadence would be. Supersession is by append; `pickPlanAsOf` selects the latest `effectiveAt <= asOf`. Authoring it by hand is [its own runbook](./plans-authoring-runbook.md). | tracked |
| `<dataDir>/reconciliations.jsonl`      | Append-only trail of what a reader **showed the operator**: at a named moment, whether a fill agreed with its plan, with the declared values copied in as shown. Never authoritative over `plans.jsonl`, never folded, and written best-effort after the fill is already durable. | tracked |
| `<dataDir>/*.jsonl.lock`               | Transient exclusive-create lock guarding a concurrent sidecar append (`orders.jsonl`, `plans.jsonl`, `reconciliations.jsonl` share one lock + temp + rename shell). | ignored         |
| `<dataDir>/gap-report.json`            | Derived standup artifact — dates/counts of the fetch window, overwritten every run, no rotation or history. | ignored         |
| `<dataDir>/job-heartbeat.json`         | Derived launchd-run outcome (one slot, overwritten every run) — where and how the last scheduled run ended. | ignored         |
| `<dataDir>/operator-notice.txt`        | Derived liveness banner in plain text, rewritten every run with no rotation — the file a shell profile `cat`s on every new terminal. Empty means healthy. | ignored |
| `<dataDir>/inbox/transactions.json`    | Disposable write channel: drop an array of new events here to be ingested on startup. | ignored         |
| `<dataDir>/ingested/<wall-clock>.json` | Archive of a consumed inbox — stamped, never clobbered.                               | ignored         |
| `<dataDir>/prices/`                    | Disposable price-quote cache (upserted every fetch).                                  | ignored         |
| `<dataDir>/events.jsonl.quarantine`    | The side lane for corrupt log lines, surfaced rather than aborting the load.          | ignored         |

`<fund>`'s `.gitignore` is an **allowlist**: only the seven durable files are
tracked — `genesis.json`, `events.jsonl`, `head-digest.json`,
`preferences.jsonl`, `orders.jsonl`, `plans.jsonl`, `reconciliations.jsonl`.
`prices/`, `inbox/`, `ingested/`, `*.tmp`, `*.quarantine`, the `*.jsonl.lock`
lock files, and the derived `gap-report.json` / `job-heartbeat.json` /
`operator-notice.txt` artifacts are structurally excluded, so the disposable
cache can never enter history.

A file joins that list by ADR-006's membership test — *is this durable,
non-re-derivable truth?* — and joining it means one line in each of four
places, in this order: the `<fund>` allowlist, `TRACKED_FILES`
(`apps/tui/src/ingest-commit.ts`), the daily wrapper's explicit-add loop, and
the wrapper's strict `git status --porcelain` post-check. Reversed, the
post-check reports clean over a file git is discarding.
`apps/tui/src/durable-log-guards.test.ts` asserts both ends of the first two.

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
