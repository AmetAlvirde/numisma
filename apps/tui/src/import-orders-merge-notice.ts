/**
 * THE MERGE NOTICE — the operator's only word that two export rows sharing one
 * synthesized id were summed into a single claim (#174, #221).
 *
 * IT LEFT `import-orders.ts` FOR THE REASON #211, #213 AND #219 LEFT IT, and for one
 * sharper reason of its own. The others were rules that could only be exercised through
 * a whole import; this one had a test whose assertions did not hold what its title
 * claimed. `toContain("1")` and `toContain("2")`, named in that test as "both
 * quantities", were satisfied by the price `1000` and by the `2020` in the stamp — and
 * deleting the quantities, the symbol and the side from this string left it green. The
 * function takes one plain record and returns a string; none of the temp dir, the CSV on
 * disk, the seeded sidecar or the scripted prompt behind that test is what its rules are
 * about.
 *
 * WHAT THE EXTRACTION BUYS, now asserted in `import-orders-merge-notice.test.ts`: both
 * quantities rendered as the `a + b` arithmetic rather than merely present; the merged
 * total; the symbol; the side; the price; the stamp; the remedy; the agreement between
 * the row COUNT and the listing it counts — two different fields, rendered a clause
 * apart, that nothing held together; and the three-or-more-row collision that
 * `mergeCollidingClaims` sums but no fixture in this repo had ever built.
 *
 * THE END-TO-END TEST STAYS WHERE IT IS, narrowed to the WIRING — that the merge branch
 * calls this and that its output reaches the operator on the `out` channel. That is a
 * fact about `import-orders.ts`, and no unit test over a pure function can make it.
 */
import type { MergedOrderClaim } from "@numisma/engine";

/**
 * The operator-facing notice for one merged claim — FIRST-CLASS output, not an aside.
 *
 * Two rows the venue rendered under one id have been summed, and the operator is owed
 * the whole arithmetic: which rung, at what second, both sizes, the total that will be
 * written, and the remedy if the two were meant to stay distinct claims.
 *
 * WRAPPED, WHICH IT WAS NOT (#221). This emitted ONE unbroken ~450-character line, so
 * every terminal soft-wrapped it at a column nothing here chose — mid-word, mid-number,
 * and differently on every screen. The budget is 100 and the prose is hard-wrapped at
 * 88, the same target `renderUnattributedRefusal` now uses, so the two renderers of this
 * flow do not disagree about how wide the operator's terminal is.
 *
 * THE FIRST THREE LINES ARE THE VARIABLE ONES and the last three are fixed prose. The
 * header carries the symbol, the side, the price and the stamp; the second carries the
 * row count and EVERY quantity; the third carries the total.
 *
 * THE TOTAL IS ON ITS OWN LINE BECAUSE THE LISTING ABOVE IT IS UNBOUNDED. `quantities`
 * has no ceiling — six rows at four decimals measures 113 columns, past any budget a
 * terminal offers — so no wrap width can promise that line fits. What CAN be promised is
 * which line pays for the overflow: with the listing and the total on one line, a wide
 * collision soft-wraps away the single number the operator most needs; split, the worst
 * case soft-wraps a list of sizes the operator can still read, and `ONE claim of N`
 * arrives intact every time.
 *
 * THE REMEDY GETS ITS OWN LINE, because it is the one sentence here that asks the
 * operator to DO something. Everything above it explains a decision already applied.
 */
export function describeMerge(merge: MergedOrderClaim): string {
  return (
    `MERGED — ${merge.symbol} ${merge.side} at ${merge.price}, submitted ${merge.observedAt}:\n` +
    `${merge.quantities.length} rows sharing one id (${merge.quantities.join(" + ")})\n` +
    `were summed into ONE claim of ${merge.mergedQuantity}.\n` +
    `The venue's export carries no order id, and these rows agree on every field identity is\n` +
    `built from, so the sum is the only reading that neither invents a second claim nor frees\n` +
    `committed capital.\n` +
    `To keep two rungs distinct, re-place one a tick apart so their prices differ.`
  );
}
