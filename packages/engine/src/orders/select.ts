/**
 * The PURE as-of selector over a loaded `orders.jsonl` — "what was resting as of
 * date X". No IO (ADR-001 bars it from this package); the file reading lives in
 * `@numisma/preferences`. Direct prior art: `pickPolicyAsOf`, which selects the
 * preferences sidecar's as-of entry and is joined to the fold at READ time. The two
 * files are joined at read time, never merged.
 *
 * "What was committed on date X?" is the question adherence is made of, and it is only
 * answerable because the file is a LIFECYCLE STREAM rather than a current-state
 * snapshot: replay the lines up to the boundary and the resting set falls out.
 */
import type { OrderPlacedRecord, OrderRecord } from "./records.js";

/**
 * One claim still resting at the as-of boundary, with the size that is STILL claimed.
 * A partially-filled rung encumbers only its unfilled remainder, so the remainder is
 * carried here rather than left for each caller to recompute from the fill lines.
 *
 * `remainingQuantity` is NET OF EVERYTHING OBSERVED: the placement line's own
 * `observedFilledQuantity` (what the venue already showed filled when the rung was
 * imported), every later `orderFillObserved` restating that figure, and every
 * `orderFilled` line the fund booked. The ORIGINAL size stays on `placed.quantity`, and
 * that distinction is load-bearing — a cumulative venue reading is compared against the
 * original, never against this (#176).
 *
 * IT IS A REPORT, NOT AN AUTHORIZATION, and the difference is not pedantry. `consumed` is
 * NOT MONOTONIC (see {@link pickRestingOrdersAsOf}), so this figure can go UP as well as
 * down. A caller asking "how much is still encumbered" is asking the right question of
 * it. A caller asking "how much may I still book against this rung" is not, and must
 * apply the booked-fills ceiling at its own boundary — this number alone would let a
 * backwards observation authorize a second lot and cash leg against an already-exhausted
 * rung.
 */
export interface RestingOrder {
  placed: OrderPlacedRecord;
  remainingQuantity: number;
}

/**
 * The inclusive upper bound to compare `observedAt` against. A bare `YYYY-MM-DD` asks
 * about a whole DAY, so it widens to that day's last second — otherwise a plain string
 * comparison would exclude every order placed during the very day being asked about
 * (`"2026-01-02T09:00:00" > "2026-01-02"`), and the selector would silently answer with
 * the previous day's book.
 */
function upperBound(asOf: string): string {
  return asOf.length === 10 ? `${asOf}T23:59:59` : asOf;
}

/**
 * PURE selector: the orders still resting as of `asOf` (or as of the whole stream when
 * `asOf` is omitted), in the order they were placed.
 *
 * ONE `consumed` BASELINE PER RUNG, folded in ONE PASS (#181). Four verbs move it:
 *
 *   - `orderPlaced`      SETS it — the first observation; absent reads as 0.
 *   - `orderFillObserved` SETS it — a later observation of the SAME cumulative figure.
 *   - `orderFilled`      ADDS to it — a delta, something the fund DID.
 *   - `orderCancelled`   retires the rung outright.
 *
 * and `remainingQuantity = quantity − consumed`. A rung with nothing still claimed is not
 * resting at all — a fully filled row is not a claim on capital. Nothing is inferred from
 * an ABSENCE: a rung that simply stops appearing in the venue's export has no line here
 * and stays resting until an observation says otherwise (ADR-013, `D12`).
 *
 * INVARIANT 1 — THE REPLAY ORDER *IS* THE CONTRACT, NOT AN IMPLEMENTATION DETAIL. Lines
 * are replayed in `observedAt` order rather than file order, so a sidecar whose appends
 * arrived out of order still replays deterministically — the same contract
 * `pickPolicyAsOf` holds for a non-monotonic preferences file. But the fold is also
 * ORDER-SENSITIVE, which is a stronger statement and the one that gets forgotten: a rung
 * placed at 10 with 2 already filled, then OBSERVED at 6, then FILLED for 1 more, has 3
 * remaining. Every order-insensitive formulation of the same four rules — `max` of the
 * observations against the sum of the fills being the tempting one — reads 4 on that
 * stream, and 4 is wrong. Do not reformulate this into something that can be computed
 * from unordered sets; it cannot.
 *
 * INVARIANT 2 — `consumed` IS NOT MONOTONIC, SO `remainingQuantity` IS A REPORT AND NOT
 * AN AUTHORIZATION. Because an observation SETS the baseline, one asserting a figure
 * BELOW the current baseline takes `remaining` from zero back to positive: THE FOLD
 * RESURRECTS A RETIRED RUNG, deliberately. That is stated rather than prevented, for two
 * reasons. It is RELOCATED, not introduced — the previous fold let a repeat `orderPlaced`
 * line re-insert a retired rung at FULL SIZE, silently, off a line it otherwise ignores
 * by design. And latching retirement instead would be irreversible by construction: this
 * is an append-only file with no reversal verb, so a rung latched in error would be
 * permanently un-fillable AND un-cancellable, where resurrection is recoverable.
 *
 * The consequence — that a resurrected rung must not authorize a second lot and cash leg
 * against capital already spent — is closed at the FILL-ADMISSION boundary, where the
 * booked-fills ceiling lives, and not here. This fold stays PURE arithmetic over the
 * stream so that policy has exactly one home.
 *
 * A state-change line naming an id that was never placed (or placed after the boundary)
 * is ignored; it cannot invent a resting claim.
 */
export function pickRestingOrdersAsOf(records: OrderRecord[], asOf?: string): RestingOrder[] {
  const bound = asOf === undefined ? undefined : upperBound(asOf);
  const eligible = records
    .filter((record) => bound === undefined || record.observedAt <= bound)
    .slice()
    .sort((a, b) => (a.observedAt < b.observedAt ? -1 : a.observedAt > b.observedAt ? 1 : 0));

  // The placement line and its running baseline, together — one entry per rung the fold
  // has met. A rung stays here once exhausted rather than being deleted, which is what
  // lets a later line move the baseline in either direction; only `orderCancelled`
  // removes an entry, because only a cancellation says the claim LEFT THE BOOK.
  const rungs = new Map<string, { placed: OrderPlacedRecord; consumed: number }>();

  for (const record of eligible) {
    switch (record.kind) {
      case "orderPlaced": {
        // A repeat placement of a known id is the same claim observed twice (ingest ids
        // are deterministic), not a second claim. Ignoring it keeps a re-import from
        // double-counting the ladder — and it is what makes the partial carried ON this
        // line idempotent, where a synthesized `orderFilled` line would be subtracted
        // once per copy (#173).
        if (!rungs.has(record.id)) {
          // THE FIRST OBSERVATION, on the same cumulative basis as every later one.
          // Absent reads as nothing filled (#173).
          rungs.set(record.id, { placed: record, consumed: record.observedFilledQuantity ?? 0 });
        }
        break;
      }
      case "orderCancelled": {
        rungs.delete(record.id);
        break;
      }
      case "orderFilled": {
        // ADD — a delta, as it always was: something the fund DID, with a lot and a cash
        // leg behind it. Nothing to add it to means the line names an id never placed
        // here, and no line may invent a resting claim.
        const rung = rungs.get(record.id);
        if (rung) {
          rung.consumed += record.filledQuantity;
        }
        break;
      }
      case "orderFillObserved": {
        // SET, not add, and not `max`. The venue's figure is CUMULATIVE since placement,
        // so it REPLACES the baseline rather than stacking on it — which is what makes an
        // interleaving safe: observed 6, filled 1, observed 8 folds to 6 → 7 → 8, and the
        // fill is neither lost nor counted twice, because the next observation is a fresh
        // baseline rather than an adjustment to the old one.
        //
        // `max` was considered and refused. On a backwards observation it keeps the
        // HIGHER `consumed`, so `remaining` stays low, `committed` reads LOW and
        // `available` reads HIGH — the money-losing direction. Plain SET raises the
        // remainder instead, which is the conservative answer and the arithmetically
        // honest one.
        const rung = rungs.get(record.id);
        if (rung) {
          rung.consumed = record.observedFilledQuantity;
        }
        break;
      }
      default: {
        // A kind added to `OrderKind` and never taught to this fold would typecheck fine
        // and fold to NOTHING — the single most likely way a new verb ships broken, and it
        // presents identically to a line that was never appended. This latch turns that
        // into a compile error. Compile-time only: an unknown kind cannot reach here at
        // runtime, because `parseOrderRecord` refuses it first.
        const _never: never = record;
        void _never;
        break;
      }
    }
  }

  const resting: RestingOrder[] = [];
  for (const { placed, consumed } of rungs.values()) {
    const remaining = placed.quantity - consumed;
    if (remaining > 0) {
      resting.push({ placed, remainingQuantity: remaining });
    }
  }
  return resting;
}
