# @numisma/event-store

The durable log's **read** path, extracted so `apps/tui` and `apps/web`'s push
shell fold the same log rather than keeping two copies to drift
(`refactor(event-store): extract the durable log's read path into a shared
package`). It is Node-compatible — plain `node:fs/promises`, no Bun, no
terminal, no git, no argv — and depends only on `@numisma/engine` (ADR-001
keeps the pure fold + event validation there; this package is the thin IO
shell around `foldEvents` / `parseEvent`). Also owns two read-only sidecars
derived from or alongside the log: the gap report (#186) and the daily job's
heartbeat (#191).

**Deliberately read-only.** The write half — inbox ingest, dedup persistence,
atomic append, archival, the one-shot legacy migration, git capture — stays in
`apps/tui` (`apps/tui/src/event-store.ts`). This package never writes
`events.jsonl`.

## Public surface

Enumerated explicitly in `src/index.ts`:

| Export | Kind | Purpose |
| --- | --- | --- |
| `resolveEventStorePaths`, `resolveDataDirDefault` | functions | Resolve `{genesis, log, inbox, ingestedDir}` under the shared `NUMISMA_DATA_DIR`-honoring data root (thin wrapper over the engine's `resolveDataDir`). |
| `loadGenesis` | function | Read + structurally validate the immutable `genesis.json` seed; throws on invalid shape. |
| `loadEventLog` | function | Read `events.jsonl`, validate each line via `parseEvent`; a corrupt line is diverted to `{quarantined}` (and durably surfaced to `events.jsonl.quarantine`) rather than aborting the load. |
| `assertLogFullyLoaded` | function | Throw loud if any line was quarantined — refuses to fold a partial log (a dropped material event would silently skew NAV). Also used by the TUI's own ingest guard. |
| `loadFoldedReview` | function | Compose the above: load genesis + log, assert fully loaded, fold to `asOf` (or current). A pure READ — never ingests, never writes the log. Returns the whole `FoldedReview` envelope (`{data, skipped}`) and unwraps nothing — the refuse/report pair: refuses (throws via `assertLogFullyLoaded`) on what could not be read, reports (in `skipped`) what was read and then dropped by the fold (ADR-020, the Discard Channel). |
| `unattendedFoldVerdict` | function | The Discard Channel's unattended-surface policy over a fold's `skipped`: at most ONE fixed prose line carrying a count, deduped on (`eventId`, `reason`); empty on a clean fold. No `exitCode` — a fold discard is a standing fact about immutable history, not an errand that clears (ADR-020). |
| `formatFoldDiscards`, `MAX_FOLD_DISCARD_LINES` | function, value | The interactive-surface enumeration: one line per distinct dropped event (locator, verb, reason), bounded and announcing its own truncation. |
| `quarantineLogPath` | function | `${logPath}.quarantine` — the side-lane path. |
| `readOptional` | function | Read a file that may not exist, mapping `ENOENT` to `undefined`. THE canonical definition — imported by the TUI's ingest/migration paths and `apps/price-feed`'s inbox reader. `@numisma/preferences` deliberately keeps its own private copy rather than depend on this package (see `packages/preferences/src/sidecar-io.ts`); do not "fix" that duplication. |
| `EventStorePaths`, `QuarantinedLine`, `EventLogLoad` | types | The path bundle, one quarantined line `{lineNumber, line, reason}`, and the load result `{events, quarantined}`. |
| `LAUNCHD_ERA_START`, `REPORT_TIME_ZONE`, `computeGapReport`, `dueThrough`, `boundedEraFloor`, `formatGapReport`, `formatGapSummary` | values, functions | The gap report (#186): a pure, synchronous derivation over already-loaded events answering "which calendar days since 2026-07-03 did the price feed not run on?" Two verdicts only — `no-anchor` (no event carries the date) and `no-marks` (anchored but zero `PriceMarked` events). Never reports `marksOn(D) < 13`. |
| `GapReport`, `GapWindow`, `LostDay`, `LostDayReason` | types | The gap-report shapes. |
| `loadGapReport`, `gapReportPath`, `writeGapReportFile`, `GAP_REPORT_FILENAME`, `GAP_REPORT_SCHEMA_VERSION` | functions, values | The gap report's one async shell: read the log, assert fully loaded, derive, and (de)serialize `gap-report.json` beside the log. Content is dates and counts only — no NAV, positions, prices, or balances. |
| `HEARTBEAT_FILENAME`, `HEARTBEAT_SCHEMA_VERSION`, `parseHeartbeat`, `formatHeartbeatWarning` | values, functions | The daily job's heartbeat (#191): parse the bash-written `job-heartbeat.json` breadcrumb (never throws — unreadable/malformed reads as `undefined`) and derive up to three warning lines (non-zero exit, a future-dated run, or staleness measured against the last in-window run vs. the gap report's ceiling). |
| `JobHeartbeat` | type | The breadcrumb shape: `schemaVersion`, `startedAt`, `finishedAt`, `exitCode`, `lastStep`, `markWindow`, optional `lastMarkWindowFinishedAt`. |
| `heartbeatPath`, `loadHeartbeat`, `loadHeartbeatLines` | functions | The heartbeat's read-only IO shell — this package never writes it (the writer is a `printf` in `ops/price-feed/run-daily-fetch.sh`, deliberately plain bash so it survives `node`/`pnpm` being unresolvable). |

`./testkit` is a **separate** subpath export (`src/genesis-seed.testkit.ts`,
`genesisSeed()` + `GENESIS_SEED_AS_OF` / `GENESIS_SEED_FUND_NAME`) kept out of
the production entry point on purpose — test scaffolding shared with
`apps/web`'s push fixtures, coverage-excluded via the `.testkit.ts` glob.

## Invariants enforced

- **Quarantine over abort (the write-on-read invariant).** A corrupt log line
  never aborts a read; it is collected and durably surfaced to
  `events.jsonl.quarantine` (`loadEventLog` → `surfaceQuarantine`). Two halves,
  and only one of them is universal. **Universal, on every reader of the log:**
  the log and genesis themselves are never written on read — the single path
  touched is that derived sidecar beside the log, and it is maintained
  *unconditionally*, written when the log does not read clean and removed when
  it does, so a fixed log self-heals. **Scoped, and the caller's job:**
  `assertLogFullyLoaded` is a separate function nothing calls for you. The
  fold/ingest read paths pair it with the load immediately (`loadFoldedReview`,
  the TUI's `ingestInbox`, `loadGapReport`, the price feed's spine pre-check),
  and there the sidecar write and the fail-loud stop are the same event — the
  scoping ADR-003 states. A bare `loadEventLog` writes the sidecar and returns
  a partial load *without throwing*; two readers decline the assert on purpose
  and say so at their call sites (`loadVenueDarkAsOf` and `enumerateAnchors` in
  `apps/web/src/push`). A new reader inherits the sidecar write, never the
  throw.
- **Fail loud on partial logs.** `assertLogFullyLoaded` refuses to fold when
  any line was quarantined — a silently-dropped event would skew NAV.
- **Gap report reports, never fills.** `computeGapReport` is pure and
  synchronous over already-loaded events; it writes nothing to the log or any
  projection, and never names "today" (`dueThrough` clamps to CDMX yesterday).
- **Heartbeat never throws.** `parseHeartbeat` treats any unreadable/malformed
  breadcrumb as absent (`undefined`); a trap-written file caught mid-write on
  a failing machine is an ordinary case, not an exceptional one.
- **Heartbeat schema forward-compatibility.** `HEARTBEAT_SCHEMA_VERSION` is
  `2`, but the reader accepts `{1, 2}` (`READABLE_SCHEMA_VERSIONS`) since the
  bash writer is installed by hand and a reader that only accepted the newest
  version would go blind between a `git pull` and a LaunchAgent reinstall.

## On-disk shapes read (all under the resolved data dir)

| Path | Shape | Written by |
| --- | --- | --- |
| `genesis.json` | Immutable `FundReviewData` t0 seed | outside this package |
| `events.jsonl` | Append-only, one `PortfolioEvent` JSON per line | `apps/tui` (this package never writes it) |
| `events.jsonl.quarantine` | One `QuarantinedLine` JSON per line | this package, on read (`surfaceQuarantine`) |
| `gap-report.json` | `{schemaVersion, generatedAt, since, until, calendarDays, anchorsChecked, lost[], summary, lines[]}` | this package (`writeGapReportFile`) |
| `job-heartbeat.json` | `JobHeartbeat` (see above) | `ops/price-feed/run-daily-fetch.sh` (bash, not this package) |

## Dependencies

Workspace: `@numisma/engine` only (`resolveDataDir`, `foldEvents`,
`parseEvent`, `parseFundReview`, `tradingDayAsOf`, `addDays`,
`INBOX_PATH_SEGMENTS`, and the `FundReviewData`/`PortfolioEvent` types).
Nothing depends on Bun, openTUI, or terminal rendering.

## Tests

Colocated with source: `src/event-store.test.ts`, `src/gap-report.test.ts`,
`src/gap-report-io.test.ts`, `src/heartbeat.test.ts`. `src/gap-report-io.test.ts`
includes the field-allowlist privacy walk over `gap-report.json`.

## Verification

From the repo root: `pnpm typecheck` (`packages/event-store/tsconfig.json`
extends the root config) and `pnpm test`.
