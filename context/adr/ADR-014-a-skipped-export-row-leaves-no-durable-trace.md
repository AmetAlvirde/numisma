# A skipped export row leaves no durable trace

_Made during: MVI — BTC DCA tracker increment / the decision was argued and taken
on #183 ("The funding guard cannot see a rung the export skipped", closed
COMPLETED 2026-07-31, `D2`'s rejected candidate (d)). #203 existed only to be the
open tracker the two citing comments could name, and this ADR replaces it. Record
only — no behavior lands with this ADR._
_Scope: product_
_Status: accepted_

The Bitget open-orders export can carry a row the parser cannot read. Such a row
is skipped: it reaches stderr and the returned `imported-partial` outcome, and
then dies with the process. **Nothing durable is written.** `OrderRecord` is four
kinds — `orderPlaced`, `orderCancelled`, `orderFilled` and `orderFillObserved`
(`packages/engine/src/orders/records.ts`, cited by name because that line number
has already drifted once) — and none of them means *"line N of the export could
not be read."*

The reason is that **a skipped row has no id to be given.**
`synthesizeOrderId` (`packages/engine/src/orders/ingest.ts`) derives the id from
venue, pair, side, price and submitted-at — the very tokens that failed to parse.
A durable *"something was here"* could therefore never be matched by a later
import, and so could never be **retired** by one: a permanent blot on every future
report with no verb to close it.

## Considered options

**Persist the gap** — rejected, for the reason above. It is recorded here because
the alternative is the obvious one and looks like a plain omission otherwise: the
un-retirable blot is worse than the silence, not merely different from it.

## Consequences

- **The accepted cost lands in the money direction.** `available = value −
  committed` reads HIGH for a rung nobody could weigh. The live import says so,
  through `imported-partial`'s operator line; a reader coming to `orders.jsonl`
  the next day gets silence.
- **The loss is at import time, not at write time.** What line N said is gone
  once the process exits, so reversing this decision forward would still leave
  every past import's gap unrecoverable.
- **`imported-partial` exits 0** (`apps/tui/src/import-orders-cli.ts`),
  deliberately: nothing was refused, so exiting 1 would tell a caller the run
  failed when it did not. That argument depends entirely on a human watching the
  operator's lines.

## Re-triggers

Following ADR-007's precedent for a deferral that names its own trigger:

- **A stable identity for a skipped row re-triggers this ADR.** If any future
  design gives a skipped row an identity that survives a re-import and can be
  **retired** by it, the rejection's premise is gone and this decision must be
  amended or superseded rather than inherited.
- **Automating or piping the import re-triggers it too.** Then the exit code is
  the only surface left, and a partial read that silently exits 0 is precisely
  what a scheduled job cannot see. Today `orders:import` is only a
  `package.json` script and nothing in `ops/` schedules it, so the trigger has
  not fired — the daily price-feed job is the shape of the precedent, and this
  branch must be revisited **before** orders ingestion joins it, not after.
