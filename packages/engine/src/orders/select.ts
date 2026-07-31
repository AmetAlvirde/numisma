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
 * A claim rests until it is observed to leave the book: `orderCancelled` retires it
 * outright, and `orderFilled` retires only the quantity it names — the remainder keeps
 * resting, and the claim is retired when the quantity is exhausted. Nothing is inferred
 * from an ABSENCE: a rung that simply stops appearing in the venue's export has no line
 * here and stays resting until an observation says otherwise (ADR-013, `D12`).
 *
 * Lines are replayed in `observedAt` order rather than file order, so a sidecar whose
 * appends arrived out of order still replays deterministically — the same contract
 * `pickPolicyAsOf` holds for a non-monotonic preferences file. A state-change line
 * naming an id that was never placed (or placed after the boundary) is ignored; it
 * cannot invent a resting claim.
 */
export function pickRestingOrdersAsOf(records: OrderRecord[], asOf?: string): RestingOrder[] {
  const bound = asOf === undefined ? undefined : upperBound(asOf);
  const eligible = records
    .filter((record) => bound === undefined || record.observedAt <= bound)
    .slice()
    .sort((a, b) => (a.observedAt < b.observedAt ? -1 : a.observedAt > b.observedAt ? 1 : 0));

  const resting = new Map<string, RestingOrder>();
  for (const record of eligible) {
    switch (record.kind) {
      case "orderPlaced": {
        // A repeat placement of a known id is the same claim observed twice (ingest ids
        // are deterministic), not a second claim. Ignoring it keeps a re-import from
        // double-counting the ladder.
        if (!resting.has(record.id)) {
          resting.set(record.id, { placed: record, remainingQuantity: record.quantity });
        }
        break;
      }
      case "orderCancelled": {
        resting.delete(record.id);
        break;
      }
      case "orderFilled": {
        const open = resting.get(record.id);
        if (!open) {
          break;
        }
        const remaining = open.remainingQuantity - record.filledQuantity;
        if (remaining > 0) {
          resting.set(record.id, { placed: open.placed, remainingQuantity: remaining });
        } else {
          resting.delete(record.id);
        }
        break;
      }
    }
  }

  return [...resting.values()];
}
