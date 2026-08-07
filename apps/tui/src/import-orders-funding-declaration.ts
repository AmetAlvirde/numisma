/**
 * THE DECLARED HALF, PROMPTED — the one field this import asks the operator for, and the
 * two collaborators that render and read the answers (#223).
 *
 * IT LEFT `import-orders.ts` FOR THE REASON #211, #213, #219 AND #221 LEFT IT, with one
 * honest difference: this is not a pure function. It takes the IO bag and awaits
 * `io.ask`, so its test buys a scripted-prompt stub rather than a plain call over a
 * literal. What the extraction buys is the SEAM — the prompt strings and the answer rules
 * become drivable without an export file, a sidecar, a frozen clock or a funding guard.
 *
 * AND THE COVERAGE ARGUMENT IS THE SHARPEST IN THE SERIES. Eight mutations were applied
 * to this cluster and run against the whole 1298-test suite; SEVEN survived. `describe`
 * could be replaced by the constant `"an order"` and every test stayed green — the
 * function that renders each rung to the operator during the override pass was held by
 * nothing at all. So were: the `"yes"` spelling, the case/whitespace normalization, the
 * `answer !== batch` guard that makes a redundant override not an override, the trim on
 * the batch answer, and the `[batch]` default hint in the per-order prompt. Each of those
 * is now named by an assertion in `import-orders-funding-declaration.test.ts` that fails
 * when the thing it names is removed.
 *
 * `isAffirmative` IS DUPLICATED IN `record-fill.ts` AND STAYS THAT WAY. De-duplicating it
 * means choosing a shared home for a TUI-wide prompt primitive — a decision, not a move —
 * so neither module imports the other.
 *
 * THE THREE END-TO-END TESTS STAY WHERE THEY ARE. They hold what no unit test over a
 * stubbed `io` can: that the declaration actually lands on the written record as
 * `fundingReserveId`, that the prompt happens exactly once per batch, and that a blank
 * batch answer writes nothing at all.
 */
import type { BitgetOpenOrder } from "@numisma/engine";
import type { OrdersImportIo } from "./import-orders.js";

/** How one rung is shown when the operator asks to override it. */
function describe(order: BitgetOpenOrder): string {
  return `${order.symbol} ${order.side} ${order.quantity} @ ${order.price} (${order.observedAt})`;
}

function isAffirmative(answer: string): boolean {
  const normalized = answer.trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
}

/**
 * Prompt for the ONE declared field.
 *
 * Once per BATCH, then overridable per order — the granularity is the venue's own
 * argument: a ladder is homogeneous by construction, so eight rungs is one decision
 * copied eight times, and asking eight times is eight chances to disagree with yourself.
 * The per-order pass is opt-in and defaults to the batch answer on a blank line, so the
 * homogeneous case costs exactly one keystroke and the dissenting rung is still
 * expressible.
 */
export async function declareFunding(
  io: OrdersImportIo,
  orders: readonly BitgetOpenOrder[],
): Promise<{ fundingReserveId: string; overrides: Record<string, string> } | undefined> {
  const batch = (await io.ask("Funding reserve for this batch: ")).trim();
  if (batch === "") {
    return undefined;
  }

  const overrides: Record<string, string> = {};
  const wantsOverrides = isAffirmative(
    await io.ask(`Override the funding reserve for any individual order? [y/N] `),
  );
  if (!wantsOverrides) {
    return { fundingReserveId: batch, overrides };
  }

  for (const order of orders) {
    const answer = (await io.ask(`  ${describe(order)} [${batch}]: `)).trim();
    if (answer !== "" && answer !== batch) {
      overrides[order.id] = answer;
    }
  }
  return { fundingReserveId: batch, overrides };
}
