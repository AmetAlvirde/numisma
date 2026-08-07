/**
 * THE APPEND FILTER'S RULE — what makes a line a REPEAT of one already on file, in the
 * two halves the question actually has (#181, #212).
 *
 * BOTH HALVES LEFT `import-orders.ts` TOGETHER, and that is a decision worth recording
 * rather than an accident of what was easy to cut. #213 named {@link appendKey} alone,
 * while observing that the key-set built beside it is "arguably the same seam", and it
 * was deliberately sequenced AFTER #212 because #212 would settle which side of that
 * seam the interesting rule lived on. #212 settled it against the key: the rule went
 * into WHAT THE SET IS BUILT FROM — the latest observation per rung rather than the
 * whole history — and the key was left exactly as it was. So the half carrying the rule
 * is {@link currentClaimKeys}, and extracting the key on its own would have moved the
 * assertable half out and left the interesting half behind an end-to-end import with an
 * injected IO bag. That is the whole point of the extraction, so the pair moves.
 *
 * TWO QUESTIONS, ONE PER EXPORT, and the split between them is the module's shape:
 *
 *   - {@link appendKey} answers *"is this figure already recorded?"* — everything a pure
 *     function of ONE record can answer, since nothing in a record says what came after
 *     it.
 *   - {@link currentClaimKeys} answers *"is this figure still the rung's CURRENT
 *     claim?"* — which needs the whole stream, and so is the only place it can be asked.
 *
 * THE CALLER STILL OWNS THE FILTER. `importBitgetOpenOrders` builds the set once and
 * runs `[...records, ...observations].filter(...)` itself, for the reason its own
 * comment gives: one set over both arrays in a single pass, so re-keying per record
 * buys nothing and costs a quadratic pass.
 */
import type { OrderFillObservedRecord, OrderRecord } from "@numisma/engine";

/**
 * THE APPEND FILTER'S KEY — what makes a line a REPEAT of one already on file (#181).
 *
 * KEYED ON WHAT THE LINE ASSERTS, not on when it was looked at, and the two kinds assert
 * different things:
 *
 *   - `orderFillObserved` → `(kind, id, observedFilledQuantity)`. Two observations of the
 *     same cumulative figure are the SAME FACT stated twice and dedupe; 8 then 9 are
 *     genuine movement and both land.
 *   - everything else → `(kind, id, observedAt)`. For a placement this is exactly
 *     equivalent to keying on the id alone, since `synthesizeOrderId` already includes
 *     `observedAt`, so repeat-placement dedupe is unchanged.
 *
 * WHY NOT `observedAt` FOR AN OBSERVATION, which is what an id-and-stamp key would give.
 * One export is one look, so a whole batch shares one second-granular stamp — and two
 * imports inside the SAME second would then key identically, so the second import's
 * observation was silently dropped while the operator was told it was RECORDED and a
 * successful status came back. Honesty and information loss rather than money loss, and
 * ordinary to reach: two exports back to back, or any scripted loop.
 *
 * MILLISECOND PRECISION WAS REJECTED as the fix, not overlooked. `isObservedAtStamp`
 * validates `YYYY-MM-DDTHH:MM:SS`, the stamp is string-compared across the whole repo and
 * is a component of a durable event id — and milliseconds only SHRINK the collision
 * window rather than closing it, while keying on the figure closes it.
 *
 * THE EQUAL STAMPS ARE FINE DOWNSTREAM. `pickRestingOrdersAsOf` sorts stably, so file
 * order breaks the tie and replays 8 then 9 — the batch stamp's own argument working as
 * written.
 *
 * WHY `kind` IS IN THE KEY AT ALL: an observation shares its rung's id, so an id-only key
 * would read the first observation of a known rung as a repeat of its placement line and
 * drop it — the whole feature, filtered out by its own dedupe.
 *
 * ONE OF TWO QUESTIONS, AND THE CALL SITE ANSWERS THE OTHER. This key answers *"is this
 * figure already recorded?"* — all a pure function of ONE record can answer, since nothing
 * in a record says what came after it. *"Is this figure still the rung's CURRENT claim?"*
 * is answered where it can be: the filter builds its set from the LATEST observation per
 * rung rather than from every existing record, so a superseded figure no longer filters a
 * legitimate re-assertion of it. Keep the scoping there; widening this key to reach for
 * history would only move the second question somewhere it still cannot be answered.
 */
export function appendKey(record: OrderRecord): string {
  return record.kind === "orderFillObserved"
    ? `${record.kind} ${record.id} ${record.observedFilledQuantity}`
    : `${record.kind} ${record.id} ${record.observedAt}`;
}

/**
 * THE SET IS THE RUNG'S CURRENT CLAIM, NOT ITS WHOLE HISTORY (#212). `appendKey` is a
 * pure function of ONE record and structurally cannot see what came after it, so it can
 * only answer *"is this figure already recorded?"*; what the filter must answer is *"is
 * this figure still the rung's CURRENT claim?"*. The scoping therefore lives HERE, in
 * what the set is built from, and the key is left alone.
 *
 * The two questions part company the moment one observation supersedes another: observe
 * 8, record a backwards restatement of 5, and the venue's next export of 8 is a
 * legitimate RE-ASSERTION that a whole-history set drops as a repeat. Nothing lands —
 * and the report describes the lines that were WRITTEN, so the operator is told
 * `0 observation(s) recorded` about an observation this flow had just decided to record.
 *
 * ONLY THE LATEST OBSERVATION PER RUNG goes in, by the SAME last-wins-by-stamp rule
 * `detectChangedClaims` uses — `>=`, so the last line in file order wins an equal-stamp
 * tie. That function is what decides an observation is worth building; were the two to
 * disagree about which figure is current, one layer would build a line the other refused
 * to write. Every other kind goes in whole, which for a placement is equivalent to
 * keying on the id alone, since `synthesizeOrderId` already includes `observedAt`.
 */
export function currentClaimKeys(existingRecords: readonly OrderRecord[]): ReadonlySet<string> {
  const latestObserved = new Map<string, OrderFillObservedRecord>();
  const currentOnFile = new Set<string>();
  for (const record of existingRecords) {
    if (record.kind !== "orderFillObserved") {
      currentOnFile.add(appendKey(record));
      continue;
    }
    const seen = latestObserved.get(record.id);
    if (seen === undefined || record.observedAt >= seen.observedAt) {
      latestObserved.set(record.id, record);
    }
  }
  for (const record of latestObserved.values()) {
    currentOnFile.add(appendKey(record));
  }
  return currentOnFile;
}
