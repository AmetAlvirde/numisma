# @numisma/preferences

The access-surface half of two file-IO sidecars extracted out of `apps/tui`
so they can be reused off the TUI runtime: the **profit-split preferences**
sidecar (`preferences.jsonl`, `feat(preferences): extract the sidecar reader
into @numisma/preferences`) and, as a later third tenant, the **orders**
sidecar (`orders.jsonl`, ADR-013). Node-compatible — plain
`node:fs/promises`, no Bun — and depends only on `@numisma/engine` (ADR-001
keeps file IO out of the engine; the pure `pickPolicyAsOf` selector and the
`OrderRecord` contract/`parseOrderRecord`/`serializeOrderRecord` live there).

The package name now names one member of a two-sidecar class rather than the
class itself; that debt is recorded in ADR-004 and deliberately not paid by a
rename here.

## Public surface

Enumerated explicitly in `src/index.ts`:

| Export | Kind | Purpose |
| --- | --- | --- |
| `resolvePreferencesPath` | function | Resolve `<dataDir>/preferences.jsonl` under the shared `resolveDataDir` root (never CWD-relative). |
| `loadPreferences` | function | Read the append-only sidecar into ordered, validated `ProfitPolicyEntry[]`. A missing file is `[]`; a malformed/out-of-range line is quarantined (dropped), not thrown. |
| `appendPreference` | function | Genuinely append-only: add one `ProfitPolicyEntry` line without touching prior entries. |
| `seedDefaultPreferences` | function | Seed a **new** sidecar with the fund's locked default policy only if it holds no valid entry yet — not a read-gap fallback; never call it to paper over a missing/quarantined policy. |
| `resolveOrdersPath` | function | Resolve `<dataDir>/orders.jsonl` under the shared `resolveDataDir` root. |
| `loadOrders` | function | Read the sidecar into a total `OrdersLoad` outcome: `{status: "loaded", records, skips}` \| `{status: "absent"}` \| `{status: "unreadable", message}`. Never throws. |
| `appendOrders` | function | Genuinely append-only: build the full next image, write to a same-directory unique temp file, then `rename` over the sidecar (crash-atomic), serialized across processes by an exclusive-create lock file. |
| `OrderSkip`, `OrdersLoad`, `LoadOrdersOptions` | types | One skipped line `{line, problem, message}`; the loader's three-way total outcome; `{warn?}` injection point for tests. |

## Invariants enforced

- **Append-only, both sidecars.** Neither writer ever destroys prior history;
  `preferences.jsonl` appends via `appendFile`, `orders.jsonl` appends via
  temp-file + `rename` for crash-atomicity (the stronger contract, chosen
  because a plain `appendFile` suffix-write on a torn last line has
  concretely lost records before — see `orders.ts`'s header).
- **Cross-process write serialization for orders.** `appendOrders` takes an
  exclusive-create lock file (`<path>.lock`) before its read-modify-write,
  because two overlapping appends reading the same image would otherwise let
  the second `rename` silently discard the first's batch. A waiter refuses
  after `LOCK_TIMEOUT_MS` (10s) rather than break a lock it cannot prove is
  stale.
- **Validate on load, quarantine on failure — never throw.** Both loaders
  treat a malformed line as skippable input, not a fatal error:
  `loadPreferences` silently drops a bad line; `loadOrders` reports every
  skip (`OrderSkip[]`) via both a `warn` callback and the returned outcome,
  distinguishing `absent` (no file) from `unreadable` (a real read error) —
  collapsing those would let a permissions error render as an unencumbered
  balance.
- **Strict ISO calendar dates only.** `preferences.jsonl`'s `effectiveAt`
  must match `YYYY-MM-DD` exactly (no time component) because
  `pickPolicyAsOf` orders entries by string comparison; a `Date.parse`-able
  but non-ISO stamp would sort wrong and silently select the wrong policy.
- **Deliberate duplication of `readOptional`.** This package keeps a private
  copy of the "ENOENT means absent" helper (`orders.ts`) rather than
  depending on `@numisma/event-store`'s canonical one, to avoid a permanent
  `preferences -> event-store` edge; the helper carries zero policy, so the
  copies cannot drift into disagreement (tracked as intentional under #198,
  not #141's "one definition" rule).

## On-disk shapes (under the resolved data dir)

| Path | Shape | Tracked/ignored |
| --- | --- | --- |
| `preferences.jsonl` | Append-only, one `ProfitPolicyEntry` JSON per line: `{effectiveAt, split: {wealth, reserve}, splitBasis, routingReserveId, reserveTargetPct}` | tracked — fund policy, not secret transaction data |
| `orders.jsonl` | Append-only, one `OrderRecord` JSON per line (contract defined in `@numisma/engine`) | tracked |
| `orders.jsonl.<pid>.<n>.tmp` | Transient temp sibling for the atomic append | ignored |
| `orders.jsonl.lock` | Transient exclusive-create lock file | ignored |

## Dependencies

Workspace: `@numisma/engine` only (`resolveDataDir`, `defaultProfitPolicyEntry`,
`parseOrderRecord`, `serializeOrderRecord`, and the `ProfitPolicyEntry` /
`SplitBasis` / `OrderRecord` / `OrderRecordProblem` types). Deliberately
**not** dependent on `@numisma/event-store` (see the `readOptional`
duplication above).

## Tests

Colocated with source: `src/preferences-reliable.test.ts`,
`src/orders-reliable.test.ts`.

## Verification

From the repo root: `pnpm typecheck` (`packages/preferences/tsconfig.json`
extends the root config) and `pnpm test`.
