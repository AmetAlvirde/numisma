# One meaning for the discard vocabulary: a reserve miss discards the whole event

_Made during: PR #382 on `feature/discard-vocabulary-one-meaning`, closing **#371** —
a **ruling request**, filed by the implementer of #366 rather than fixed inside its
scope, on the explicit ground that this changes behavior on an arm that has shipped
that way since before ADR-020 and so wants a ruling rather than a follow-on commit.
The split it names is #366's residue: that PR made `provenance-absent` a total discard
and deliberately left `reserve-absent` alone, saying so in its own body. Sibling
caveat: #367 (the durable-log read path), which shares this one's reachability
argument exactly._
_Scope: product_
_Status: accepted — implementation landed with this ADR (`e87f10d`, `fddc24d`,
`5ed1747`), unlike ADR-017, whose code came later._

> Sites are named by SYMBOL, because this decision rewrote the regions the old line
> numbers pointed at and a branch-local citation goes stale the moment the next one
> lands. Where a file is named without a symbol, the state is `a51d870`.

## The decision

**Every member of `FoldSkipReason` means the same thing about what the fold did: it
read the event and APPLIED NOTHING AT ALL.**

A member names **what was missing** — never how much of the event survived the miss.
There is no partial application anywhere in the vocabulary, so a member added later
**inherits** total discard rather than choosing it. That is now written on the type in
`packages/engine/src/contracts.ts`, where the closed-vocabulary rule already lives, so
the property is load-bearing rather than emergent.

Before this, it was not true. `position-absent` and `provenance-absent` meant *nothing
applied*. `reserve-absent` meant that too on the explicit-tier cash arms — where there
is nothing else in the arm to apply — and meant *everything except the cash* on the
four **lot-derived** arms: a close booked its closed-book row and retired the position,
a trim booked a partial row and mutated the lots, an open registered a position and
seeded its cost anchor, an add grew one. Each against a reserve that never moved.
`packages/engine/src/events/fold.ts` documented the asymmetry deliberately and in
capitals — **`A RESERVE MISS IS NOT A DISCARD`** — and this decision reverses that
in-code ruling on the record.

Three sub-rulings ride in the same increment, and none of them is separable from it:

1. **`applyTieredLeg` returns `false` on a reserve miss**, exactly as it already did
   for `provenance-absent`. It returned `true` before. All four lot-derived arms are
   already written to treat that `false` as *do nothing at all*, so one boolean carries
   the ruling to open funding, close settlement and trim settlement unchanged.
2. **The `PositionAddedTo` arm was RESTRUCTURED, not merely gated.** Its cash leg ran
   **last**, with the return value deliberately ignored, so the lot was appended before
   the debit could drop. Honoring the return where it stood would have changed nothing.
   The leg now runs **first** and gates the append — the same hoist the open arm already
   made. This is safe because `reserveDeltasForOpen([event.lot], …)` reads `event.lot`,
   never `adding.lots`, so the hoist changes nothing an observer can see on the applying
   path; verified by reading and independently confirmed by the review of #382.
3. **`Transfer` joins the ruling: both legs or neither.** Both reserves are pre-flighted
   with `reserves.has()` **before either leg applies**, and a miss applies neither and
   reports **one** record for the event rather than one per leg.

**No reason token was added and none was removed.** `EVENT_SCHEMA_VERSION` is untouched,
no durable line needs migration, and no surface learns a new string. What changed is
what one existing member *means* — which is the whole reason this is an ADR.

## Its relationship to ADR-020: this resolves an inconsistency ADR-020's own rule would have protected

ADR-020 lists among its consequences:

> **The reasons are a closed vocabulary, so they are a compatibility surface.** Adding a
> reason is additive; renaming or removing one moves every reader. **Prefer a new reason
> over widening an existing one's meaning.**

Read literally, that sentence forbids exactly this change. **It does not, and this ADR
is where that is settled** — because the rule guards against a member's meaning being
*widened* to cover new situations, and what happened here is the opposite: a member's
meaning was **narrowed to one**. `reserve-absent` was already carrying two senses, and
the rule as written would have protected the split rather than the readers.

**This ADR does not supersede ADR-020 and does not amend it.** ADR-020 stands whole:
the five clauses, the kind and its reserved capacity, the mapping table, `report, never
refuse`. This is the narrower ruling that the vocabulary ADR-020 closed must also be
**uniform** — that closing a vocabulary buys nothing if its members disagree about what
membership *means*. #371 put that better than a consequence bullet can:

> A closed vocabulary whose members disagree about what membership *means* has lost the
> property that made closing it worth doing.

Read as one pair of rules, ADR-020 governs the **token set** — adding, renaming and
removing are compatibility events — and ADR-021 governs the **semantics behind every
token**, which is not a per-member choice at all. A future reason code is free to name
anything that can be missing; it is not free to decide how much of the event survives.

Two smaller ADR-020 dependencies are also settled here, not merely respected:

- **Clause 3's fixed prose becomes true everywhere it can be raised.** `SKIP_DETAIL`'s
  `reserve-absent` and `provenance-absent` notices now name **the EVENT** rather than
  the leg, and both end by saying nothing moved. That sentence was a **lie** on the
  close arm before — the row and the retirement both moved — which is the sharpest form
  of the defect: a diagnostic that misdescribes the state it is reporting. The
  `reserve-absent` notice also says **"a reserve"** rather than *the* reserve, because a
  `Transfer` names two and either one being absent raises it.
- **Clause 2's `skipped[]` stops over-counting.** The `Transfer` arm's per-leg reporting
  was justified in-code as making an unbalanced state loud; it also put two records on
  one event, which is the channel over-reporting the very thing it exists to report
  exactly once.

## Why the `Transfer` arm's old shape was defensible, and why it still loses

The deleted comment made a real ADR-020 argument: *a Transfer whose destination is
absent still debits the source — cash leaves and never arrives, and reserves are left
quietly unbalanced; that is precisely the state the channel exists to stop being silent
about, so each leg reports for itself.* Every clause in that sentence is true.

It loses on ordering. **Reaching a broken state in order to report it is worse than not
reaching it.** A discard the operator can act on beats a fund that no longer adds up,
and the pre-flight gives both: neither leg applies, and the event is still reported.
The check is deliberately **separate from `applyToReserve`'s own boolean**, which
answers whether a leg *applied* — by the time it can answer for the second leg, the
first has already moved cash. That is why this arm needed a distinct existence test
rather than the return-value discipline the other six call sites use.

## Considered options

#371 posed three, unranked. The first was taken.

- **Split the vocabulary explicitly (rejected).** Encode *total* vs *partial* in the
  type so a reader cannot miss which is which, and so adding a member is forced to
  choose. Honest, and it would have closed the "the next author picks a behavior by
  whichever call site they read first" hole. Rejected because it preserves the thing
  worth deleting: it makes the half-applying sense a **supported, documented mode**,
  permanently doubling every reader's question from *what was missing* to *what was
  missing, and how much survived*. It also permanently entrenches the close arm's
  behavior — realized P&L rising by the full proceeds with no reserve credited — as a
  design rather than a defect.
- **Leave it and document it in `contracts.ts` (rejected).** The cheapest option, and
  genuinely better than the status quo, in which the difference was undocumented. It is
  the option this ADR would have recorded had the ruling gone the other way. Rejected
  because documenting a split that has no reason to exist buys a reader accuracy about
  a hazard instead of removing the hazard, and because it leaves `SKIP_DETAIL`'s "no
  state moved" prose false on the close arm unless that prose is also split per member.
- **Making the reserve miss a total discard for the CASH only, leaving the lot arms
  alone (never seriously on the table, recorded so it is not re-proposed).** This is the
  status quo restated. It is what "the leg was dropped, the rest of the event applied"
  already was.
- **The behavior this decision buys, stated as the cost it is.** A close naming a
  missing reserve **leaves the position OPEN** instead of retiring it, and an add naming
  one **does not grow the position**. The book is then visibly missing a retirement
  rather than quietly carrying an uncredited realization. That is the same trade #366
  accepted for `provenance-absent`, for the same reason: **loud and inspectable beats
  silent and balanced-looking.** On the add arm the argument is stronger still —
  appending the lot and dropping the debit grew a position no reserve paid for, which is
  **NAV invention**, not mere misattribution.

## Consequences

- **The defect this fixes is migration-shaped, not operational — and that is the
  strongest argument AGAINST the change being urgent.** The cross-reference existence
  gate rejects an unknown reserve before the fold ever runs, so on the gated path none
  of the old behavior is reachable at all. It is reachable only through callers that
  fold the durable log directly, bypassing both gates — `loadFoldedReview` in
  `packages/event-store/src/event-store.ts`. This ADR records that plainly rather than
  burying it: **the ruling was taken on the inconsistency, not on the defect.** The
  defect is what made the inconsistency legible; it is not what made it worth fixing.
  #367 carries the identical caveat and is not resolved here.
- **No single event can now produce two skip records within one fold.** Nobody asked for
  this; it fell out of `Transfer`'s pre-flight. Inside one fold, `skipped.length` and
  `discardedEventCount` now agree **by construction**. It is pinned by a test that
  reddens if the `Transfer` arm ever goes back to reporting per leg.
- **It invalidated an event-store fixture, which was repaired rather than weakened.**
  The digest/verdict parity test separated `deriveHeadDigest`'s deduped count from a raw
  `skipped.length` using one `Transfer` with both legs ghosted — a shape this decision
  made unreachable. The replacement builds the same divergence the way real callers do:
  a fold, then a re-fold of the same log grown by one event. Three records, two dropped
  events, both surfaces must say two.
- **`dedupeFoldSkips` is NOT made vestigial by that, and the reasoning is the reverse of
  what it looks like.** Re-folding is now the *only* source of a repeat, and re-folding
  is structural: the ingest walk re-folds the whole log once per accepted event
  (**ADR-015**) — see `packages/engine/src/events/ingest-walk.ts` — and the backfill
  re-folds once per anchor, each concatenating the folds' `skipped` and handing the
  union on. One standing drop still arrives N times, where N is an artifact of the
  caller's loop rather than anything about the log.
- **The dedup key stays the PAIR (`eventId`, `reason`), deliberately, even though an
  id-only key would dedupe today's logs identically.** One-record-per-event is a
  decision each arm makes in the open — `applyTieredLeg`'s precedence of
  `provenance-absent` over `reserve-absent`, the `Transfer` arm's pre-flight — not a
  property the key may assume on their behalf. Keyed on the pair, breaking that decision
  is **loud** (two findings, two lines) rather than invisible.
- **A ninth `applyToReserve` call site inherits "one record per EVENT", not "one record
  per call."** Any arm that calls it more than once for a single event must settle
  existence up front the way `Transfer` does. The cost of getting it wrong is stated at
  the function: two `reserve-absent` records for one event both survive the pair dedup,
  inflating `discardedEventCount` and printing two operator lines for a single drop.
- **Test helpers changed shape, which is a signal and not incidental.** The helpers
  defaulted their cash legs to a reserve the genesis did not hold, precisely *because*
  the leg no-opped and position-focused tests could ignore it. Under this ruling that
  default drops the very events those tests are about, so `emptyGenesis` gained a funded
  desk reserve. **The old behavior was load-bearing in the fixtures before anyone
  noticed it was load-bearing in the fold.**
- **Coverage moved in one direction worth recording.** The `Transfer` arm's
  `reserve-absent` skip is no longer uncovered — two per-leg failure branches collapsed
  into one pre-flight the both-legs-or-neither tests reach directly. The `Withdraw` arm
  is now the only `reserve-absent` record in `fold.ts` no test exercises.

### The three SDP tests

- **Hard to reverse.** Weakest of the three in code terms and strongest in contract
  terms, and the distinction is the point. Reverting is a boolean, a hoist and a
  pre-flight — an afternoon. What cannot be reverted cheaply is the **published
  meaning**: `FoldSkipReason` is ADR-020's compatibility surface, and uniformity is now
  the property the type's own doc comment promises, that `SKIP_DETAIL`'s fixed prose is
  written against at every raising site, that `discardedEventCount`'s name relies on
  within a fold, and that a future member silently inherits. A reversal re-splits all of
  those at once, and each of them re-buys a half-application that reads as correct at
  the call site that does it.
- **Surprising without context.** In both directions, and one of them is a reversal.
  *Why does a missing reserve leave a closed position open in the book?* is unanswerable
  from the arm alone. And a reader who finds `A RESERVE MISS IS NOT A DISCARD` in this
  repo's history — capitalized, reasoned, and correct as written — needs to be told
  that it was overturned on purpose and by what argument, or they will restore it as a
  regression.
- **A real trade-off.** The change makes the fold's output **less complete on purpose**:
  a close that would have produced a realized row now produces none, and a position that
  would have retired stays open, on an event the fold could have applied 90% of. The
  losing side is not a strawman — a partially-applied close is closer to the operator's
  intent than a dropped one, and someone reading only the closed book will see a gap
  where they expected a row. This decision pays that completeness for **one meaning per
  reason code** and for a diagnostic whose "No state moved." is true wherever it is
  printed.
