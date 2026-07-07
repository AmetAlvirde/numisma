# Append-only event log, immutable genesis seed, and fold to the review model

_Made during: MVI — portfolio history persistence increment / 2026-06-29 prototype → reliable conversion (publication gate for PRD "Persists portfolio history as an append-only event log with as-of review")_
_Scope: product_
_Status: accepted (amended 2026-07-01 — see "Amendment: cash leg + durable-log migration/versioning" below; amended 2026-07-02 — see "Amendment: closed-book fold output + invalidation verb" below; amended 2026-07-02 — see "Amendment: trim/add verbs + lot-mutating fold + partial closed-book rows" below; amended 2026-07-07 — see "Amendment: the derived Head Digest breadcrumb" below)_

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

## Amendment: closed-book fold output + invalidation verb

_Made during: MVI — realized-P&L increment / 2026-07-01 prototype → 2026-07-02
prototype → reliable conversion (PRD "Records realized P&L on a closed-position
blotter and flags invalidated theses", #90) / slice "Ratifies the closed-book and
invalidation event schema and de-prototypes the engine code" (#91)._

The realized-P&L increment amends this ADR's load-bearing persisted schema and the
fold's output shape. As with the cash-settlement amendment, these decisions become
persisted truth on the first real write, so they are ratified before any
`InvalidationMarked` reaches the durable log (no forced later log migration).

- **6 verbs → 7.** The enumeration is now `PositionOpened` / `PositionClosed` /
  `PriceMarked` / `Deposit` / `Withdraw` / `Transfer` / `InvalidationMarked`.
  `InvalidationMarked { positionId, price, direction }` sets (or revises) a
  Position's structured invalidation level, folded **latest-wins per `positionId`**
  — modeled parallel to `PriceMarked` (latest-wins per instrument), not a field
  locked at open. `PositionOpened` is unchanged; the prose `invalidationCondition`
  in the opening decision stays beside the new structured level. Chosen over a
  locked-at-open field because a thesis level is revisable and must be settable
  independently of the open (a real trade-off: revisability + a distinct audit
  entry vs. a single opening payload).
- **The fold emits a third persisted read-model output: `closedPositions[]`.**
  Instead of `positions.delete()` on close (the old behavior that threw the record
  away), the fold builds a `ClosedPositionRecord` carrying realized Trading P&L =
  `proceedsUsd − Σ(lot USD cost at entry FX)` — one blended number, FX gain/loss
  baked in per ADR-002's FX-P&L deferral, attributed per Capital Tier by reusing the
  cash-leg seam (`reserveDeltasForClose`) so the split is consistent-by-construction
  with the Reserve credit the same close produces. This is a **third output beside
  open positions + reserves**; the closed book is a first-class read-model artifact,
  not a deletion. **Realized is descriptive-only** — it is never added to NAV (the
  cash leg already booked the profit into a Reserve at close); this is a permanent
  invariant, locked by the blank-the-closed-book test (`{ ...data, closedPositions:
  [] }` leaves `fundValueUsd` unchanged). This is the "surprising without context"
  test: realized shows *how the Fund got here*, never a second source of value.
- **Three new optional `PositionRecord` read-model fields — `openedAsOf`,
  `strategy`, `invalidation`.** `openedAsOf` / `strategy` are carried through the
  fold (previously silently dropped) so the closed book can tag open/close dates and
  attribute realized per strategy; `invalidation` holds the latest structured level
  for compose-time breach derivation. All three are **optional** — genesis-held
  positions (opened before the log existed) honestly carry no `openedAsOf` /
  `strategy`, and `invalidation` is absent until the first mark — so existing genesis
  seeds and folds keep validating and folding unchanged (`FundReviewData
  .closedPositions?` is likewise optional, and the fold always emits `[]`).
- **Ratified `direction` spelling = `below` / `above`** (chosen over `lte` / `gte`).
  This becomes persisted-schema truth the moment an `InvalidationMarked` is written
  to the durable log, so it is ratified here before the first persist; re-spelling
  later would be a log migration. Semantics: `below` = a long's stop (breached when
  the mark falls to/through the level), `above` = a short's stop (breached when the
  mark rises to/through it). Breach is **derived per OPEN position at compose**, not
  stored.

### `EVENT_SCHEMA_VERSION` decision: `InvalidationMarked` is a v2-era additive verb (no bump)

`EVENT_SCHEMA_VERSION` **stays `2`**. `InvalidationMarked` is documented as a
**v2-era additive verb**, not a version bump to `3`. Rationale:

- **The version marker in this codebase tracks persisted *record shape* /
  migration generations, not verb-set cardinality.** The v1 → v2 bump was forced
  because `funding` / `settlement` became **required** on existing verbs, so v1
  open/close lines *stopped parsing* and needed the one-shot `migrateLegacyEvent`
  transformation. `InvalidationMarked` introduces **no shape change to any existing
  verb and needs no migration of any existing line** — every prior record parses
  byte-for-byte identically. Bumping to `3` with no `v2 → v3` migration would make
  the marker denote something it does not (a shape generation that never changed),
  and would wrongly re-stamp the legacy cash-leg migration output — a v2-shape
  record — as `v3`.
- **No silent-misread risk either way, so no bump is needed for safety.** A new verb
  is purely additive: an older build meeting an `InvalidationMarked` line fails loud
  at the per-verb parse switch (unknown `type` → ingest error → the fail-loud-on-
  partial-log read path refuses to fold), never a silent misread. The forward-compat
  `schemaVersion` guard exists to prevent *misreads of a changed shape*; there is no
  changed shape here for it to guard. Keeping the version at `2` therefore keeps the
  guard honest without over-stamping: a plain `PositionOpened` a v2-era build fully
  understands is not spuriously rejected on a version marker.
- **Consequence for the "one version = one verb set" concern.** A given
  `schemaVersion` no longer implies a fixed verb *cardinality* — it denotes the
  persisted *record shape*. That is acceptable and explicit: additive verbs that
  change no existing record shape ride within the current version; a future change
  that alters an existing verb's required shape (as cash-settlement did) is what
  bumps the marker and triggers a targeted migration.

### Append-only and ADR-001/002, preserved

The fold stays a **pure projection** and lives in `@numisma/engine`; the closed-book
build (`buildClosedPosition`), the invalidation fold, and the compose-time breach
derivation (`buildInvalidationWatch`) are all pure. `packages/tui/src/event-store.ts`
is unmodified — it dispatches events generically, so the 7th verb reaches the real
ingest/persist path with zero access-surface change. ADR-002 is respected, not
extended: realized uses cost basis at entry FX and inherits the FX-P&L deferral
verbatim. Considered and rejected: **realized as a field on the surviving open
`PositionRecord`** (a closed trade is not an open holding — it must survive the
close as its own record) and **realized additive to NAV** (double-counts the profit
the cash leg already booked into a Reserve).

## Amendment: trim/add verbs + lot-mutating fold + partial closed-book rows

_Made during: MVI — partial-close + profit-split increment / 2026-07-02 prototype →
reliable conversion (PRD "Trims and adds to Positions and derives the profit-split
obligation", #96) / slice "Ratifies the trim/add event schema amendment and the
preferences-sidecar boundary" (#97)._

The partial-close + profit-split increment amends this ADR's load-bearing persisted
schema and — for the first time — the fold's treatment of **open** positions. As with
the cash-settlement and realized-P&L amendments, these decisions become persisted
truth on the first real write, so they are ratified before any `PositionTrimmed` /
`PositionAddedTo` reaches the durable log (no forced later log migration). The
`product.md`/glossary ratification of the trader-facing vocabulary these verbs imply
("Position Trim", "Position Add-To", the trim-reject-on-empty rule) lands separately
in slice #103.

- **7 verbs → 9.** The enumeration is now `PositionOpened` / `PositionClosed` /
  `PriceMarked` / `Deposit` / `Withdraw` / `Transfer` / `InvalidationMarked` /
  `PositionTrimmed` / `PositionAddedTo`. `PositionTrimmed { positionId, removals:
  [{tier, quantity}], settlement }` takes partial profit off named tiers; the atomic
  `settlement` cash leg rides on it exactly as `PositionClosed`'s does (the
  cash-settlement amendment's on-the-trade-leg discipline, preserved).
  `PositionAddedTo { positionId, lot, funding }` scales into an existing Position; the
  atomic `funding` cash leg rides on it exactly as `PositionOpened`'s does.
- **The fold now mutates open-position lots — a new capability.** Before this
  amendment the fold only ever *created* a Position (open) or *retired* it
  (close/delete); reserves were the only records it mutated in place (the
  cash-settlement amendment). `PositionTrimmed` **removes named quantities from an
  open Position's lots** (the position survives with reduced lots); `PositionAddedTo`
  **appends a new lot** to an open Position. The fold stays a pure projection — the
  mutation is of the in-memory fold accumulator, and every invariant is still enforced
  at the **ingest boundary** (per-tier sufficiency + full-retirement rejection +
  settlement/funding magnitude), never by an in-fold assertion. ADR-003's original
  promise — a pure fold, trust established at ingest — is preserved.
- **The fold emits *partial* `closedPositions[]` rows that share the surviving
  Position's lineage id.** A trim produces a `ClosedPositionRecord` with `partial:
  true` carrying the realized Trading P&L on the removed quantity (proceeds − Σ removed
  lot USD cost at entry FX, one blended number per ADR-002), attributed per Capital
  Tier by reusing `reserveDeltasForClose` — consistent-by-construction with the Reserve
  credit the same trim produces. Crucially, **the partial row carries the id of the
  Position that is still open**: many partial trims plus a final full close all thread
  **one `positionId`** on the blotter (partials carry `partial: true`; the final close
  does not). Realized stays **descriptive-only** — never added to NAV (the cash leg
  already booked the proceeds into a Reserve) — the #90 blank-the-closed-book lock,
  extended to partial rows.
- **`ClosedPositionRecord.partial?` is optional / back-compat (C2).** The only
  construction site is `buildClosedPosition`; full closes omit the flag entirely, so
  existing folds and #90 closed-book consumers are unaffected. The one internal seam
  change is `buildClosedPosition` gaining a `lots` subset param + `partial` flag (C3,
  no external callers).

### `EVENT_SCHEMA_VERSION` decision: two additive verbs, marker stays `2` (C4)

`EVENT_SCHEMA_VERSION` **stays `2`**. `PositionTrimmed` and `PositionAddedTo` are
documented as **v2-era additive verbs** — the `InvalidationMarked` precedent applied
again, for the same reasons:

- **No existing record shape changes and no line needs migration.** Every prior
  record — genesis seeds, opens, closes, marks, cash movements, invalidations — parses
  byte-for-byte identically. The v1 → v2 bump was forced only because `funding` /
  `settlement` became **required** on existing verbs; nothing of that kind happens
  here. The new `partial?` field lives on the fold's *read-model output*
  (`ClosedPositionRecord`), not on any persisted event verb, and is optional. Bumping
  to `3` with no `v2 → v3` migration would make the marker denote a shape generation
  that never changed and would over-stamp records the running build already fully
  understands.
- **The forward-compat guard stays honest.** An older build meeting a
  `PositionTrimmed` / `PositionAddedTo` line fails loud at the per-verb parse switch
  (unknown `type` → ingest error → the fail-loud-on-partial-log read path refuses to
  fold), never a silent misread. One `schemaVersion` marker must **not** denote two
  different verb sets in a way that endangers reads — and it does not, because the
  marker tracks *persisted record shape*, not verb-set cardinality (the concern
  resolved in the realized-P&L amendment). Additive verbs that change no existing
  record shape ride within the current version; only a change to an existing verb's
  required shape bumps the marker.

### The three SDP tests, restated for this amendment

- **Hard to reverse.** The verb enumeration and the trim/add settlement shapes become
  persisted log truth on the first real write, and the retire-on-empty/reject semantics
  are baked into the ingest gate — re-spelling or re-scoping either later is a log
  migration, not a one-file edit.
- **Surprising without context.** A **partial closed-book row shares the id of a
  Position that is still open** (not a new id, not the retired-position pattern of a
  full close), and the profit-split obligation these partials feed is descriptive-only
  on the exact cumulative total — it is never a second source of NAV. Neither is
  guessable from the record shapes alone.
- **A real trade-off.** Two were decided:
  - **Trader-directed *between* tiers vs. pro-rata *within* a tier.** The trader names
    which tiers to trim (`removals: [{tier, quantity}]`) — deliberate control over
    *which* capital comes off — while removal *within* each named tier's lots is
    pro-rata (the last in-tier lot absorbing the float residual so `Σ removed ===
    quantity` exactly). Chosen over fully trader-directed lot picking (needless
    per-lot ceremony for a single-operator fund) and over fully pro-rata across all
    tiers (which would silently trim a tier the trader meant to leave running with its
    stop).
  - **Full-retirement REJECT vs. alias-to-`PositionClosed`.** A trim whose removals
    would empty the Position **fails loud at the ingest gate** and tells the operator
    to use `PositionClosed`; the fold never reaches `positions.delete`. Chosen over
    silently aliasing an emptying trim to a full close — which would blur two distinct
    material actions (a partial-profit trim vs. a deliberate full exit) in the audit
    log and let a fat-finger quantity retire a position the trader meant to keep. The
    trim's ratified invariant: **the position always survives.**

### Append-only and ADR-001/002, preserved

The fold stays a **pure projection** and lives in `@numisma/engine`; the pure
within-tier removal seam (`splitTierRemoval`), both verb folds, and the partial
closed-book build are all pure. `packages/tui/src/event-store.ts` is **unmodified** —
it dispatches events generically, so both new verbs reach the real ingest/persist path
with zero access-surface change. ADR-002 is respected, not extended: add **appends** a
lot preserving its own entry FX / tier (never weighted-average merged), and trim's
within-tier pro-rata cost basis inherits the FX-P&L deferral verbatim (per-tier
proceeds stay approximate under mixed entry FX; totals exact — carried from #90, not
re-opened). Considered and rejected: **weighted-average lot merging on add** (destroys
the per-lot entry-FX provenance ADR-002 exists to keep) and **a full-retirement trim
aliased to `PositionClosed`** (see the trade-off above).

## Amendment: the derived Head Digest breadcrumb

_Made during: MVI — portable-durable-log increment / 2026-07-03 prototype → AAR → audit →
reliable conversion (the durable log gains a versioned, restorable history in the private
sibling repo `~/Dev/accumulus`; the substrate and the best-effort commit-per-ingest
contract are ratified in ADR-006 — this amendment records the one decision that touches
this ADR's own doctrine)._

The portable-durable-log increment commits a **derived** summary of the folded head — the
**Head Digest** (`head-digest.json`, type `HeadDigest`, produced by `deriveHeadDigest`) —
alongside the log on every ingest. On its face this contradicts this ADR's "Considered
Options," which explicitly **rejected dated full snapshots as source of truth**. It does
not, and the reason is *structural*, not a matter of discipline:

- **The Head Digest is a re-derivable breadcrumb, not stored state.** It carries only
  `fundValueUsd` (sourced from the canonical `buildCompositionReport`, never a side calc),
  open/closed Position counts, the head event id, and the writing-app version — every field
  recomputable from the log by a fold. The rejected "dated full snapshot" was a *replacement*
  for the actions log; the Head Digest is a *pointer into* it.
- **It is overwritten each ingest, not accumulated per period.** The rejected option
  duplicated unchanged `FundReviewData` every review point; the Head Digest is a single file
  rewritten in place, so it never grows into a parallel history of state.
- **It has no read-back validation and — the load-bearing fact — no engine reader.** Nothing
  in `@numisma/engine` folds a Head Digest back into the read model; there is no
  `parseHeadDigest`, no code path that trusts it. **A file no reader consumes cannot become
  a shadow source of truth**, whatever it contains. That is precisely why this ADR's
  snapshot-rejection is *honored*, not contradicted: the fold-over-events remains the only
  truth, and the digest is merely the breadcrumb that makes the search for a bad append
  cheap. Validated on live data — a wrong-but-valid mark's `19760.70 → 22863.31` NAV jump was
  pinned to one commit by `git log -p head-digest.json`, then `git revert` + re-fold restored
  `19760.70`; the fold stayed truth, the digest only made the search a one-liner.

### The anti-drift invariant (named, ADR-cited)

Elevated here from an incidental test assertion to a **named invariant of this ADR**,
analogous to the realized-P&L amendment's blank-the-closed-book lock:

> `deriveHeadDigest(folded).fundValueUsd === buildCompositionReport(folded).totals.fundValueUsd`

The Head Digest's value **must equal the canonical composition report's fund value,
byte-for-byte** — never a rounded, reformatted, or independently computed number. Any change
that inserts a `toFixed` / rounding / side-calculation between the fold and the digest breaks
this invariant and must fail a test (the true anti-drift regression guard fires on a
non-round float, not just on `> 0`). The digest exists to *point at* the Fund's value, so it
must equal it exactly — otherwise the breadcrumb would itself become the plausible-but-wrong
number this increment exists to fight.

### Not a Close, not a checkpoint

The breadcrumb is deliberately named **Head Digest** — not "snapshot" (this ADR's rejected
option, and the glossary's own definition word for **Close**) and not "checkpoint" (a
**Close** alias the glossary bans, `context/ubiquitous-language.md`). The prototype's
`Checkpoint` / `deriveCheckpoint` / `checkpoint.json` names are retired and superseded; see
ADR-006 for the substrate and the glossary's new **Head Digest** row.

### ADR-001/003, preserved

The fold stays a **pure projection** in `@numisma/engine`; `deriveHeadDigest` and
`formatIngestCommitMessage` are pure (no IO), and the write of `head-digest.json` is runtime
IO in `@numisma/tui`. The log stays **append-only** and the atomic temp-and-rename append is
unchanged — the digest is written *after* the append is already durable, and its write
failing is one more best-effort loud-warn (ADR-006's commit contract), so it can never block
or corrupt an append. Considered and rejected here: **giving the digest an engine reader /
a `parseHeadDigest`** (exactly what would turn a breadcrumb into the second source of truth
this ADR rejects) and **accumulating one digest per period** (the dated-snapshot option this
ADR already declined).
