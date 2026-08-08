# Domain model

The domain prose behind the [root README](../README.md): the ten event verbs,
the two position-moving verbs' semantics, the descriptive review sections
derived from the fold, and Orders as claims on capital recorded beside the
log. See [`context/ubiquitous-language.md`](../context/ubiquitous-language.md)
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
