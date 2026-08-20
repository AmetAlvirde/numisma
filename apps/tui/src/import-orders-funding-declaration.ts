/**
 * THE DECLARED HALF, PROMPTED — the one field this import asks the operator for, and the
 * two collaborators that render and read the answers (#223).
 *
 * IT LEFT `import-orders.ts` FOR THE REASON #211, #213, #219 AND #221 LEFT IT, with one
 * honest difference: this is not a pure function. It awaits the operator, so its test buys
 * a scripted-prompt stub rather than a plain call over a literal. What the extraction buys
 * is the SEAM — the prompt strings and the answer rules become drivable without an export
 * file, a sidecar, a frozen clock or a funding guard.
 *
 * IT TAKES THE PROMPT CHANNEL, NOT THE IO BAG. `ask` is the only member of
 * `OrdersImportIo` this ever reads, and taking the whole bag cost twice: the type had to
 * be imported BACK from the module this left — the only back-edge among the five
 * extractions, where the other four reach no further than `@numisma/engine` and a peer
 * leaf — and "reads nothing but the prompt channel" could only be held at RUNTIME, by a
 * stub whose other eight members throw on touch. Narrowed to the one function, the
 * compiler holds it and the stub is a closure.
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
 * ONE OF THE SEVEN IS NOT AN OUTPUT RULE, and pretending otherwise would mislead the next
 * reader: the `answer !== batch` guard cannot change a written record, only the shape of
 * the map that feeds it. The argument is at the guard itself.
 *
 * `isAffirmative` IS DUPLICATED IN `record-fill.ts` AND STAYS THAT WAY. De-duplicating it
 * means choosing a shared home for a TUI-wide prompt primitive — a decision, not a move —
 * so neither module imports the other.
 *
 * IT TAKES `Answer`, AND IT NARROWS AT EACH QUESTION RATHER THAN INSIDE `isAffirmative`
 * (#388). The channel resolves `UNANSWERED` for a question nobody could answer, and the
 * tempting move is to widen the helper — `isAffirmative(UNANSWERED) === false` — which
 * compiles, reads fine, and re-creates the exact defect being fixed one layer down: the
 * override question would silently decline, the run would carry on, and the operator who
 * pressed Ctrl-D would still watch a batch be attributed. So the sentinel is checked AT
 * the question, before any helper sees it, because the question is where the refusal
 * belongs. `isAffirmative` keeps its `string` parameter, and the compiler keeps it honest.
 *
 * THE THREE END-TO-END TESTS STAY WHERE THEY ARE. They hold what no unit test over a
 * stubbed `io` can: that the declaration actually lands on the written record as
 * `fundingReserveId`, that the prompt happens exactly once per batch, and that a blank
 * batch answer writes nothing at all.
 */
import type { BitgetOpenOrder } from "@numisma/engine";
import { UNANSWERED, type Answer } from "./prompt-channel.js";

/** How one rung is shown when the operator asks to override it. */
function describe(order: BitgetOpenOrder): string {
  return `${order.symbol} ${order.side} ${order.quantity} @ ${order.price} (${order.observedAt})`;
}

/**
 * An answer as text, with {@link UNANSWERED} read as the empty string.
 *
 * ONLY FOR QUESTIONS THAT ALREADY REFUSE A BLANK. At those, "the operator typed nothing"
 * and "nobody could answer" earn the same refusal in the same words, and collapsing them
 * here is what keeps that refusal exactly where #370 left it. Reaching for this at a
 * question with a DEFAULT would hand the default to a keystroke nobody made, which is the
 * whole defect #388 removes — those questions check the sentinel themselves.
 */
function typedOrNothing(answer: Answer): string {
  return answer === UNANSWERED ? "" : answer.trim();
}

function isAffirmative(answer: string): boolean {
  const normalized = answer.trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
}

/**
 * What the declaration pass produced — declared, declined, or never answered at all.
 *
 * THREE ARMS RATHER THAN `undefined` AND A SECOND CHANNEL (#388). A blank batch answer and
 * an abandoned terminal both used to arrive as `undefined`, and the caller could only
 * refuse them as one thing: `no-reserve-declared`, which tells an operator who pressed
 * Ctrl-D that they typed an empty reserve id. The reason CODES are the flow's existing
 * ones either way — this arm only lets the caller pick the right one.
 */
export type FundingDeclaration =
  | { status: "declared"; fundingReserveId: string; overrides: Record<string, string> }
  /** The operator answered, and what they answered was "no reserve". */
  | { status: "not-declared" }
  /** A question in this pass went unanswered. Nobody declined anything. */
  | { status: "abandoned"; question: string };

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
  ask: (question: string) => Promise<Answer>,
  orders: readonly BitgetOpenOrder[],
): Promise<FundingDeclaration> {
  // THE ONE QUESTION HERE THAT ALREADY REFUSED, AND IT KEEPS ITS REFUSAL. A blank means
  // the operator declared no reserve and the flow refuses as `no-reserve-declared`; an
  // unanswered question declares no reserve either, and lands on the identical arm with
  // the identical words. That is #370's pinned fix — a Ctrl-D at question one reaches the
  // DOMAIN's refusal rather than a readline internal — and #388 does not get to move it.
  const batch = typedOrNothing(await ask("Funding reserve for this batch: "));
  if (batch === "") {
    return { status: "not-declared" };
  }

  const overrides: Record<string, string> = {};
  // A RATIFICATION, AND THE REASON THE SENTINEL EXISTS. A blank declines the override pass
  // and the batch answer stands for every rung — fine, the operator typed it. UNANSWERED
  // declines nothing: it means the operator walked away one question after naming a
  // reserve, which is precisely the moment they were most likely taking it back.
  const wantsOverridesAnswer = await ask(
    `Override the funding reserve for any individual order? [y/N] `,
  );
  if (wantsOverridesAnswer === UNANSWERED) {
    return { status: "abandoned", question: "whether to override the reserve per order" };
  }
  if (!isAffirmative(wantsOverridesAnswer)) {
    return { status: "declared", fundingReserveId: batch, overrides };
  }

  for (const order of orders) {
    const reply = await ask(`  ${describe(order)} [${batch}]: `);
    // A blank takes the batch answer, so UNANSWERED cannot be allowed to: that default is
    // a durable `fundingReserveId` on the rung's own line.
    if (reply === UNANSWERED) {
      return { status: "abandoned", question: `the funding reserve for ${describe(order)}` };
    }
    const answer = reply.trim();
    // A REDUNDANT OVERRIDE IS NOT AN OVERRIDE — and this guard is a SHAPE rule, not an
    // output rule, which is worth saying because the difference is invisible downstream.
    // `buildOrderPlacedRecords` resolves attribution as
    // `overrides?.[order.id] ?? fundingReserveId` (`packages/engine/src/orders/ingest.ts`),
    // so an entry whose value equals the batch answer writes the IDENTICAL record either
    // way. What the guard keeps is the map's meaning: a key here says the operator
    // DISSENTED on that rung, and a rung they answered the batch back on did not.
    if (answer !== "" && answer !== batch) {
      overrides[order.id] = answer;
    }
  }
  return { status: "declared", fundingReserveId: batch, overrides };
}
