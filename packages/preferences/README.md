# @numisma/preferences

The **access-surface half** of ADR-004's sidecar class: for each member, the
path resolver, the total loader and the append-only writer, extracted out of
`apps/tui` so they can be reused off the TUI runtime (`feat(preferences):
extract the sidecar reader into @numisma/preferences`). ADR-004 defines the
class as *a durable, append-only, git-versioned file beside the event log,
carrying its own on-load validation contract, joined to the fold at read time by
a pure selector, and never folded*; ADR-001 keeps file IO out of
`@numisma/engine`, so each member's pure half — its record contract, its
vocabularies, its as-of selector — lives there and only the disk access lives
here.

**Which members those are is not a number this README states.** `src/index.ts`
is the enumeration, and it is the only one worth trusting: a member arrives by
being exported there, and this file goes stale the moment it tries to keep a
tally instead of pointing at one. What that enumeration carries today is the IO
surface for `preferences.jsonl` (revisable profit-split policy), `orders.jsonl`
(observed orders, ADR-013), `plans.jsonl` (the operator's hand-authored
declarations of intent) and `reconciliations.jsonl` (the record of what the
operator was told). Node-compatible — plain `node:fs/promises`, no Bun — and
depends only on `@numisma/engine` (the pure `pickPolicyAsOf` selector, the
`OrderRecord` contract / `parseOrderRecord` / `serializeOrderRecord`, the plan
and reconciliation contracts).

The package name names **one member of the class rather than the class itself**;
that debt is recorded in ADR-004 and deliberately not paid by a rename here. The
practical gain of adding a member inside this package is that it inherits the
existing `@numisma/preferences` import guard for free.

## Public surface

Enumerated explicitly in `src/index.ts` — this table tracks that file, and
where the two disagree `src/index.ts` is right:

| Export | Kind | Purpose |
| --- | --- | --- |
| `resolvePreferencesPath` | function | Resolve `<dataDir>/preferences.jsonl` under the shared `resolveDataDir` root (never CWD-relative). No `dataDir` takes that default; a PRESENT one routes through the engine's `normalizeDataDirOverride` (#369), the same one predicate every other door in the workspace uses — blank refused, `~` expanded, absolute normalized, relative refused. Only the refusal's VOICE is this door's own: silently resolving a blank here would serve a Reserve floor from a file nothing writes. |
| `loadPreferences` | function | Read the append-only sidecar into a total `LoadedPreferences` envelope: `{load, entries, skipped}` — a `LoadOutcome`, the ordered validated `ProfitPolicyEntry[]`, and one `SkippedPreferenceLine` per discarded line. A missing file is `{status: "loaded"}` with empty buckets (the normal starting state); any other read error is `{status: "load-failed", message}`. Never throws. |
| `unattendedPreferencesVerdict`, `UnattendedPreferencesVerdict` | function, type | The unattended-caller policy over a `LoadedPreferences`, as a value rather than a convention: `{exitCode, messages}`. Non-zero iff anything was skipped or the load failed; prose-only messages that name the file, the 1-based line and the reason, never the line's content. |
| `seedDefaultPreferences` | function | The **only** preferences writer: seed a **new** sidecar with the fund's locked default policy, only if it holds no valid entry yet — not a read-gap fallback; never call it to paper over a missing/quarantined policy. Its one-line append is inline; there is no general `appendPreference` entry point (see below). |
| `resolveOrdersPath` | function | Resolve `<dataDir>/orders.jsonl` under the shared `resolveDataDir` root. |
| `loadOrders` | function | Read the sidecar into a total `OrdersLoad` outcome: `{status: "loaded", records, skips}` \| `{status: "absent"}` \| `{status: "unreadable", message}`. Never throws. |
| `appendOrders` | function | Genuinely append-only: build the full next image, write to a same-directory unique temp file, then `rename` over the sidecar (crash-atomic), serialized across processes by an exclusive-create lock file. Those mechanics are shared (`sidecar-io.ts`); what stays here is the only part that is about orders — the canonical serialization of an `OrderRecord`. |
| `OrderSkip`, `OrdersLoad`, `LoadOrdersOptions` | types | One skipped line `{line, problem, message}`; the loader's three-way total outcome; `{warn?}` injection point for tests. |
| `resolvePlansPath` | function | Resolve `<dataDir>/plans.jsonl` under the same ADR-006 invariant — absolute and homedir-derived, never CWD-relative. **Which cases there are is not a number this row states.** They live once in `sidecar-io.ts`'s `resolveSidecarPath`, and that docstring is the enumeration — it carries an unset override landing on the accumulus default, an absolute one honored verbatim, and a relative or blank one refused loudly, each with the reasoning for why. |
| `loadPlans` | function | Read the **operator-authored** sidecar into a total `LoadedPlans` envelope; no input throws. A missing file is `loaded` with empty buckets — the normal starting state for a hand-authored file, so reporting it as an error would cry wolf on every fresh checkout — while any other read error is `load-failed`, which the selector turns into `unreadable` per position rather than `none`, because empty buckets alone would assert a fact about the fund nobody established. Forgiving of shape (BOM, CRLF, blank lines), strict about content. No diagnostic it produces ever quotes a line: plan bodies carry the fund's figures. |
| `appendPlan` | function | Append ONE plan line, genuinely and atomically. **The round-trip invariant is enforced here, not asserted in a comment:** the record is serialized, parsed back and run through the loader's own reader before a single byte reaches disk, so a record this accepts is one `loadPlans` reads back by construction. A rejection throws — an append-only file is the one place where writing something unreadable is unrecoverable. |
| `appendNoPlan`, `NoPlanInput` | function, type | Append the explicit **terminator** for one position: this plan is over. Not optional politeness — selection is "latest `effectiveAt ≤ asOf`", so without one the last plan line stays in force forever. It takes ONE object deliberately: the positional form's two adjacent strings swap and still typecheck, and the swapped call writes a durable line rather than failing loudly. |
| `unattendedPlansVerdict`, `UnattendedPlansVerdict` | function, type | The unattended-caller policy over a `LoadedPlans`: `{exitCode, messages}`, non-zero iff the file could not be read or any line in it was skipped. A launchd job's stderr goes to an unread log, so an exit code is the only checked value. It binds the callers that read plans and nothing else — a plans failure never withholds a push, and the fold never reads `plans.jsonl` at all. |
| `resolveReconciliationsPath` | function | Resolve `<dataDir>/reconciliations.jsonl` on the same terms. This is the one function in that module that **can** throw, and deliberately: a caller on the fill path resolves the path once, up front, outside the best-effort write. |
| `loadReconciliations` | function | Read the trail into a total `LoadedReconciliations` envelope; never throws. The trail is **the record that the operator was told** — not a record of what is true, never overriding `plans.jsonl` and never read in preference to it. `absent` is its own arm rather than folded into `loaded` the way `loadPlans` folds it: this file is machine-written, so its absence means the writer has never succeeded, which is a different fact needing a different instruction (and still exit code 0). A trail line that disagrees with a fresh re-derivation is a **finding, not a corruption** — a past plan was rewritten after the fact, and that divergence is recorded nowhere else. |
| `appendReconciliation` | function | Best-effort writer for the trail, and **never part of the fill act**: the fill is already durable when this runs, and nothing here can refuse a fill, roll one back or block a return. Every failure — a rejected round-trip echo, a serializer refusal on an unrenderable `positionId`, a lock the peer never released, a full volume — degrades to a loud stderr warn naming the resolved path, writes nothing, and returns normally. No warn it emits ever quotes a line or names a figure. |
| `unattendedReconciliationsVerdict`, `UnattendedReconciliationsVerdict` | function, type | The same shape and the same policy as `unattendedPlansVerdict`, divergent in the **diagnosis**: `plans.jsonl` is hand-authored, so a skip there is an operator typo; this file is machine-written, so a skip here is a torn write or corruption — a genuine incident, and the message says so. `absent` exits **0**, alone among the load arms, because before the first recorded fill absence is normal; it still says something, because the same absence after fills have been recorded means the write has never succeeded. |

## Invariants enforced

- **Append-only, class-wide.** No writer here ever destroys prior history, and
  the append discipline is no longer per-file boilerplate: `sidecar-io.ts` holds
  the shared mechanics — the cross-process lock, the unique same-directory temp
  sibling, the torn-terminator repair and the atomic `rename` — and `orders.ts`,
  `plans.ts` and `reconciliations.ts` all append through it.
  `preferences.jsonl` is the bounded exception: its single writer,
  `seedDefaultPreferences`, keeps one inline `appendFile`. Temp + rename is the
  stronger contract, chosen because a plain `appendFile` suffix-write on a torn
  last line has concretely lost records before — the plans-sidecar prototype
  took the suffix-only path and lost two records unattributably (see
  `orders.ts`'s header).
- **No general preferences write surface.** `preferences.jsonl` has exactly one
  writer, `seedDefaultPreferences`, whose single-line append is inline. The
  package used to export an `appendPreference` — documented and tested, with
  no caller outside the seeder, on the weaker `appendFile` contract above. It was deleted rather
  than hardened, so a future `preferences:set` cannot inherit the rejected
  shape: whoever needs to write a policy must add that entry point deliberately,
  on the shared lock + temp + rename contract.
- **Cross-process write serialization for every shared-mechanics append.**
  `appendSidecarLines` takes an exclusive-create lock file (`<path>.lock`)
  before its read-modify-write, because two overlapping appends reading the same
  image would otherwise let the second `rename` silently discard the first's
  batch. A waiter refuses after `LOCK_TIMEOUT_MS` (10s) rather than break a lock
  it cannot prove is stale.
- **Validate on load, report every discard — never throw** (the Discard
  Channel, ADR-020). Every loader here treats a malformed line as skippable
  input, not a fatal error, and **returns the discard to the caller** rather
  than dropping it silently: `loadPreferences` returns one
  `SkippedPreferenceLine` per rejected line (1-based line number,
  closed-vocabulary reason, fixed prose that never quotes the line) inside its
  `LoadedPreferences` envelope; `loadOrders` returns every skip
  (`OrderSkip[]`) and additionally offers a `warn` callback — an addition to the
  envelope, never a substitute for it. Every loader also distinguishes "nothing
  to read" from "could not be read" (`loadPreferences`'s and `loadPlans`'s
  `loaded`/`load-failed`, `loadOrders`'s `absent`/`unreadable`,
  `loadReconciliations`'s `absent`/`load-failed`) — collapsing those would let
  a permissions error render as an unencumbered balance, or as a fund that has
  set no policy. No loader decides the consequence: that is the
  `unattended*Verdict` functions' job, and per ADR-020's fifth clause the
  consequence is never to withhold the push.
- **Strict ISO calendar dates only.** `preferences.jsonl`'s `effectiveAt`
  must match `YYYY-MM-DD` exactly (no time component) because
  `pickPolicyAsOf` orders entries by string comparison; a `Date.parse`-able
  but non-ISO stamp would sort wrong and silently select the wrong policy.
- **Deliberate duplication of `readOptional`.** This package keeps a private
  copy of the "ENOENT means absent" helper (`sidecar-io.ts`, under a docblock
  that says so explicitly) rather than depending on `@numisma/event-store`'s
  canonical one, to avoid a permanent `preferences -> event-store` edge; the
  helper carries zero policy, so the copies cannot drift into disagreement
  (tracked as intentional under #198, not #141's "one definition" rule).

## On-disk shapes (under the resolved data dir)

| Path | Shape | Tracked/ignored |
| --- | --- | --- |
| `preferences.jsonl` | Append-only, one `ProfitPolicyEntry` JSON per line: `{effectiveAt, split: {wealth, reserve}, splitBasis, routingReserveId, reserveTargetPct}` | tracked — fund policy, not secret transaction data |
| `orders.jsonl` | Append-only, one `OrderRecord` JSON per line (contract defined in `@numisma/engine`) | tracked |
| `plans.jsonl` | Append-only and **operator-authored by hand**, one `PlanRecord` JSON per line (contract defined in `@numisma/engine`) | tracked |
| `reconciliations.jsonl` | Append-only and **machine-written**, one `ReconciliationRecord` JSON per line: what the operator was shown at a named moment, carrying a denormalized copy of the declared values as shown — because plan supersession is append, so the verdict as shown is not recoverable from the sidecar later | tracked — durable, non-re-derivable truth under ADR-006's membership test |
| `<sidecar>.jsonl.<pid>.<n>.tmp` | Transient unique same-directory temp sibling for one atomic append (`sidecar-io.ts`), unique across both concurrency axes — two processes, and two overlapping `await`s inside one | ignored |
| `<sidecar>.jsonl.lock` | Transient exclusive-create lock file guarding one append | ignored |

## Dependencies

Workspace: `@numisma/engine` only (`resolveDataDir`,
`normalizeDataDirOverride` — the ONE data-dir predicate every door here routes
through, `defaultProfitPolicyEntry`, `pickPolicyAsOf`,
`parseOrderRecord`, `serializeOrderRecord`, the plan and reconciliation record
contracts with their closed vocabularies and the strict calendar-date predicate,
and the `ProfitPolicyEntry` / `SplitBasis` / `OrderRecord` /
`OrderRecordProblem` types). Deliberately **not** dependent on
`@numisma/event-store` (see the `readOptional` duplication above).

## Tests

Colocated with source, one `*.test.ts` beside the module it covers — that
colocation rule is the durable statement here, and
`ls packages/preferences/src/*.test.ts` is the current list. Each sidecar
carries a `<module>-reliable.test.ts` reliability suite, plus a targeted
failure-path suite wherever a degradation needs its own file (e.g.
`sidecar-io-append-failure.test.ts`).

## Verification

From the repo root: `pnpm typecheck` (`packages/preferences/tsconfig.json`
extends the root config) and `pnpm test`.
