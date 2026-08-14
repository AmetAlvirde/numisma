# A close is the position's last dated event: backdated trims and adds are admitted

_Made during: the post-audit remediation ledger, item **21** — the one item triaged
out of the ledger as a policy question rather than a defect (2026-08-11 triage;
the other nineteen became issues #293–#299 or were dropped). Pinned since the
position-seal increment by `packages/engine/src/position-seal.test.ts:753`,
`describe("case C stays refused as already-closed, deliberately (ledger 21)")` —
a test written to make this relaxation a decision rather than drift._
_Scope: product_
_Status: accepted — decision taken by the fund's operator 2026-08-11. **The
implementation does NOT land with this ADR.** The code today does the opposite,
deliberately and under test; this ADR authorizes the change and names what it
costs. Compare ADR-015, whose implementation shipped with it._

> Line references are given by SYMBOL wherever the symbol survives. Bare line
> numbers are the state at `2bce1d6`, and audit finding 37's standing reminder
> applies: a citation inside a region this decision rewrites goes stale the
> moment the rewrite lands.

## The decision

A **`PositionTrimmed`** or **`PositionAddedTo`** dated **strictly before** the
date on which its target position was closed is **admitted** at ingest. The
guard that refuses them stops asking `closedPositionIds.has(id)` — a membership
test with no date in it — and starts asking whether the verb's own `asOf` falls
on or after the close's: reject when `asOf >= closedAsOf`, admit when
`asOf < closedAsOf`.

**`PositionClosed` and `InvalidationMarked` keep the flat, date-insensitive
refusal they have today.** The relaxation is exactly two verbs wide, and the
reason it stops there is not caution — it is that for those two verbs the
refusal is not an over-rejection at all (below).

No verb is added. No verb is reshaped. `EVENT_SCHEMA_VERSION` stays `2` and no
line of `events.jsonl` needs migration — this decision changes what the gate
admits, not what the log records.

## The decisive argument: the invariant exists, but only one of its two halves is enforced

The rule the position book actually wants is one sentence:

> **A close is the position's last dated event.**

Nothing may be dated after the close, because the fold applies events in
(`asOf`, then log) order and anything dated after a close lands on a position
the close already consumed — it hits `foldEvents`'s `if (closing)` /
`if (trimming)` / `if (adding)` skip. **Corrected in place 2026-08-13 (spec
#323, implementing #293 — closes ledger item 18): those three arms no longer
vanish unobservably.** `foldEvents` now returns a `FoldedReview` —
`{data, skipped}` — and each of the three skip branches this paragraph names
(`PositionClosed`, `PositionTrimmed`, `PositionAddedTo` naming an already-closed
id) is recorded on `skipped` with reason `position-absent`, reported on every
surface a human reads (ADR-020, the Discard Channel). **One sibling verb stays
the accepted, deliberate exception:** `InvalidationMarked` sets no state of its
own to branch on, so it is detected only by a post-loop absence check, and a
mark dated after a seal on an already-closed id is indistinguishable there from
one that landed on a still-open, still-surviving position and so goes
undetected — the honest boundary of "detect by absence," not an oversight.
Anything dated **before** the close, by the same ordering, lands ahead of it
and folds perfectly correctly.

That invariant is reachable from two arrival orders, and today only one of them
is guarded correctly:

- **The close arrives last.** Guarded, exactly, by `requirePositionUntouchedAfter`
  (`crossref.ts:790+`, spec #257 → PR #261) — a close may not date itself behind
  a verb the log has already accepted for that position. This is the seal rule,
  and it is the right shape: it compares dates.
- **The close arrives first.** Guarded by `closedPositionIds.has(...)`, which
  compares **nothing**. It refuses every later-arriving verb regardless of date,
  and so it refuses correctly-dated ones along with the genuinely-late ones.

So the strict half over-shoots and the loose half does not exist. This decision
does not add a rule; it replaces a date-blind proxy with the comparison the
invariant was always about, and the pair then enforces one sentence from both
directions.

That this is the residue of a pre-ADR-015 world is visible in `crossref.ts:939`'s
own comment: under ADR-015 the set "IS the fold's closed book, so this guard now
says out loud what the fold would do anyway." For a **backdated** verb it does
not say what the fold would do — the fold would apply it. The guard was written
when the gate read a shadow that advanced in log order, where "closed" and
"closed before this date" were the same question. Once the gate reads the fold,
they stop being the same question, and only one of them is the right one to ask.

## What the over-rejection costs, in the book's own numbers

Not hypothetical. The pin's `caseC()` is `[Opened 06-05, Closed 06-10, Trimmed
06-08]` on `btc-late` — 1 unit at cost 100 in tier `c1`, trimmed 0.5 out for
proceeds 50 on 06-08, closed for proceeds 100 on 06-10
(`position-seal.test.ts:70-148`).

- **Admitted** (this decision), verified by the pin's second test at `:772`:
  two closed-book rows, `closedAsOf` `["2026-06-08", "2026-06-10"]`; the final
  row is `{ costBasisUsd: 50, proceedsUsd: 100, realizedPnlUsd: 50 }`. The trim
  removed half the basis, so the close books 100 against the 50 that remained.
  **Total realized: 50.**
- **Refused** (today): the trim never enters the log, so the close books 100
  against the **full** basis of 100. One row, at full size, **realized PnL 0.**

The book reports **zero realized profit on a position that made fifty**, and
reports a whole position closed where half of it had been sold two days earlier.
That is a wrong answer, not a confused reader — which is the criterion the ledger
triage used to decide what earns an issue, and it is why item 21 could not simply
be dropped.

The frequency argument is what turns a wrong answer into a decision. **Fills are
recorded by hand.** A trim discovered while reconciling an exchange export two
days after the close is not an exceptional event in this fund's operation; it is
the ordinary shape of hand-recorded history. A rule whose only remedy is
out-of-band log surgery (option A) is the wrong rule for the common case.

## Why exactly two verbs

`closedPositionIds` is consulted at four sites. The relaxation reaches two of
them because at the other two the refusal is not over-strict — a backdated verb
there could not fold correctly either.

| site | verb | backdated, would it fold? | ruling |
| --- | --- | --- | --- |
| `crossref.ts:1025` | `PositionTrimmed` | **Yes** — proven at `position-seal.test.ts:772` | date-sensitive |
| `crossref.ts:1117` | `PositionAddedTo` | **Yes** — same ordering, lots appended before the close consumes them | date-sensitive |
| `crossref.ts:939` | `PositionClosed` | **No** — two closes of one position, whichever sorts first retires it and the other hits `if (closing)` and drops silently. The date does not rescue it; that is MUST FIX 1's shape (ADR-015) | stays flat |
| `crossref.ts:625` | `InvalidationMarked` | **No** — breach is derived only per OPEN position, so a mark on a position the fold retires can never be watched *whatever* its date. `crossref.ts:608-615` already argues this | stays flat |

The asymmetry is not a hedge. `PositionClosed` and `InvalidationMarked` are
refused because the fold has nowhere to put them; `PositionTrimmed` and
`PositionAddedTo` were refused because the guard could not see a date. Only the
second kind is a policy question, and only the second kind moves.

## Considered options

- **Date-sensitive for trim and add-to (CHOSEN).** Costs unbounded retroactive
  mutability of a closed position's derived numbers, and costs the trim gate an
  as-of fold (Consequences). Buys the correct book for the ordinary shape of
  hand-recorded history, and completes an invariant that is currently half-built,
  with no new concept in the model.

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

- **The trim gate needs the world AS OF the trim's date, not merely a relaxed
  comparison. This is the sharpest consequence and the implementation's real
  work.** `EventReference.positionLots` is built from `folded.positions`
  (`crossref.ts:459`) — the fold's **survivors** — so a closed position has **no
  entry at all**. Relax only the membership test and a backdated trim falls
  through to the position-lot-sufficiency gate (`crossref.ts:1054-1063`) with
  `available = 0` and is refused anyway, now with a worse message: *"removes 0.5
  … which holds only 0"* instead of *"already closed."* The gate must instead
  judge the trim against `foldEvents(genesis, accepted.filter(e => e.asOf <
  trim.asOf))` — the world the fold will actually place it in. That is ADR-015's
  own doctrine applied one level deeper: the gate judges against the fold, and
  for a backdated verb the relevant fold is the one at the verb's own date.

- **Implemented naively, the settlement-magnitude gate SILENTLY DISAPPEARS on
  exactly these events.** `crossref.ts:1083-1084` reads
  `held ? reference.lastClose.get(held.instrumentId) : undefined` and then guards
  the whole check on `if (held && last !== undefined)`. With `held` undefined for
  a closed position, the fat-finger check does not fire and does not complain —
  a backdated trim would be admitted with **no** proceeds sanity check while
  every other trim keeps one. The as-of fold fixes this as a side effect (it
  restores `held`), which is a second reason to implement it that way rather than
  patching the comparison. **Any implementation must carry a test that a
  backdated trim with absurd proceeds is still rejected.**

- **`PositionAddedTo` needs only the comparison.** `crossReferenceAddedTo`
  (`crossref.ts:1109-1145`) never reads `positionLots` — it checks the funding
  Reserve's per-tier debit sufficiency and nothing about the position's holdings.
  The two verbs are not symmetric in implementation cost, and the add-to half can
  land first.

- **Retroactivity is UNBOUNDED, and that is the accepted cost.** A trim dated
  06-08 can be appended in 2027 and the closed book's rows will move. A bounded
  variant was considered — refuse if the close is older than N days — and
  **rejected**: it puts a clock inside a pure fold, makes the gate's verdict
  depend on when it was asked rather than on what the log says, and would make
  the same batch admissible on Tuesday and refused on Friday. A book that folds
  to one answer from one log is worth more than a staleness bound.

- **A closed row can change and nothing announces it.** The fold has no
  diagnostics channel (`FundReviewData` carries no warnings field —
  `contracts.ts:43`, issue #293), so a realized-PnL figure the operator has
  already read can move under a later append with no signal. Today the flat
  refusal incidentally prevents this; after this decision it is live. It does not
  block the decision — the alternative is a book that stays *wrong* silently,
  which is worse than a book that becomes *right* silently — but it sharpens
  #293 from a diagnostics nicety into this decision's natural companion, and the
  first thing a fold-warnings channel should report is that an append landed
  behind a close.

- **The pin inverts, and its two halves part company.** In
  `position-seal.test.ts:753`, the first test (`"rejects the backdated trim with
  the already-closed message"`) asserts the behavior this ADR reverses and must
  be rewritten to assert acceptance. The second (`"although that trim would have
  folded correctly — which is why 21 is open"`) needs no change at all: it
  becomes the positive expectation instead of the evidence for the complaint.
  The `describe` block's premise — *deliberately* — is discharged by this
  document. A replacement pin is still owed, aimed at the new boundary: a verb
  dated **on** the close date is refused (the comparison is `>=`, matching the
  seal rule's own strictness at `crossref.ts:819`), and one dated before it is
  admitted.

- **The reserve-balance exposure is pre-existing, not created here.**
  `checkDebit` reads `reference.reserveBalances`, which is the fold of everything
  accepted, so a backdated add-to is sized against the reserve's balance **now**
  rather than at its own date. That gap already exists for every backdated verb
  the gate admits today; this decision widens the population it applies to
  without changing its shape. Named so it is not mistaken for a new hole, and
  left as the follow-up it is.

- **The seal rule is unchanged, and the two rules must be read together.**
  `requirePositionUntouchedAfter` is called from the `PositionClosed` site only,
  which stays correct: `PositionClosed` is the sole retiring verb (a trim that
  would empty the position is already refused as a full retirement,
  `crossref.ts:1073-1080`), so nothing else can seal anything behind it. After
  this decision the pair reads: **a close may not be dated behind an accepted
  verb, and a verb may not be dated on or after an accepted close.** Neither
  sentence is complete without the other, and either one alone is a rule with a
  hole in it.

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
  the risky one. It inverts: the strict gate produces a **wrong realized-PnL
  figure in the closed book** (0 where the fund made 50) and its remedy is
  hand-editing the durable log, while the relaxed gate appends a dated fact and
  lets the fold re-derive — which is what the append-only book already promises.
  Someone meeting `closedPositionIds.has(...)` cold will read it as obviously
  correct, which is exactly why the case-C test was written before this ADR
  existed. The two-verb boundary is equally unguessable: the same guard is right
  at two of its four call sites and wrong at the other two, for reasons that live
  in the fold's arms rather than in the guard.

- **A real trade-off.** Unbounded retroactive mutability of a closed position's
  derived numbers, a closed-book row that can move with nothing announcing it,
  and an as-of fold on the ingest path for backdated trims — bought in exchange
  for the book being able to record what the fund actually did when a fill is
  found late, without editing the log by hand. The alternative on the table was
  not "do nothing": an eleventh verb is a real, principled option that names the
  amendment explicitly, and it was declined only because the log's own ordering
  already carries the fact it would record.
