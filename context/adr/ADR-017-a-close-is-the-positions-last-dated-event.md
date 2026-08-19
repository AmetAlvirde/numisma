# A close is the position's last dated event: backdated trims and adds are admitted

_Made during: the post-audit remediation ledger, item **21** — the one item triaged
out of the ledger as a policy question rather than a defect (2026-08-11 triage;
the other nineteen became issues #293–#299 or were dropped). Pinned since the
position-seal increment by `packages/engine/src/position-seal.test.ts`,
`describe("case C stays refused as already-closed, deliberately (ledger 21)")` —
a test written to make this relaxation a decision rather than drift. That pin now
reads `describe("case C is admitted, the backdated trim ADR-017 relaxed")`:
inverted in place, same batch, only the expected answer moved._
_Scope: product_
_Status: accepted — decision taken by the fund's operator 2026-08-11 and merged as
the ADR alone (PR #301). **The implementation landed later, in PR #341, merged
2026-08-14** (`e282b25` the add-to half, `ff50da5` the trim's red test and the
as-of world contract, `ec71936` the trim half, `fa41693` the same-dated prefix
fix). This document is written in post-landing tense throughout; where it says the
gate does something, the gate does it today. ADR-021 names this ADR as its
counterexample — code shipping with the decision versus code shipping after it —
and that remains the accurate reading of these two merges._

> Sites are named by SYMBOL, the practice ADR-004 records and the one ADR-021
> restated: this decision rewrote the regions the drafting-time line numbers
> pointed at, and every bare number in the 2026-08-11 draft had gone stale by the
> time the code merged. Where a file is named without a symbol, the state is
> `357ff20`.

## The decision

A **`PositionTrimmed`** or **`PositionAddedTo`** dated **strictly before** the
date on which its target position was closed is **admitted** at ingest. The
guard that refused them no longer asks `closedPositionIds.has(id)` — a membership
test with no date in it — and asks instead whether the verb's own `asOf` falls
on or after the close's: reject when `asOf >= closedAsOf`, admit when
`asOf < closedAsOf`. The dated answer is carried by
`EventReference.closedPositionAsOf`, and `closedPositionIds` is now built **from**
that map, so the membership answer and the dated answer cannot drift apart.

**`PositionClosed` and `InvalidationMarked` keep the flat, date-insensitive
refusal they had.** The relaxation is exactly two verbs wide, and the reason it
stops there is not caution — it is that for those two verbs the refusal is not an
over-rejection at all (below).

No verb was added. No verb was reshaped. `EVENT_SCHEMA_VERSION` stayed `2` and no
line of `events.jsonl` needed migration — this decision changed what the gate
admits, not what the log records.

## The decisive argument: the invariant existed, but only one of its two halves was enforced

The rule the position book actually wants is one sentence:

> **A close is the position's last dated event.**

Nothing may be dated after the close, because the fold applies events in
(`asOf`, then log) order and anything dated after a close lands on a position
the close already consumed — it hits `foldEvents`'s `if (closing)` /
`if (trimming)` / `if (adding)` skip. **Corrected in place 2026-08-13 (spec
#323, implementing #293 — closes ledger item 18): those three arms no longer
vanish unobservably.** `foldEvents` returns a `FoldedReview` — `{data, skipped}`
(`contracts.ts`) — and each of the three skip branches this paragraph names
(`PositionClosed`, `PositionTrimmed`, `PositionAddedTo` naming an already-closed
id) is recorded on `skipped` with reason `position-absent`, reported on every
surface a human reads (ADR-020, the Discard Channel). **The sibling verb this
paragraph once excepted is no longer excepted, and the exception shrank to a
tie:** `InvalidationMarked` sets no state of its own to branch on, so it is
detected only by a post-loop absence check — but since #297 (`2bd9b7a`) that
check dates the mark against the retirement date rather than treating membership
in the closed book as innocence, and reports a mark dated **strictly after** the
close. What survives is one same-date tie and one superseded-mark case, both named
and accepted in `fold.ts`'s own comment at the detect-by-absence pass. Anything
dated **before** the close, by the same ordering, lands ahead of it and folds
perfectly correctly.

That invariant is reachable from two arrival orders, and before this decision only
one of them was guarded correctly:

- **The close arrives last.** Guarded, exactly, by `requirePositionUntouchedAfter`
  (`crossref.ts`, spec #257 → PR #261) — a close may not date itself behind
  a verb the log has already accepted for that position. This is the seal rule,
  and it is the right shape: it compares dates.
- **The close arrives first.** Guarded by `closedPositionIds.has(...)`, which
  compared **nothing**. It refused every later-arriving verb regardless of date,
  and so it refused correctly-dated ones along with the genuinely-late ones.

So the strict half over-shot and the loose half did not exist. This decision did
not add a rule; it replaced a date-blind proxy with the comparison the invariant
was always about, and the pair now enforces one sentence from both directions.

That this was the residue of a pre-ADR-015 world is visible in
`crossReferenceClose`'s own comment: under ADR-015 the set "IS the fold's closed
book, so this guard now says out loud what the fold would do anyway." For a
**backdated** verb it did not say what the fold would do — the fold would apply
it. The guard was written when the gate read a shadow that advanced in log order,
where "closed" and "closed before this date" were the same question. Once the gate
reads the fold, they stop being the same question, and only one of them is the
right one to ask.

## What the over-rejection cost, in the book's own numbers

Not hypothetical. The pin's `caseC()` is `[Opened 06-05, Closed 06-10, Trimmed
06-08]` on `btc-late` — 1 unit at cost 100 in tier `c1`, trimmed 0.5 out for
proceeds 50 on 06-08, closed for proceeds 100 on 06-10 (the `openLate` /
`trimPayload` / `closePayload` fixtures in `position-seal.test.ts`).

- **Admitted** (this decision, landed), verified by the pin's second test,
  `it("and the book it folds to is the one that argued for admitting it")`:
  two closed-book rows, `closedAsOf` `["2026-06-08", "2026-06-10"]`; the final
  row is `{ costBasisUsd: 50, proceedsUsd: 100, realizedPnlUsd: 50 }`. The trim
  removed half the basis, so the close books 100 against the 50 that remained.
  **Total realized: 50.**
- **Refused** (the behavior this replaced): the trim never entered the log, so
  the close booked 100 against the **full** basis of 100. One row, at full size,
  **realized PnL 0.**

The book reported **zero realized profit on a position that made fifty**, and
reported a whole position closed where half of it had been sold two days earlier.
That is a wrong answer, not a confused reader — which is the criterion the ledger
triage used to decide what earns an issue, and it is why item 21 could not simply
be dropped.

The frequency argument is what turned a wrong answer into a decision. **Fills are
recorded by hand.** A trim discovered while reconciling an exchange export two
days after the close is not an exceptional event in this fund's operation; it is
the ordinary shape of hand-recorded history. A rule whose only remedy is
out-of-band log surgery (option A) is the wrong rule for the common case.

## Why exactly two verbs

`closedPositionIds` is consulted at four sites. The relaxation reached two of
them because at the other two the refusal is not over-strict — a backdated verb
there could not fold correctly either.

| site | verb | backdated, would it fold? | ruling |
| --- | --- | --- | --- |
| `crossReferenceTrim` | `PositionTrimmed` | **Yes** — proven by `describe("case C is admitted, the backdated trim ADR-017 relaxed")` in `position-seal.test.ts` | date-sensitive; reads `closedPositionAsOf` |
| `crossReferenceAddedTo` | `PositionAddedTo` | **Yes** — same ordering, lots appended before the close consumes them | date-sensitive; reads `closedPositionAsOf` |
| `crossReferenceClose` | `PositionClosed` | **No** — two closes of one position, whichever sorts first retires it and the other hits `if (closing)` and drops silently. The date does not rescue it; that is MUST FIX 1's shape (ADR-015) | stays flat; reads `closedPositionIds` |
| `crossReferenceInvalidation` | `InvalidationMarked` | **No** — breach is derived only per OPEN position, so a mark on a position the fold retires can never be watched *whatever* its date. `crossReferenceInvalidation`'s own docblock, and the `closedPositionIds` field comment, already argue this | stays flat; reads `closedPositionIds` |

The asymmetry is not a hedge. `PositionClosed` and `InvalidationMarked` are
refused because the fold has nowhere to put them; `PositionTrimmed` and
`PositionAddedTo` were refused because the guard could not see a date. Only the
second kind was a policy question, and only the second kind moved.

## The boundary is `>=`, and the two rules deliberately DISAGREE on equality

This is the part the drafting-time text got wrong, and the reason three comments
elsewhere in the tree cited a line that contains no comparison at all (#379). The
verified state, all of it in `crossref.ts`:

- **`requirePositionUntouchedAfter` ACCEPTS equality.** It returns success on
  `asOf >= latest.asOf` and rejects only on strict `<`. A close dated on the same
  day as an already-accepted trim is admitted. Pinned by
  `it("case 1 — accepts a same-day trim-then-close, and folds BOTH legs")`, whose
  load-bearing assertion is `costBasisUsd: 50` — proof the close ran on lots the
  trim had already reduced, not merely that the batch passed.
- **`crossReferenceTrim` and `crossReferenceAddedTo` REFUSE equality.** Both
  reject on `event.asOf >= retiredAsOf`. A trim or add dated on the close date is
  refused. Pinned by `describe("ADR-017 — the trim boundary")` and
  `describe("ADR-017 — the boundary")` in the two `position-backdated-*.test.ts`
  files.
- **`worldAsOf`'s prefix INCLUDES equality.** It folds
  `priorEvents.filter((event) => event.asOf <= asOf)`, so a same-dated sibling
  already in the log is part of the world a backdated trim is judged against
  (`fa41693`).

So the two guards give **opposite answers on the close date**, and that is
correct rather than a disagreement to reconcile. The date is not what decides at
equality — the **log index** is. `foldEvents` orders by (`asOf`, **then log
index**), so among same-dated events the one appended later applies later:

- trim logged, then close, both 06-10 → the fold applies the trim first and the
  close lands on reduced lots. It folds. The seal rule admits it.
- close logged, then trim, both 06-10 → the fold applies the close first and the
  trim lands on an id the close already consumed. It cannot fold. The dated guard
  refuses it.

Each site therefore takes the reading that matches what the fold will actually
do, and the gate admits exactly the arrangements that fold. The batch's verdict
**does** depend on which of the pair the log received first — that is not a flaw
to be designed away, it is the fold's own tie-break showing through the gate, and
a gate that hid it would be admitting events the fold silently drops, which is
the whole class ADR-015 exists to eliminate.

The same tie-break governs one more site, and it is the honest edge of the rule:
`fold.ts`'s detect-by-absence pass reports an `InvalidationMarked` dated
**strictly after** its position's retirement and stays silent on a mark dated
**on** it, because the closed book does not carry the close's log index and the
tie is undecidable from what that pass holds (#297's named residual, deliberately
not widened).

## Considered options

- **Date-sensitive for trim and add-to (CHOSEN).** Costs unbounded retroactive
  mutability of a closed position's derived numbers, and costs the trim gate an
  as-of fold (Consequences). Buys the correct book for the ordinary shape of
  hand-recorded history, and completes an invariant that was half-built, with no
  new concept in the model.

- **Keep the refusal; the remedy is out-of-band — REJECTED.** The status quo,
  stated honestly rather than left implicit: with no correction verb in the
  model, the operator's only recourse is hand-editing `events.jsonl` — and
  `migrate-legacy-log.ts` (issue #294) is the one tool that rewrites the durable
  log. Rejected because it makes the *append-only* log's integrity depend on the
  operator editing it by hand, which is a strictly worse guarantee than admitting
  a dated append. It also leaves no trace: a hand edit is invisible to the log's
  own history in a way an appended event is not.

- **An eleventh verb, a correction event — REJECTED, and the closest call.** A
  `PositionAmended`-shaped verb would name the retroactive edit as a first-class
  fact, which is genuinely attractive: ADR-013 rejected `Order*` verbs precisely
  to keep inferences out of the record of fact, and one could argue an amendment
  deserves to be recorded rather than inferred. Rejected because **the log
  already records it, structurally.** An event whose log index falls after the
  close but whose `asOf` falls before it **is** the correction — self-evident
  from the two fields, greppable, requiring no new concept. A new verb would buy
  an audit trail the file's own ordering already carries, at ADR-012's price:
  schema work, every reader taught the verb, the hosted projection's allow-lists
  reopened (ADR-007). This option is the recorded fallback if the amendment ever
  needs to carry something the trim itself cannot express — an operator's reason,
  or an explicit supersedes-pointer.

- **Re-open and re-close — REJECTED.** Expressible today with zero new concepts,
  and the worst of the four. A close retires the id and a reopen mints a fresh
  one, so the 06-08 trim cannot attach to the position it belongs to; it lands on
  a new position instead. The closed book then shows two positions where the fund
  held one, which corrupts the very rows the correction was meant to fix.

## Consequences

- **The trim gate needed the world AS OF the trim's date, not merely a relaxed
  comparison. This was the sharpest consequence and the implementation's real
  work, and it landed as `EventReference.worldAsOf`.**
  `EventReference.positionLots` is built from `folded.positions` — the fold's
  **survivors** — so a closed position has **no entry at all**. Relaxing only the
  membership test would have dropped a backdated trim into the
  position-lot-sufficiency gate with `available = 0`, refused anyway, now with a
  worse message: *"removes 0.5 … which holds only 0"* instead of *"already
  closed."* `crossReferenceTrim` therefore judges the remaining gates against
  `reference.worldAsOf(event.asOf)` — the world the fold will actually place the
  trim in. That is ADR-015's own doctrine applied one level deeper: the gate
  judges against the fold, and for a backdated verb the relevant fold is the one
  at the verb's own date. It is **lazy**: only a trim whose target is already
  retired asks for it, so every ordinary trim, mark and close pays one closure
  allocation and no fold.

- **Implemented naively, the settlement-magnitude gate would have SILENTLY
  DISAPPEARED on exactly these events.** `crossReferenceTrim`'s magnitude check
  reads `held ? world.lastClose.get(held.instrumentId) : undefined` and then
  guards on `if (held && last !== undefined)`. With `held` undefined for a closed
  position, the fat-finger check does not fire and does not complain — a
  backdated trim would be admitted with **no** proceeds sanity check while every
  other trim keeps one. The as-of fold fixes this as a side effect (it restores
  `held`), which is the second reason it was implemented that way rather than by
  patching the comparison. The required pin landed with it: the
  `position-backdated-trim.test.ts` suites that hold the sufficiency gate to
  *"which holds only 1"* rather than *"holds only 0"*, and the magnitude gate to
  firing on a backdated trim with absurd proceeds.

- **`PositionAddedTo` needed only the comparison.** `crossReferenceAddedTo` never
  reads `positionLots` — it checks the funding Reserve's per-tier debit
  sufficiency and nothing about the position's holdings. The two verbs were not
  symmetric in implementation cost, and the add-to half landed first (`e282b25`,
  ahead of the trim's `ec71936` in the same PR).

- **Retroactivity is UNBOUNDED, and that is the accepted cost.** A trim dated
  06-08 can be appended in 2027 and the closed book's rows will move. A bounded
  variant was considered — refuse if the close is older than N days — and
  **rejected**: it puts a clock inside a pure fold, makes the gate's verdict
  depend on when it was asked rather than on what the log says, and would make
  the same batch admissible on Tuesday and refused on Friday. A book that folds
  to one answer from one log is worth more than a staleness bound.

- **A closed row can change and nothing announces it — still true, and the
  Discard Channel does not close it.** `FundReviewData` carries no warnings field
  (`contracts.ts`), and ADR-020's channel reports what the fold **discarded**; an
  admitted backdated trim is discarded by nothing, so it produces no record. A
  realized-PnL figure the operator has already read can move under a later append
  with no signal. It did not block the decision — the alternative is a book that
  stays *wrong* silently, which is worse than a book that becomes *right*
  silently — and the natural companion it sharpened, #293, has since closed as
  the Discard Channel without covering this case. Announcing an append that
  landed behind a close remains unbuilt.

- **The reserve-balance exposure is pre-existing, not created here.**
  `checkDebit` reads `reference.reserveBalances`, which is the fold of everything
  accepted, so a backdated add-to is sized against the reserve's balance **now**
  rather than at its own date. That gap already existed for every backdated verb
  the gate admitted before this decision; the decision widened the population it
  applies to without changing its shape. Named so it is not mistaken for a new
  hole, and left as the follow-up it is. `worldAsOf` returns a full
  `EventReference` rather than a fragment precisely so that follow-up has the
  whole world to ask.

- **The pin inverted, and its two halves parted company as predicted.** In
  `position-seal.test.ts`, `describe("case C stays refused as already-closed,
  deliberately (ledger 21)")` became `describe("case C is admitted, the backdated
  trim ADR-017 relaxed")`; the first test was rewritten to assert acceptance, and
  the second — *"although that trim would have folded correctly — which is why 21
  is open"* — needed no change at all beyond its name: it is now
  `it("and the book it folds to is the one that argued for admitting it")`, the
  positive expectation instead of the evidence for the complaint. The `describe`
  block's premise — *deliberately* — is discharged by this document. **The owed
  replacement pin landed** in the two `position-backdated-*.test.ts` files: a
  verb dated **on** the close date is refused, one dated before it is admitted.

- **The seal rule is unchanged, and the two rules must be read together.**
  `requirePositionUntouchedAfter` is called from `crossReferenceClose` only, which
  stays correct: `PositionClosed` is the sole retiring verb (a trim that would
  empty the position is already refused as a full retirement, in
  `crossReferenceTrim`), so nothing else can seal anything behind it. The pair now
  reads: **a close may not be dated behind an accepted verb, and a verb may not be
  dated on or after an accepted close.** Neither sentence is complete without the
  other, either one alone is a rule with a hole in it, and — see the boundary
  section — they deliberately answer differently on the close date itself.

## The three SDP tests

- **Hard to reverse.** Not the code — the code is a comparison and a fold. What
  is hard to reverse is the **log**. Once a backdated trim is durably appended
  behind a close, un-deciding this means refusing to fold a log that already
  contains events the gate would no longer admit, and the read path
  (`foldEvents`, feeding the TUI, the hosted push and the daily price-feed job)
  cannot refuse them without turning an ingest-time policy change into a total
  dashboard outage — the same reason ADR-015 declined to fix the birth-side hole
  at the fold. Reversal therefore costs a migration of an append-only artifact,
  and it gets more expensive with every correction the operator records.

- **Surprising without context.** The intuitive read is that refusing to touch a
  closed position is the *conservative* choice and admitting backdated edits is
  the risky one. It inverts: the strict gate produced a **wrong realized-PnL
  figure in the closed book** (0 where the fund made 50) and its remedy was
  hand-editing the durable log, while the relaxed gate appends a dated fact and
  lets the fold re-derive — which is what the append-only book already promises.
  Someone meeting `closedPositionIds.has(...)` cold will read it as obviously
  correct, which is exactly why the case-C test was written before this ADR
  existed. The two-verb boundary is equally unguessable: the same guard is right
  at two of its four call sites and wrong at the other two, for reasons that live
  in the fold's arms rather than in the guard. And the `>=` boundary is
  unguessable a third time: two rules named as one sentence give opposite answers
  on the same date, because the tie-break at equality is the log index and not
  the date at all.

- **A real trade-off.** Unbounded retroactive mutability of a closed position's
  derived numbers, a closed-book row that can move with nothing announcing it,
  and an as-of fold on the ingest path for backdated trims — bought in exchange
  for the book being able to record what the fund actually did when a fill is
  found late, without editing the log by hand. The alternative on the table was
  not "do nothing": an eleventh verb is a real, principled option that names the
  amendment explicitly, and it was declined only because the log's own ordering
  already carries the fact it would record.
