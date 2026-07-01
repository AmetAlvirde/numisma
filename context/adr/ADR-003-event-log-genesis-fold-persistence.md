# Append-only event log, immutable genesis seed, and fold to the review model

_Made during: MVI — portfolio history persistence increment / 2026-06-29 prototype → reliable conversion (publication gate for PRD "Persists portfolio history as an append-only event log with as-of review")_
_Scope: product_
_Status: accepted (amended 2026-07-01 — see "Amendment: cash leg + durable-log migration/versioning" below)_

The durable source of truth for portfolio history is an append-only **event log**
of material actions (`PositionOpened` / `PositionClosed` / `PriceMarked`) layered
on an immutable **genesis seed** (today's full `FundReviewData`); current state and
any as-of view are a pure **fold** of the log into the existing `FundReviewData`
read model, so `buildCompositionReport` and the whole dashboard are reused
unchanged, and untrusted events must pass a **validated ingest boundary** before
they reach the log. Chosen because the domain is already event-shaped and immutable
(Audit Event, Close, immutable Tempo, the close-and-reopen-with-lineage rule), so
persisting the *stream of actions* rather than a mutable snapshot is the honest
model and yields replay, durable audit history, and as-of review for free. Per
ADR-001 the fold is pure `@numisma/engine` domain while file IO, inbox detection,
dedup persistence, and startup orchestration stay in `@numisma/tui`.

## Considered Options

- **SQLite / relational store.** Rejected for v1: adds a query engine and a
  migration surface the single-user, local-first, manual-entry product does not
  need yet. The persistence seam keeps it available later — an explicit non-goal,
  not foreclosed.
- **Mutable current-state store (overwrite the snapshot in place).** Rejected: it
  destroys the durable audit history that is the generative core and structurally
  cannot answer as-of review.
- **Dated full snapshots (one `FundReviewData` per review point).** Rejected: it
  stores state, not material actions — duplicating unchanged data every period,
  carrying no per-action decision context, and turning "what changed and why" into
  a diff problem instead of a log.
- **Decision context as fields on `PositionRecord` vs. a sidecar journal
  projection.** Leaning sidecar (the ADR-B candidate that may fold in here, ratified
  when the surfacing increment lands): decision context must outlive a Position
  close, models a per-position timeline (opened / adjusted / closed), and
  genesis-legacy holdings have no thesis — all of which a list keyed by id absorbs
  and record fields cannot without breaking the `FundReviewData` contract and every
  genesis seed.

## Consequences

- **Schema-on-read / migration cost (this is the "hard to reverse").** The event
  schema is now load-bearing persisted truth; changing a verb's shape means
  migrating or versioning existing log lines, not editing one file.
- **The integrity boundary is the ingest gate, not the read model.** Before this
  increment a single deep `parseFundReview` turned untrusted input into a trusted
  read model. Now the fold *produces* the read model from already-validated events,
  so trust must be established at ingest: structural `parseEvent`, **plus
  cross-reference to genesis ids** (a `PositionClosed` / `PriceMarked` for an
  unknown id, or an open-id colliding with a genesis position/reserve id, fails
  loud instead of silently no-op'ing), **plus a `PriceMarked` magnitude guard** (a
  mark deviating beyond a threshold from the instrument's last Close is
  rejected/flagged, catching currency-unit and fat-finger entry). The magnitude
  threshold is a tunable constant, not itself ADR-worthy. A fold-output
  `parseFundReview` post-condition is an allowed secondary defense; cross-ref-at-
  ingest is preferred because it fails where the user can still fix the inbox.
- **`markprice-close-mismatch` no longer fires on the event path.** One
  `PriceMarked` writes both the authoritative `markPrice` and the display-only
  Close at the same number, so they agree by construction; the ingest magnitude
  guard replaces that lost coherence signal rather than duplicating it.
- **Decision context is durably logged immediately; surfacing is a later
  increment.** A `PositionOpened` cannot validate without the five decision fields
  (the product coherence signal), and the full event — including `decision` — is
  persisted and re-validated on read, so the audit-history core is honored at the
  persistence layer even before the read model surfaces it.
- **The seam survives later access surfaces.** In-TUI input forms and any future
  client write the *same* events; nothing built on this spine is transitional.
- **ADR-001 / ADR-002 hold.** The pure fold lives in `@numisma/engine`, IO/inbox/
  orchestration in `@numisma/tui`; events carry `PositionLot[]` with `tier`/
  `entryFx` and the fold preserves per-tier attribution and entry FX into the read
  model.

## Amendment: cash leg + durable-log migration/versioning

_Made during: MVI — cash-settlement increment / 2026-06-30 prototype → reliable
conversion (PRD "Conserves the cash leg of every capital movement", #82) /
slice "Migrates the durable log to a versioned record shape" (#83)._

The cash-settlement increment amends this ADR's load-bearing schema and trust model:

- **3 verbs → 6.** The enumeration is now `PositionOpened` / `PositionClosed` /
  `PriceMarked` / `Deposit` / `Withdraw` / `Transfer`.
- **The cash leg rides atomically on the trade leg.** A `PositionOpened` cannot
  validate without a `funding: {reserveId, amount}` leg, and a `PositionClosed`
  without a `settlement: {reserveId, proceeds}` leg. This is what makes the original
  frozen-cash drift structurally impossible: a close cannot retire an asset leg
  without settling cash to a named Reserve. (Chosen over a standalone cash-ledger
  entry — a hybrid on-the-trade-leg shape keeps the double-entry atomic.)
- **The fold stays a pure projection.** Reserves are now *mutated by the fold* (the
  seam `applyReserveDelta`), but the zero-drift invariant is enforced at the **ingest
  boundary** (schema atomicity + per-tier sufficiency + settlement-magnitude), never
  by an in-fold assertion — ADR-003's original promise is preserved.

### The durable-log migration/versioning contract (the "hard to reverse", realized)

The original ADR flagged "schema-on-read / migration cost" as the hard-to-reverse
consequence. This increment makes the verb shape load-bearing (`funding`/`settlement`
are now *required*), so pre-cash-leg log lines no longer parse. The original graceful
path — a line that fails `parseEvent` is quarantined to a side lane and the fold
proceeds *without* it — is **honest for genuinely-corrupt noise but wrong for a
material event**: dropping an open/close and folding the rest yields a
plausible-but-wrong NAV, the exact drift class this MVI exists to eliminate. The
contract is therefore:

- **Fail loud on a partial log.** The fold/ingest read path
  (`loadFoldedReview` / `ingestInbox`) now **refuses to run when any log line is
  unloadable**, after still surfacing the quarantine side lane for diagnostics. This
  **reverses the prototype's "a corrupt line degrades gracefully, startup proceeds"
  behavior** for these paths — a deliberate trade-off: a loud stop the operator must
  fix beats a silent skew they might not notice. `foldEvents` itself is untouched and
  still pure; the loud stop lives in the access surface.
- **An explicit `schemaVersion` marker.** Every record the app or the migration
  writes is stamped with `EVENT_SCHEMA_VERSION` (currently `2`; v1 = the pre-cash-leg
  shape). It is a storage-layer marker (parse strips it), written so the record shape
  is explicit and future migrations are version-targetable. Parse is **version-aware**:
  a record tagged *newer* than the running build fails loud (forward-compat guard)
  rather than being misread.
- **A codified one-shot migration, not an optional default.** Legacy open/close
  records are migrated by `migrateLegacyEvent` / `migrateLegacyLog`, which graft an
  **operator-supplied** cash leg (keyed by event id) and re-validate through the same
  v2 ingest gates. The cash leg is *not* defaulted or synthesized — the settling
  Reserve and the proceeds/funding split are real-world facts only the operator
  holds, and a fabricated default would reintroduce the drift. The migration
  cross-references the whole rewritten log in order and fails loud (writing nothing)
  if any legacy record lacks a supplied leg or a supplied leg is non-conserving.

### Append-only, preserved

The one-shot migration rewrites the existing log once (a sanctioned reconstruction,
run via `pnpm migrate:log` against a git-ignored mapping). This is **not a runtime
precedent**: going forward the log stays append-only and immutable, and the atomic
temp-and-rename append (added earlier in this ADR's durability slice) still holds.
Considered and rejected: **optional-with-explicit-default fields** (a defaulted cash
leg fabricates a cash movement that never happened — silent NAV drift, the thing this
MVI kills).
