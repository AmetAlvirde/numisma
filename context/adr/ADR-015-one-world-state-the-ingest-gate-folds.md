# One world-state: the ingest gate folds, and the shadow reference is deleted

_Made during: MVI — whole-repo codebase review, 2026-08-07 (audit MUST FIX `1`,
OPPORTUNITY `31` and `32`, ADR flag `A`) → the audit-remediation roadmap's §5
decision `A`, approved 2026-08-07 contingent on a re-fold measurement, which was
taken 2026-08-07 and PASSED. Behavior lands with roadmap item **A4** (engine:
unify the gate's world-state onto the fold), after **A1** (the second-close guard
+ the strengthened shadow/fold agreement test), which is forward-compatible with
this decision and shipped regardless._
_Scope: product_
_Status: accepted — decision taken by the fund's operator 2026-08-08; the
implementation lands with this ADR._

> Line references below are given by SYMBOL wherever the symbol survives.
> Where a line number is quoted it is the state **as of the 2026-08-07 audit
> commit**, before this decision's own rewrite moved it — audit finding 37 is a
> standing reminder that citations inside a rewritten region go stale the moment
> the rewrite lands.

The second ingest gate — `crossReferenceEvent`, the guard that runs after
`parseEvent` and decides whether a structurally-sound event is admissible against
the known world — reads its world-state from **`foldEvents(genesis,
acceptedSoFar)`**. The incrementally-maintained shadow projection it read before
(`EventReference`, advanced by `applyEventToReference`) is **deleted**, and
`applyEventToReference` leaves the engine's public surface.

This ADR argues **exactly one thing**: that the gate and the fold must compute
world-state **once**, in one encoding. It does not decide the gate's rejection
messages, does not decide the shape of what the gate reads out of the folded
book, and does not by itself add or remove a single rejection rule.

## The decisive argument: the divergence class becomes unrepresentable

Before this decision, `packages/engine/src/events/crossref.ts` held two things
that change for different reasons. Above the `:382`/`:384` seam a projection
maintained a shadow world — position ids, reserve balances, per-instrument
last-close, position lots — advancing it one accepted event at a time. Below the
seam a gate read that shadow and returned an `EventParseResult`. The projection's
per-verb transitions were a **second implementation** of the fold's own
transitions (`foldEvents`'s switch in `events/fold.ts`): trim splitting, lot
appending, reserve crediting, all re-encoded. Nothing enforced that the two
agreed.

**They already disagreed, and the disagreement corrupted NAV.** MUST FIX 1: the
fold consumes a position on close, the shadow did not, so a re-authored second
`PositionClosed` with a fresh id passed the gate — the shadow still showed the
position open — and then silently vanished at fold (`foldEvents`'s
`PositionClosed` arm applies the cash leg only `if (closing)`), surfacing as the
composition report's `warnings: []`. [Precision note, 2026-08-08: read the
`warnings` here as the report's, not the fold's. `foldEvents` returns
`FundReviewData`, which has NO warnings field — the only `warnings` in
`contracts.ts` is on `CompositionReport` (`:487`). The fold has no diagnostics
channel to warn on at all; that is ledger item 18, still open, and it is why
every rule of this class has to sit at ingest.] On the repo's own `cash-settlement.fixtures.ts` the shadow reached `amount
3100 / c1 1400 / c2 1700` where the fold produced `amount 2300 / c1 1200 / c2
1100`, and the divergence then compounded through a `Withdraw` of the phantom
balance into a negative reserve lot, a dropped tier rollup, and NAV low by the
difference under one warning that named neither cause.

The point of this ADR is **not** that bug — A1 fixed it with a
`closedPositionIds` check, the pattern that already existed twice in the same
file. The point is the **class**. Under a repaired shadow, correctness rests on a
hand-written guard suite staying complete: the next verb, or the next transition,
is one forgotten guard away from the same shape of failure, and the failure mode
is silent. Under the fold, the gate asks the real book whether there is an open
position to close, finds none, and rejects — **rejection falls out of the fold's
own semantics.** Every future verb inherits that property for free, without
anyone writing a guard for it.

Stated as the line itself:

> **A gate that judges against a second model of the world can only be as correct
> as that model's fidelity. A gate that judges against the fold cannot be wrong
> about the world the fold will produce.**

## The measurement this decision was contingent on

Approval was explicitly conditional: the audit's own words were _"inbox batches
are small; measure before committing."_ The measurement was taken, the decision
shipped on it — **and the measurement was wrong.** Both the history and the
corrected numbers are recorded here, because the way it was wrong is the
instructive part.

### What the original spike measured, and why it certified a quadratic fold

Spiked 2026-08-07 on synthetic logs **modeled on the repo's fixtures**, Node 24.
It reported `foldEvents` as **linear at ≈0.1 ms per 1k log events** (L=1k → 0.13
ms; L=100k → 10.0 ms), and a 50-event batch not crossing one second until L ≈ 200k
— "decades away."

The fixtures are almost mark-free. **The durable log is 98.5% `PriceMarked`.** The
fold's `PriceMarked` arm resolved its same-day close by scanning `closes[]`, an
array that grows one entry per mark — so the fold was **O(marks²)**, and the
fixture-shaped log had too few marks for that term to appear at all. The spike
measured a shape the ingest path never sees, pronounced the fold linear, and this
ADR then multiplied that per-event cost by the batch size (n+1 folds) on the
strength of it. Re-measured on the real shape, the "decades away" second was
**thirteen months** away.

Two lessons, recorded rather than quietly fixed: a synthetic log must be modeled
on the **log**, not on the fixtures; and an ADR that puts an O(n) claim on the
critical path owes that claim a benchmark in the dominant event's own dimension.

### The corrected measurement

The scan is now a `Map` keyed `instrumentId|asOf`, maintained alongside the
unchanged `closes[]` output, so the fold is linear in marks. Re-measured on a
**mark-heavy synthetic log** — 13 instruments, ~98.5% `PriceMarked`, a 13-mark
ingest batch with the per-accept rebuild this ADR mandates (n+1 = 14 folds), Node
24, 2026-08-08:

| L (log events) | bare fold, before | bare fold, after | 13-mark batch, before | 13-mark batch, after |
| -------------- | ----------------- | ---------------- | --------------------- | -------------------- |
| 388 (today)    | 1.5 ms            | 0.7 ms           | **12 ms**             | **3 ms**             |
| 2,500          | 30 ms             | 0.9 ms           | 201 ms                | 14 ms                |
| 5,000          | 56 ms             | 1.7 ms           | 770 ms                | 26 ms                |
| 10,000         | 215 ms            | 3.8 ms           | 3.0 s                 | 52 ms                |
| 50,000         | 5.5 s             | 19 ms            | **82 s**              | **284 ms**           |

The before column is the shape the decision actually shipped with: ≈1 s per ingest
at L ≈ 5–6k, which the log reaches in about thirteen months at ≈4.7k events/year —
not decades. After the fix the batch is linear (14 × the bare fold, as the model
says it should be) and a **50k-event log costs 284 ms per ingest**, so the one
second this ADR treats as the pain threshold is not reached until L well past
100k — now genuinely decades out at the observed growth rate.

The cost is also **not new**. `ingestInbox` already ran one full-log
`foldEvents(genesis, [...existing, ...toAppend])` on every ingest that appends.
Unification turns 1 fold into n+1 folds of a cost the path already pays.

**Caveat, recorded deliberately:** these measure **bare `foldEvents` only** —
which is exactly what the gate reads, since the gate needs balances, positions and
last-close anchors, all of which the fold's own output carries. If an
implementation ever needs the `compose/*` pipeline per event rather than the raw
fold, this envelope does not apply and the measurement must be retaken before the
loop ships. Re-measure, on a mark-heavy log, if the accepted log approaches
L ≈ 100k.

## Considered options

- **Unification — the gate reads `foldEvents(genesis, acceptedSoFar)`, the shadow
  is deleted (CHOSEN).** Costs a re-fold per batch event, within the envelope
  above, and removes `applyEventToReference` from the public surface. Buys the
  divergence class becoming unrepresentable, and buys it for every future verb
  rather than for the ten that exist.
- **Extraction only — split `crossref.ts` at the `:382`/`:384` seam into
  `events/reference.ts` (projection) plus the gate — REJECTED, and recorded as the
  fallback.** The seam was genuinely clean: nothing below `:382` mutated the
  reference, nothing above `:384` returned an `EventParseResult`, and a 20-line
  docblock already paid the prose cost of explaining the two orderings. It was a
  cheap, reversible refactor that would have left 1003 lines readable. It was
  rejected because it **preserves the class**: the two encodings still exist, they
  still change for different reasons, and their agreement is defended only by A1's
  strengthened agreement test — one hand-built batch through both encodings
  (finding 32). A test can only fail on a case someone thought to write. This
  option was the recorded fallback had the measurement failed; it did not, so
  finding 31 lands as unification instead of extraction. Either way finding 31
  lands — nothing is deferred by this choice.
- **Repair the shadow and stop there — REJECTED.** This is what A1 alone is, and
  A1 shipped regardless because the MUST FIX could not wait on an architecture
  decision. But it fixes one instance of the class and leaves the class.

## Consequences

- **`applyEventToReference` is removed from the public surface, and the removal is
  wider than a barrel edit.** At the time of the audit it had three live runtime
  callers, each advancing a shadow for its own walk. Roadmap item D1 had since
  lifted two of them into one shared engine module, so the implementation
  reworked:
  - **`events/ingest-walk.ts`'s `walkPendingInbox`** — the ONE walk, consumed by
    both the TUI spine's `ingestInbox` and `@numisma/price-feed`'s fetch-time
    rejection pre-check. It now takes the world as **inputs** (a new
    `IngestWalkWorld`: genesis plus the already-committed events) instead of a
    pre-built reference, rebuilds the gate's view from genesis plus the accepted
    prefix on each accept, and **returns** the world it ended in as
    `result.reference`. There is nothing left to advance in place.
  - **`apps/tui/src/event-store.ts`'s `migrateLegacyLog`** — the sharpest of the
    three, because it folds a log that is mid-migration and "`acceptedSoFar`"
    needed deciding at implementation time. **Resolved: it is the `migrated`
    accumulator** — the prefix of the OUTPUT image, not of the input file. Every
    line before the current one has already been repaired into its v2 shape and
    cleared the gate, and `migrated` is exactly the log that would exist if the
    migration stopped there, so `foldEvents(genesis, migrated)` asks the spine's
    own question of the log the rewrite is building. A legacy line's
    pre-migration shape never enters the world — it could not, it does not parse
    — which is why the walk had to be re-pointed at the accumulator rather than at
    the file being read. The cost is O(n²) folds — n lines, each folding the prefix
    before it — over a one-shot, operator-initiated rewrite. Measured on the same
    mark-heavy log, 2026-08-08: **1k lines 215 ms, 4k lines 2.8 s** (before the
    fold's linearity fix: 883 ms and 53 s — the migration was O(n²) folds of an
    O(n²) fold, which is where the fixture-shaped envelope hid the most). The
    quadratic term is inherent to walking prefixes and stays; at these magnitudes it
    is a price worth paying to judge each line against the real book. If the log
    ever grows to where that bites, fold incrementally there rather than
    reintroducing a shadow.

  Five engine test files imported `applyEventToReference` and were re-pointed
  mechanically to `buildEventReference(genesis, acceptedPrefix)`. **A1's guard
  survives, but its INPUT SET NARROWS**: the `closedPositionIds` check is the same
  code, reading a set now derived from the fold's own closed book — and for a
  BACKDATED close that set is smaller than the shadow's was (third delta class,
  below). Its agreement test survives too, re-aimed: it drives the same batch
  through the real gate walk and asserts hand-computed cash, since comparing the
  projection with the fold it is projected from would compare a computation with
  itself.

- **The fold moves onto the ingest critical path, and that is a posture change.**
  The existing per-run fold in `ingestInbox` sits **after** the atomic append,
  inside the best-effort Head-Digest/git capture `try` — a fold failure there
  downgrades to a warning and never fails the ingest, by design. Under
  unification the gate folds **before** the append, where a fold throw correctly
  refuses the batch. That is the right behavior (a book that cannot be folded must
  not be extended) but it is strictly more that ingest can now fail on, and it is
  not what the guarded block below it teaches a reader to expect. The one throw
  `foldEvents` actually carries on this path is its exhaustiveness latch, which is
  a compile-time-guarded impossibility.

- **The last-close anchor survives the deletion — verified, because it is the one
  input that looked like it might not.** The shadow's `lastClose` map existed
  solely to feed the `PriceMarked` magnitude guard and the settlement-magnitude
  gate, and its `noteClose` was called from exactly two verb arms —
  `PositionOpened` (entry VWAC) and `PriceMarked`. The fold pushes to its
  `closes[]` output on the same two, with the same genesis seeding, so `lastClose`
  is derived from `foldEvents(...).closes` and no fragment of the shadow needed to
  be kept alive.

  **Two corners where the derived ANCHOR deliberately differs from the deleted
  shadow's,** both of which are the fold's answer winning: (1) a `PositionOpened`
  on an instrument that ALREADY has a baseline no longer moves the anchor — an
  entry price is not a market close, and the fold only mints a baseline for an
  instrument that has none; (2) a `PositionAddedTo` that re-prices the fold's own
  cost anchor to the blended VWAC now moves the gate's comparison point with it.
  The pre-existing note in `foldEvents` that the two anchors "diverge,
  legitimately" and that "nothing reconciles the two" is retired by this decision:
  they are one value now. The genesis seeding is unchanged and stays that way
  deliberately — the fold suppresses its t0 `markPrice` anchor only for an
  instrument whose genesis close is dated `review.asOf` or LATER, which is exactly
  the rule the shadow applied. (The first implementation of this decision dropped
  the date test and suppressed on any genesis close; a seed carrying a close dated
  before the review would then have handed the magnitude guard a stale comparison
  point and rejected honest marks. Pinned by a fold test.)

- **A THIRD delta class, in the OPPOSITE direction: a backdated verb no longer
  lands, so the gate's world for it is smaller.** The gate walks a batch in LOG
  order; the fold applies it in **(`asOf`, then log) order**. A verb dated before
  the event that creates its target therefore reaches the fold FIRST and hits a
  skip branch — `PositionClosed`'s `if (closing)`, `PositionTrimmed`'s
  `if (trimming)`, `PositionAddedTo`'s `if (adding)` — and never lands at all.
  Measured on `[PositionOpened asOf 06-05 btc-pos, PositionClosed asOf 06-03
  btc-pos]`: both events pass both gates, the fold leaves btc-pos **open**, mints no
  closed-book row and books no proceeds, so `closedPositionIds` comes back EMPTY
  where the shadow — advancing in log order — would have held `btc-pos`.

  The new set is a **subset** of the old one, and every element it drops is one the
  fold was going to ignore anyway, so each divergence moves the gate's answer toward
  the fold's. What it costs is guard reach on backdated input: a SECOND backdated
  close of that position is no longer rejected by A1's guard, because as far as the
  book is concerned the first one never happened. Both are then silently dropped —
  the same shape MUST FIX 1 named, minus the NAV corruption, since neither close
  books cash. This is the container-side twin of what `requireReserveBornBy` already
  rejects for Reserves, and the honest general fix is the same one: reject a verb
  dated before its target exists, at ingest. Not taken here — this ADR adds and
  removes no rejection rule — and recorded as the follow-up it is.

  **THE FOLLOW-UP LANDED (note added 2026-08-08; this ADR's decision is
  unchanged).** In two increments, both at ingest, both in `crossref.ts`:
  `requirePositionBornBy` (spec #255 → PR #256, `80827b6`) shuts the birth side
  exactly as worded above, and `requirePositionUntouchedAfter` (spec #257 → PR
  #261, `e6ef2a5`) shuts the death side — a `PositionClosed` may not date itself
  BEFORE a verb the log has already accepted for that position, which the wording
  above does not cover and which was the wider hole. **The worked example in this
  bullet is therefore no longer reproducible:** `[PositionOpened asOf 06-05
  btc-pos, PositionClosed asOf 06-03 btc-pos]` is now rejected at ingest by
  `requirePositionBornBy`; it is kept as the record of why the rule exists. The
  cost recorded above — "guard reach on backdated input" — is consequently paid
  back. The second rule reads one new `EventReference` field,
  `positionLastVerbAsOf: Map<string, PositionTouch>`, built inside the pass over
  accepted events that this ADR already pays for; **measured at 0.5% of
  `buildEventReference` at L=50k, with a share that SHRINKS as L grows, so the
  budget below is intact and its re-trigger unchanged.** No `compose/*` use, no
  extra fold.

- **Per-event fold cost is accepted, with the envelope above as the standing
  budget.** The re-trigger is explicit: if a future gate rule needs the `compose/*`
  pipeline per event rather than the bare fold, or if the accepted log approaches
  L ≈ 100k, re-measure before assuming this ADR still covers it.

- **No verb is added, removed or reshaped, and `EVENT_SCHEMA_VERSION` stays `2`.**
  No persisted record's shape changes; no line in `events.jsonl` needs migration.
  This decision is about how the gate knows the world, not about what the log
  records.

## The three SDP tests

- **Hard to reverse.** Not because the code is hard to un-write, but because the
  shadow is **deleted** and its per-verb transitions are the thing deleted. Going
  back means re-implementing the fold a second time, deliberately, against an ADR
  that says not to — and re-acquiring the divergence class in the process. Every
  verb authored after this decision will have been written with only one
  world-model in mind, so the reverse direction gets more expensive with each one,
  which is exactly the direction this ADR wants the ratchet to turn.
- **Surprising without context.** The intuitive read is that an incremental shadow
  is the _cheap_ option and re-folding per event is the extravagance — the audit
  itself flagged the re-fold as the thing to measure before committing. The
  measurement inverts it: the fold is ≈0.1 ms/1k events, the path already pays
  one, and the "cheap" shadow is the one that had been quietly costing
  correctness. That the safety comes from **deleting** the faster-looking code,
  and that a gate is allowed to be O(n) in the log per event, are not guessable
  without this measurement in hand.
- **A real trade-off.** n+1 folds per batch instead of 1, the fold moved onto the
  critical path where it can now fail an ingest, and a public export withdrawn
  from live callers — bought in exchange for a class of silent NAV corruption
  becoming **unrepresentable** rather than **guarded**. The alternative on the
  table was not "do nothing": extraction is a real, cheap, reversible improvement
  that lands finding 31 and leaves the codebase better. It was declined because it
  keeps correctness resting on the completeness of a hand-written guard suite, and
  MUST FIX 1 is the proof that the suite was already incomplete.
