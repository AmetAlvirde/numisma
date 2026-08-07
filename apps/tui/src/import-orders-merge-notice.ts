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
 * The operator-facing line for one merged claim — FIRST-CLASS output, not an aside.
 *
 * Two rows the venue rendered under one id have been summed, and the operator is owed
 * the whole arithmetic: which rung, at what second, both sizes, the total that will be
 * written, and the remedy if the two were meant to stay distinct claims.
 */
export function describeMerge(merge: MergedOrderClaim): string {
  return (
    `MERGED — ${merge.symbol} ${merge.side} at ${merge.price}, submitted ${merge.observedAt}: ` +
    `${merge.quantities.length} rows sharing one id (${merge.quantities.join(" + ")}) were ` +
    `summed into ONE claim of ${merge.mergedQuantity}. The venue's export carries no order ` +
    `id, and these rows agree on every field identity is built from, so the sum is the only ` +
    `reading that neither invents a second claim nor frees committed capital. To keep two ` +
    `rungs distinct, re-place one a tick apart so their prices differ.`
  );
}
