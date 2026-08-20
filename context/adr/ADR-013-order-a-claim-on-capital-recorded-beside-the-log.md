# `Order`: a claim on capital, recorded beside the log

_Made during: MVI — BTC DCA tracker increment / 2026-07-28 orders grill
([[2026-07-28-btc-dca-tracker-orders-grill]], decisions `D3`, `D4`, `D12`) →
spec "Increment one — `Order`, <exchange> ingest, and available capital" (#163,
seams `S1`, `S3`, `S5`, `S9`) / slice #165. Language and record only — no
behavior lands with this ADR._
_Scope: product_
_Status: accepted_

An **`Order`** is **a claim on capital that has not yet become a transaction**.
It is recorded in a third durable artifact, **`data/orders.jsonl`**, in ADR-004's
sidecar class — **beside** the append-only event log, **never in it**. The two
files are joined at read time, never merged, the shape the repo already uses for
the preferences sidecar (`pickPolicyAsOf` + the fold, joined in
`composeProfitSplit`).

This ADR argues **exactly one thing**: that `Order` belongs beside the log rather
than inside it. It does not decide the file's record shape beyond the two words
that carry this claim, does not decide the ingest path, and does not decide how
committed and available capital are rendered.

## The decisive argument: you never observe a fill, you observe an absence

The venue's open-orders export lists what is **resting right now**. A rung that
was on yesterday's export and is missing from today's has left the book — and the
export **cannot say whether it filled or was cancelled**. Both look identical:
an absence.

Written into the event log, a verdict about that absence would make an
**inference permanent in the fund's record of fact**. That is the case the orders
grill rejected outright (`D12`) — inferring a fill from disappearance *"silently
converts cancellations into phantom purchases."* A phantom purchase in
`events.jsonl` folds into NAV, is committed to the Log History, and is not
retractable; the log is append-only by construction, so the correction is another
line, and the fund's history permanently contains a trade that never happened.

Beside the log, that failure mode is **structurally impossible**. A line in
`orders.jsonl` is not a `PortfolioEvent`, `parseEvent` never sees it, `foldEvents`
never reads it, and nothing it says can reach `fundValueUsd`. A speculative line
cannot touch NAV because there is no path from the file it lives in to the number.
The safety is a property of the file's position, not of anyone's discipline in
writing it.

## Why ADR-012's boundary test does not reach an `Order`

ADR-012 answered ADR-004's line between material action and descriptive policy by
ratifying that **"capital structure sits on the log side"** of it: a Reserve is a
container the fund really owns, `foldEvents` yields a strictly more complete book
with `ReserveOpened` in it, so the tenth verb belongs in the log.

That test does not extend to an `Order`, and the reason is `D4`. **A resting
order encumbers availability, not value** — the Reserve's balance is exactly what
it was, every Lot keeps its Capital Tier, and NAV is unchanged to the last digit.
**The log is what NAV folds from.** An artifact that changes no value the fold
computes has nothing to contribute to the fold, and putting it there would grow
the permanent verb surface for a record that folds to a no-op.

Stated as the line itself:

> **The log records what the fund did; the orders file records what the venue
> shows.**

A fill is something the fund did, and it lands in the log as a `PositionOpened`
or `PositionAddedTo` with its funding leg — authored by a human, under the five
decision fields `PositionOpened` already requires. A resting order is something
the venue shows, and it stays in the sidecar until it becomes one of those.

## Considered options

- **A third durable sidecar, `data/orders.jsonl` (CHOSEN).** Joined at read time,
  never folded. Costs a third durable artifact to persist, validate and commit;
  buys the structural impossibility above.
- **An eleventh event verb (`OrderPlaced`/`OrderFilled`/`OrderCancelled`) —
  REJECTED.** It would place the disappearance verdict in the fund's record of
  fact, which is `D12`'s rejected case exactly. It would also grow the permanent
  verb enumeration and force an `EVENT_SCHEMA_VERSION` conversation for records
  that are speculative by definition, and would put lines in `events.jsonl` that
  every future fold has to learn to ignore.
- **A current-state orders file with no history — REJECTED** (`S2`). Cheaper to
  write and unanswerable to the one question the product exists to answer:
  *"what was committed on date X?"* Adherence is half the product and it needs
  the history.
- **No record at all; re-read the export whenever the number is wanted —
  REJECTED.** The export is a rendered table with no order id and no retention;
  yesterday's is gone. The fund cannot reconstruct what was committed on a past
  date from a file the venue no longer serves.

## Consequences

**Three, all load-bearing, and each verified first-hand:**

- **The event verb count is unchanged.** No verb is added, removed or reshaped by
  this decision. (The count is ten as of ADR-012; ADR-003's body only ever reaches
  nine — see the ADR-004 amendment's note on where the count actually lives.)
- **`EVENT_SCHEMA_VERSION` is unchanged, at `2`.** Nothing about any persisted
  event record's shape changes, so no prior line needs migration and the question
  the marker tracks — persisted record shape — is untouched.
- **This increment has NO forward-compatibility cliff.** The single largest risk
  the prior increment carried is simply absent here.
  `apps/price-feed/src/rejection-check.ts` reads `data/events.jsonl` and
  **throws on anything it cannot read** — at the time of this decision by
  splitting the file and running `parseEvent` line by line; today through
  `loadEventLog` + `assertLogFullyLoaded` (`:140-141`), with the same policy
  applied again to inbox candidates by `walkPendingInbox` (`:164`, throwing at
  `:173`). launchd runs it daily from the working checkout. It **never reads
  `orders.jsonl`** — verified by grep, then and now: the string `orders` does
  not appear in that file at all. Adding lines to a file the daily check does
  not open cannot break the daily check.

**The naming claim: `kind` not `type`, `observedAt` not `asOf`.**

```jsonc
// events.jsonl   {"id":"…","asOf":"YYYY-MM-DD","type":"PositionAddedTo",…}
// orders.jsonl   {"id":"…","observedAt":"YYYY-MM-DDTHH:MM:SS","kind":"orderPlaced",…}
```

The skeleton is deliberately the same and **the two words that differ are the two
carrying the architectural claim.** Reusing the envelope's words would blur the
line ADR-004 draws — a line that reads `"type": "orderPlaced"` invites the reader,
and the next author, to treat the file as foldable, NAV-bearing, and subject to
`parseEvent`. It is none of those. Different words make the difference visible at
every read, which is the whole reason the sidecar is a separate file.

**`observedAt` earns its keep independently of that argument**, and this is the
half that would stand even if the naming claim did not. `parseEvent` gates the
envelope's `asOf` to a bare `YYYY-MM-DD` date —
`packages/engine/src/events/parse.ts:119`, `if (typeof input.asOf !== "string" ||
!isIsoDate(input.asOf))`, rejecting anything else with *"Event asOf must be an ISO
date (YYYY-MM-DD)"* — while the venue's timestamps are **second-granular**.
Matching the log's word would mean matching the log's precision, and matching the
log's precision would mean **losing information** the export actually carries:
several rungs of one ladder are submitted within the same minute, and a date-only
stamp cannot order them. `observedAt` is the one field that would have to be made
less true to look like the log.

## The three SDP tests

- **Hard to reverse.** `orders.jsonl` is a durable, append-only, git-versioned
  artifact in the Log History. Once real observed lines are written, the file's
  format and its read-time join semantics are as load-bearing as the preferences
  sidecar's — changing them means migrating a persisted artifact, not editing one
  module. Ratified here **before the first line is written**, so no migration is
  forced later. The reverse direction — promoting `Order` into the log as an
  eleventh verb — is the genuinely expensive one, and it is expensive in exactly
  the way this ADR wants it to be.
- **Surprising without context.** The intuitive place for "the orders the fund has
  placed" is the event log, next to the trades they become — and the log is the
  one place they must not be. That the safety comes from **which file the line is
  in** rather than from validating the line, and that the record's two envelope
  words differ from the log's on purpose rather than by oversight, are not
  guessable without this decision.
- **A real trade-off.** A third durable artifact to persist, validate, commit and
  join at read time — plus a read-time join instead of a single foldable
  history — bought in exchange for its being **structurally impossible** for an
  inference about an absence to reach NAV. The alternative on the table was not
  "do nothing": the fund's committed capital is genuinely invisible today. It was
  "put the verdict in the record of fact," and that is what was declined.
