/**
 * THE APPEND FILTER'S RULE, ASSERTED DIRECTLY — the reason the key and its set-builder
 * left `import-orders.ts` together.
 *
 * Every fact below was reachable before only through a whole import: an export file, a
 * sidecar, an injected clock, a prompt answered, a funding guard satisfied. The rule is a
 * pure function of the records on file, so it is tested as one — no stub, no IO bag, no
 * temp dir.
 *
 * NOTHING HERE ASSERTS THE KEY'S STRING FORMAT, and that is deliberate: the format is an
 * implementation detail the module is free to change, while the PROPERTIES — which lines
 * collide and which do not — are the rule. Every assertion is phrased as membership in
 * the set the filter actually consults.
 *
 * The observation lines are built through `buildOrderFillObserved` rather than by object
 * literal, because that is the only way to obtain one: the record type carries a
 * compile-time brand precisely so an unvalidated figure cannot be passed off as observed.
 */
import {
  buildOrderFillObserved,
  type OrderFillObservedRecord,
  type OrderPlacedRecord,
} from "@numisma/engine";
import { describe, expect, it } from "vitest";
import { appendKey, currentClaimKeys } from "./import-orders-append-filter.js";

function placed(id: string, observedAt = "2026-08-07T10:00:00"): OrderPlacedRecord {
  return {
    id,
    observedAt,
    kind: "orderPlaced",
    currency: "USD",
    symbol: "BTCUSDT",
    side: "buy",
    price: 100,
    quantity: 10,
    fundingReserveId: "cash-core",
  };
}

function observedLine(
  id: string,
  observedFilledQuantity: number,
  observedAt = "2026-08-07T12:00:00",
): OrderFillObservedRecord {
  const built = buildOrderFillObserved({
    id,
    observedAt,
    currency: "USD",
    observedFilledQuantity,
  });
  if (built.status !== "ok") {
    throw new Error(`fixture is not buildable: ${built.message}`);
  }
  return built.record;
}

describe("currentClaimKeys — is this line already what the rung currently claims?", () => {
  it("DEDUPES TWO OBSERVATIONS OF THE SAME CUMULATIVE FIGURE, whatever the stamps", () => {
    // The same fact stated twice. The two stamps differ on purpose: the key is what the
    // line ASSERTS, so a repeat of 8 is a repeat whether it was looked at a minute later
    // or — the case `observedAt` cannot separate at all — inside the same second.
    const keys = currentClaimKeys([placed("rung-1"), observedLine("rung-1", 8)]);
    expect(keys.has(appendKey(observedLine("rung-1", 8, "2026-08-07T12:00:01")))).toBe(true);
    expect(keys.has(appendKey(observedLine("rung-1", 8, "2026-08-07T12:00:00")))).toBe(true);
  });

  it("LETS 8 THEN 9 BOTH LAND — genuine movement is not a repeat", () => {
    const keys = currentClaimKeys([placed("rung-1"), observedLine("rung-1", 8)]);
    expect(keys.has(appendKey(observedLine("rung-1", 9)))).toBe(false);
  });

  it("KEEPS `kind` LOAD-BEARING: the FIRST observation of a known rung is not its placement", () => {
    // An observation shares its rung's id, so an id-only key would read this line as a
    // repeat of the placement already on file and drop it — the whole feature, filtered
    // out by its own dedupe. Asserted as the PROPERTY (the two lines do not collide),
    // never as the key's spelling.
    const placement = placed("rung-1");
    const firstObservation = observedLine("rung-1", 3);
    expect(appendKey(firstObservation)).not.toBe(appendKey(placement));
    expect(currentClaimKeys([placement]).has(appendKey(firstObservation))).toBe(false);
  });

  it("still dedupes a REPEAT PLACEMENT — the id-only reading, unchanged", () => {
    // `synthesizeOrderId` already includes `observedAt`, so keying a placement on
    // `(kind, id, observedAt)` is exactly equivalent to keying on the id alone. This is
    // what makes re-importing an unchanged export append zero lines.
    const keys = currentClaimKeys([placed("rung-1")]);
    expect(keys.has(appendKey(placed("rung-1")))).toBe(true);
  });

  it("HOLDS ONLY THE LATEST OBSERVATION PER RUNG, so a SUPERSEDED figure can be re-asserted", () => {
    // #212's rule, and the defect it fixed. Observe 8, then record a backwards restatement
    // of 5: the venue's next export of 8 is a legitimate RE-ASSERTION, and a whole-history
    // set would drop it as a repeat — nothing lands, and the operator is told
    // `0 observation(s) recorded` about a line this flow had just decided to record.
    const keys = currentClaimKeys([
      placed("rung-1"),
      observedLine("rung-1", 8, "2026-08-07T12:00:00"),
      observedLine("rung-1", 5, "2026-08-07T13:00:00"),
    ]);
    expect(keys.has(appendKey(observedLine("rung-1", 5)))).toBe(true);
    expect(keys.has(appendKey(observedLine("rung-1", 8)))).toBe(false);
  });

  it("BREAKS AN EQUAL-STAMP TIE LAST-WINS (`>=`), in step with `detectChangedClaims`", () => {
    // One export is one look, so a whole batch shares one second-granular stamp and equal
    // stamps are ORDINARY here, not a corner. `detectChangedClaims` scans with `>=` — the
    // last line in file order wins — and that is what decides an observation is worth
    // building at all. Were this to use `>`, one layer would build a line the other
    // refused to write.
    const stamp = "2026-08-07T12:00:00";
    const keys = currentClaimKeys([
      placed("rung-1"),
      observedLine("rung-1", 8, stamp),
      observedLine("rung-1", 5, stamp),
    ]);
    expect(keys.has(appendKey(observedLine("rung-1", 5)))).toBe(true);
    expect(keys.has(appendKey(observedLine("rung-1", 8)))).toBe(false);
  });

  it("scopes the latest-observation rule PER RUNG, not across the file", () => {
    const keys = currentClaimKeys([
      placed("rung-1"),
      placed("rung-2"),
      observedLine("rung-1", 8, "2026-08-07T12:00:00"),
      observedLine("rung-2", 3, "2026-08-07T13:00:00"),
    ]);
    expect(keys.has(appendKey(observedLine("rung-1", 8)))).toBe(true);
    expect(keys.has(appendKey(observedLine("rung-2", 3)))).toBe(true);
  });

  it("reads an EMPTY file as claiming nothing", () => {
    expect(currentClaimKeys([]).size).toBe(0);
  });
});
