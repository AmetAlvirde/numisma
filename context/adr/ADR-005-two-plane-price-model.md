# Market data is not fund history: the two-plane price model

_Made during: MVI — price-data-integration increment / 2026-07-03 crypto-only
`prices:fetch` prototype → AAR → audit (no PRD issue yet; ratified before the reliable
conversion so the durable data-plane shape is fixed before real quotes accumulate)._
_Scope: product_
_Status: accepted_

Automatically-fetched prices enter Numisma through **two decoupled planes with
separate cadences**, not through the event log alone. The **market-data plane** —
raw provider quotes — is upserted every fetch into a **disposable, re-fetchable price
store (`data/prices/`)** at a configurable **fetch cadence**; it is deliberately *not*
the event log and never becomes one. The **fund-history plane** — the sparse
`PriceMarked` valuation mark — is emitted at a separate **mark cadence** through the
existing validated inbox (`parseEvent` → `crossReferenceEvent` → dedup-by-id → atomic
append), keeping the event log's exact current shape. The fetcher never writes the log;
it only upserts the store and drops candidates in the inbox, and `pnpm spine` owns the
guarded append. Cranking the fetch cadence from daily to hourly to per-minute only grows
`data/prices/`; the log keeps receiving exactly the sparse marks the mark cadence
defines. Per ADR-001 the pure transforms (`quote → PriceMarkedEvent`, symbol resolution,
later MXN derivation) live in `@numisma/engine`; the fetch/IO/scheduling shell lives in
the runtime (a dedicated headless `packages/price-feed`).

## Considered Options

- **Fold fetched prices into the event log as `PriceMarked` events at fetch cadence.**
  Rejected — **this is the decision the ADR exists to reject.** Real-time or intraday
  crypto alone is 78+ candles/day (13 instruments × 6 4h-bars); folding reproducible
  market data into the append-only log bloats it without bound and slows every startup
  fold for data that can always be re-fetched from Binance / `data.binance.vision`. It
  also conflates two different truths: a `PriceMarked` is a *valuation decision* about
  the fund's book (sparse, authored, guarded), whereas a quote stream is *disposable
  observation*. Keeping them one plane means the log stops being a fund journal and
  becomes a price log for n instruments.
- **A single dated snapshot store that replaces `PriceMarked` marks entirely.** Rejected:
  the fold and the whole #90 book are defined in terms of the event log and its
  `PriceMarked` marks; removing the mark verb would be a redesign of the read model, not
  an increment, and would lose the validated-ingest guard (±50% magnitude, genesis-id
  cross-reference) that catches FX-unit slips and fat-finger typos. The two-plane model
  *keeps* that guard on the mark plane and adds the store beside it.
- **Derive `asOf` from the provider's raw UTC candle-open day (what the prototype did).**
  Rejected as the durable rule: a CDMX-evening fetch of a UTC-dated daily candle can label
  the mark "tomorrow," and because the store upserts-latest while the inbox keeps-first
  (dedup by the deterministic `pm-<id>-<asOf>` id), the stored quote and the queued mark
  can silently diverge intraday. The mark's `asOf` must be the trading-day date in a
  **configured trading-day timezone**, and the mark must be taken at a defined instant
  within the mark period — see Consequences. The concrete timezone default and the
  which-fetch-of-the-period threshold are **configuration**, not frozen here; the
  *invariant* (timezone-anchored, one mark per instrument per mark period) is.

## Consequences

- **Two durable planes with deliberately different guarantees.** `data/prices/` is
  disposable, re-fetchable, and allowed to grow with fetch cadence; the event log stays
  sparse, authored, and permanent. The store carries no durability contract beyond
  git-ignored local files (whole `data/prices/` ignored regardless of format); the log
  keeps its ADR-003 append-only + fail-loud discipline. Because the planes are separate,
  the raw quote and the sparse mark are *permitted to diverge* intraday — that divergence
  is the point, not a bug, and is exactly why they do not share a plane.
- **The mark-instant contract.** At most **one `PriceMarked` per instrument per mark
  period**, whose `asOf` is the trading-day date in a **configured timezone** (not the
  provider's UTC candle day) and whose price is the fetch taken at/after the period
  boundary in that timezone. The deterministic id `pm-<instrumentId>-<asOf>` makes this
  self-enforcing: sub-period fetches re-emit the same id and are skipped by both the
  inbox merge and the ingest dedup, so more fetching never multiplies marks. The specific
  timezone default and the "which fetch instant" rule are configurable; the invariant is
  not.
- **Zero engine change to add prices.** The fetcher is another author on the already-
  decoupled, validated inbox channel — no new event type, no parser/fold change, no
  `EVENT_SCHEMA_VERSION` bump. `PriceMarked` keeps its exact shape (`id`, `asOf`, `type`,
  `instrumentId`, `price`, optional `usdMxn`). The store is new and additive.
- **ADR-001 boundary split.** `quote → PriceMarkedEvent` construction, symbol/instrument
  resolution, and the future USD×FIX MXN derivation are pure `@numisma/engine` domain;
  provider fetch, the price-store upsert, the inbox atomic write, and scheduling are the
  runtime shell. No engine code touches the network or a file.
- **Level 3 is a cadence/transport change, not a redesign.** Adding Binance websocket
  streams, bulk-backfilling from `data.binance.vision`, or going daily → per-minute only
  changes how fast `data/prices/` fills. The mark plane and the fold are untouched. Real-
  time equities stay deferred as a paid-data product decision, orthogonal to this shape.

### The three SDP tests

- **Hard to reverse.** This establishes a **second durable data plane** with its own
  cadence and lifecycle beside the event log. Once real quotes accumulate and the mark
  cadence is depended on, unwinding it means re-deciding where prices live and whether
  they re-enter the log — a data-model migration, not a code edit. Ratified before the
  first fetched quote is stored, so no later plane migration is forced.
- **Surprising without context.** The log *already* carries `PriceMarked`, so the
  intuitive expectation is that fetched prices are just more events. That raw quotes are
  deliberately kept **out** of the log as disposable data, and that the stored quote is
  *allowed to diverge* from the sparse mark, is non-obvious and needs the rationale
  recorded — it mirrors the ADR-004 instinct (a second durable artifact beside the log to
  keep the fold pure and standalone-foldable).
- **A real trade-off.** Separate plane + configurable fetch/mark cadences vs. folding
  candles into the log: the two-plane model keeps the log a sparse fund journal and the
  startup fold fast, at the cost of a second artifact to manage and an intraday
  quote-vs-mark divergence that must be understood rather than eliminated.
