# Domain model

The domain prose behind the [root README](../README.md): the ten event verbs,
the two position-moving verbs' semantics, what the fold reports it could not
apply, the descriptive review sections derived from the fold, and the sidecars
recorded beside the log — Orders as claims on capital, Plans as the operator's
declared intent, and the trail of what the operator was told. See [`context/ubiquitous-language.md`](../context/ubiquitous-language.md)
for term definitions and [`context/adr/INDEX.md`](../context/adr/INDEX.md) for
the decisions cited below.

Numisma builds a canonical Fund composition read model and renders it for
review — as a one-shot text report, an interactive terminal dashboard, and a
hosted phone-checkable projection. The durable source of truth is an
append-only **event log** of material actions — ten verbs (`PositionOpened` /
`PositionClosed` / `PositionTrimmed` / `PositionAddedTo` / `PriceMarked` /
`Deposit` / `Withdraw` / `Transfer` / `InvalidationMarked` / `ReserveOpened`)
layered on an immutable **genesis seed**; current state and any as-of view are
a pure **fold** of the log into the read model
([ADR-003](../context/adr/ADR-003-event-log-genesis-fold-persistence.md),
amended for the trim/add verbs; the tenth verb is
[ADR-012](../context/adr/ADR-012-reserve-opened-tenth-event-verb.md), shipped
to `main` in PR #162). All ten verbs are shipped and reliable.

## The Discard Channel: the fold reports what it dropped

The fold returns `{data, skipped}`, not a bare read model. `data` is the
composition; `skipped` is every event the fold read and could not apply
([ADR-020](../context/adr/ADR-020-the-discard-channel-report-never-refuse.md)).
Three reasons, closed: `position-absent` (the verb named a position the fold has
no record of), `reserve-absent` (a cash leg named a reserve it has no record of),
and `provenance-absent` (a lot-derived cash leg had no lots to inherit cost-basis
attribution from).

**Every reason means the same one thing: the fold read the event and applied
nothing at all**
([ADR-021](../context/adr/ADR-021-one-meaning-for-the-discard-vocabulary.md)).
There is no partial application anywhere in the vocabulary. A close naming a
missing reserve therefore leaves the position OPEN and mints no closed-book row,
rather than booking realized profit against a reserve that never moved; an add
naming one does not grow the position, because appending the lot while dropping
the debit would be NAV invention. A `Transfer` applies both legs or neither, and
reports one record for the event rather than one per leg. The book is visibly
missing a retirement instead of quietly carrying an uncredited realization: loud
and inspectable beats silent and balanced-looking.

A discard is never a refusal. The fold does not throw on one, the ingest gate
carries `skipped` through without acting on it (refusing there would brick all
future ingest over one already-immutable historical event), and the Head Digest
carries `discardedEventCount` so a nonzero discard is visible on the artifact
premised on nobody replaying the log. Every counting surface goes through the one
dedup key, `dedupeFoldSkips` on (`eventId`, `reason`), so no two of them can
report different figures for one log.

## The two position-moving verbs

The two position-moving verbs act on an already-open Position:
**`PositionTrimmed`** partially takes profit — it names `removals: [{tier,
quantity}]` plus an atomic `settlement` cash leg, removes pro-rata within each
named Tier, and emits a **partial** `ClosedPositionRecord` (`partial: true`)
that shares the surviving Position's id (the Position always survives; a
full-retirement trim is rejected — use `PositionClosed`). **`PositionAddedTo`**
scales in — it appends a new lot with its own entry FX and Tier (never
weighted-average merged) funded by a `funding` debit, and produces no realized
P&L.

## Closed book and invalidation watch

Beyond live composition, the fold also emits two descriptive review sections.
The **closed book** (realized-P&L blotter) records each closed Position's
realized Trading P&L — proceeds minus the lot USD cost basis, attributed per
Capital Tier — and rolls it up by Tempo and Tier. It is **descriptive only**:
realized profit already sits in a Reserve from the close's cash leg, so it is
never re-added to NAV. The **invalidation watch** lists open Positions against
the latest `InvalidationMarked` level and `direction` (`below`/`above`),
flagging any whose mark has crossed it.

## Profit-split obligation

On top of the closed book sits a derived, **descriptive-only profit-split
obligation** (`composeProfitSplit`). It computes the fund's split obligation
on the exact cumulative total realized (default **60/40** high-water-mark, no
clawback; a `perClose` basis is selectable to prove the behavior is
configuration), and renders **obligation-only** — the obligation plus a
RESERVE %-of-NAV-vs-10%-target line, with no routed-flow / unallocated balance
(a deferred fast-follow). It is empty-guarded and, like the closed book, is
never fed into NAV. The split policy lives in a **preferences sidecar**
(`preferences.jsonl`, in the durable-data root) — append-only, validated on
load, and decoupled from the event log; the engine-pure
`pickPolicyAsOf(prefs, asOf)` selects the policy in effect at any as-of date,
while the sidecar's file IO lives in
[`@numisma/preferences`](../packages/preferences/README.md)
([ADR-001](../context/adr/ADR-001-package-boundary-and-runtime-split.md),
[ADR-004](../context/adr/ADR-004-preferences-sidecar.md)).

## Orders — claims on capital, recorded beside the log

An **Order** is a claim on capital that has not yet become a transaction.
Orders are deliberately **not events**: they live in their own append-only
sidecar (`orders.jsonl`) and are joined to the fold at read time, never folded
into `FundReviewData` or NAV
([ADR-013](../context/adr/ADR-013-order-a-claim-on-capital-recorded-beside-the-log.md),
[ADR-014](../context/adr/ADR-014-a-skipped-export-row-not-persisted-because-it-could-never-be-retired.md)).
Four kinds are recorded — `orderPlaced`, `orderCancelled`, `orderFilled`,
`orderFillObserved` — and the engine derives **committed** and **available**
capital from them, so resting rungs cannot be double-spent.

The intake is a manual `<exchange>` open-orders CSV export, not a live broker
connection: `pnpm orders:import` parses it behind a funding-coverage guard.
`pnpm orders:cancel` retires one resting rung. `pnpm orders:fill` is the only
orders command that touches the event log — it atomically retires the claim
in `orders.jsonl` **and** appends the resulting `PositionOpened` /
`PositionAddedTo` to `events.jsonl`.

See [`docs/scripts.md`](./scripts.md) for the full Orders command reference.

## Plans — the operator's declaration of intent

A **Plan** is what the operator says one position IS: "this position is a
four-rung ladder", "this position buys weekly", "this position is done". It is
the third member of ADR-004's sidecar class — durable, append-only,
git-versioned, beside the event log and **never folded**. `parseEvent` never sees
a plan line, `foldEvents` never reads one, and nothing a plan declares can move
NAV.

Three kinds, closed: `dcaLadder` (rungs, each with its own price, and no two
sharing one), `dcaTime` (a `daily`/`weekly`/`monthly` cadence), and `noPlan`, the
explicit terminator. Identity is `positionId` + `effectiveAt`, and **supersession
is the entire editing mechanism**: there is no edit and no delete, a later
`effectiveAt` for the same position replaces the earlier one, and pause and end
are the same act because resumption is just a later plan line. Without a `noPlan`
line the last plan stays in force forever, since selection is "latest
`effectiveAt ≤ asOf`".

**A plan naming a position that does not exist yet is legal**, and that is the
point rather than a gap: naming the position a ladder is meant to *become* is
precisely the fact being authored. Contrast `orders.jsonl`, which refuses a
`positionId` outright, because an Order is an observation of a venue row and the
venue has never heard of a Position.

Plans join the Orders domain at two places. On import, the declared-rung join
offers the operator the one ladder rung a price match proposes, and stays silent
when the match is ambiguous; the operator ratifies, and the import report flags
any difference against the rung's declared price. On review, the **Fill Path**
reconciles one declared ladder against the whole order stream and the recorded
lots, reporting each rung on two axes that are never collapsed into one enum —
what the venue shows, and what the book did — plus the orphan lots no rung claims.

## The reconciliation trail — what the operator was told

`reconciliations.jsonl` is the fourth sidecar member and the only
machine-written one: at a named moment a reader compared one fill against the
plan in force and showed the operator a verdict. A line here is **the record that
the operator was told**, not a record of what is true. `plans.jsonl` stays
authoritative always; a trail line never overrides it, corrects it, or is read in
preference to it. Because plan supersession is append-only, the verdict as shown
is not recoverable from the plans sidecar later, which is why each line carries a
denormalized copy of the declared values as shown. A trail line that disagrees
with a fresh re-derivation is a **finding, not a corruption**: a plan was
rewritten after the fact, and that divergence is recorded nowhere else. The
mismatch vocabulary is closed at two members, `tierNotInPlan` and `noPlanInForce`.

Writing the trail is best-effort and never part of the fill act. The fill is
already durable by the time the trail is written, and nothing on this path can
refuse a fill, roll one back, or block a return.
