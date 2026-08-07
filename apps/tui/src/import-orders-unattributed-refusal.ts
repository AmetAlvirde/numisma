/**
 * THE ATTRIBUTION REFUSAL, RENDERED — every rung the engine could not place, in the one
 * message the operator gets (#179, #202).
 *
 * IT LEFT `import-orders.ts` FOR THE REASON #211 AND #213 LEFT IT: not length, but that a
 * correct rule could only be exercised through a WHOLE IMPORT. The three tests that
 * stood behind this renderer bought their assertions with a temp dir, a CSV on disk, a
 * seeded sidecar, a frozen clock, a scripted prompt and a synthetic fund review — and
 * every one of them was a `toContain`, a substring found SOMEWHERE in a thirty-line
 * string. The function takes two arrays and returns a string; none of that apparatus is
 * what its rules are about.
 *
 * FOUR RULES NOTHING COULD HOLD THROUGH THAT APPARATUS, and they are what the extraction
 * bought: the `default: never` fallback below (unreachable by types, so no end-to-end
 * fixture can reach it), the ORDER of the sections, the LABEL → ADVICE → RUNGS order
 * inside one, and the 80-column wrap the closing paragraph is wrapped for. All four are
 * argued in the docstring below and now asserted in
 * `import-orders-unattributed-refusal.test.ts`.
 *
 * THE THREE END-TO-END TESTS STAY WHERE THEY ARE. They hold the WIRING — that the
 * `unattributed` branch calls this and that its output reaches the operator through
 * `reject()` — which is a fact about `import-orders.ts`, not about this string.
 */
import type { UnmatchedRung } from "@numisma/engine";
import { plural } from "./plural.js";

/**
 * THE WHOLE ATTRIBUTION REFUSAL, IN ONE PASS — every rung the engine could not place,
 * grouped by the class whose remedy it shares (#179).
 *
 * Reading order inside a section is LABEL → ADVICE → RUNGS, and the ordering is load
 * bearing rather than cosmetic. Advice last orphans it: with two unfundable reserves it
 * sits directly under the second reserve's rungs and reads as advice about that reserve
 * alone, which is what the prototype exposed and the grill's one-reserve example could
 * not. Advice under the label plainly governs everything beneath it.
 *
 * GRANULARITY IS THE ENGINE'S, NOT A RENDERING TASTE, and the two classes differ because
 * their remedies do. `unfundable-reserve` dedups to RESERVE IDS with its rungs listed
 * beneath — one declaration fix clears every rung against that reserve. `currency-mismatch`
 * stays PER RUNG — the fix is per rung. That is the same split the guard used to make in
 * the engine, moved to where it belongs: the engine now forwards every rung of both
 * classes and narrows nothing (see `FundingCoverage`).
 *
 * EACH SECTION IS ABSENT WHEN ITS CLASS IS, so a homogeneous batch renders one section.
 * `over-committed` cannot join them, because an unplaceable rung has no balance to weigh —
 * which is exactly what the closing line says, and why that line is not droppable.
 * Batching creates the expectation *"I have now been told everything"*, and without that
 * sentence the expectation is false.
 *
 * WHICH IS ALSO WHY THE PARTITION IS A SWITCH AND NOT TWO FILTERS. The header counts off
 * `unmatched.length` while the body lists only what the partition matched, so under two
 * `.filter` calls a third {@link UnmatchedReason} was COUNTED AND NEVER NAMED — and with a
 * homogeneous batch of it, `sections` was empty and the refusal named ZERO rungs while
 * claiming one could not be placed. That is #179's masking defect rebuilt at the render
 * boundary, and splitting `unfundable-reserve` into its three causes — paper mode,
 * unsupported currency, dangling account — is a change `UnmatchedReason` needs no new
 * shape for, so the premise is a live one.
 *
 * TWO LAYERS NOW STOP IT, AND ONLY ONE OF THEM IS THE FIX. The `never` assignment makes a
 * new member a `pnpm typecheck` failure AT THIS SITE — that is the fix, and it is the only
 * thing that catches the omission before an operator does. The fallback section is what
 * the output degrades to if one ever arrives here unhandled anyway: named under its raw
 * token rather than swallowed, so the count and the listing still agree.
 */
export function renderUnattributedRefusal(
  unmatched: readonly UnmatchedRung[],
  batchIds: ReadonlySet<string>,
): string {
  const unfundable: UnmatchedRung[] = [];
  const mismatched: UnmatchedRung[] = [];
  // Raw reason token → the rungs carrying it. Empty in every reachable state.
  const unclassified = new Map<string, string[]>();
  for (const entry of unmatched) {
    switch (entry.reason) {
      case "unfundable-reserve":
        unfundable.push(entry);
        break;
      case "currency-mismatch":
        mismatched.push(entry);
        break;
      default: {
        const _never: never = entry.reason;
        // It does NOT throw, unlike `foldEvents`'s latch. The message IS the deliverable
        // here, and `import-orders-cli.ts` would collapse a throw into one bare error
        // line — losing every rung the operator was owed, to protect them from a
        // rendering gap. Degrade the section, never the refusal.
        const token: string = _never;
        const existing = unclassified.get(token);
        if (existing) existing.push(entry.rung.orderId);
        else unclassified.set(token, [entry.rung.orderId]);
      }
    }
  }

  // PROVENANCE, PER RUNG (#202 review). `O1` weighs the WHOLE resting book — the sidecar's
  // existing records plus this batch — so a listed rung need not appear anywhere in the
  // export the operator just read. Unmarked, the count invited a reconciliation against
  // that export which could not come out even. The marker is short because these lines
  // already carry a synthesized id and would wrap; the header spells out what it means.
  // It marks the LINE, not the id: a marker wedged between an id and the clause that
  // follows it reads as part of that clause rather than as a note about the rung. Keeping
  // the marker at end-of-line is why the currency-mismatch section puts the id alone on
  // its line and indents the mismatch beneath it — end-of-line and inside 80 columns are
  // both wanted, and the id plus the clause plus the marker do not fit one line.
  const mark = (line: string, orderId: string): string =>
    batchIds.has(orderId) ? line : `${line} — on file`;
  const anyOnFile = unmatched.some((entry) => !batchIds.has(entry.rung.orderId));

  const sections: string[] = [];

  if (unfundable.length > 0) {
    // First-appearance order, so the rungs' own order survives inside each reserve and
    // across the reserves — the grouping is stable, and nothing is sorted.
    const byReserve = new Map<string, string[]>();
    for (const entry of unfundable) {
      const existing = byReserve.get(entry.rung.fundingReserveId);
      if (existing) existing.push(entry.rung.orderId);
      else byReserve.set(entry.rung.fundingReserveId, [entry.rung.orderId]);
    }
    const many = byReserve.size !== 1;
    const advice = many
      ? `    The fold excluded these reserves: paper execution mode, an unsupported\n` +
        `    currency, or a dangling account reference. They cannot fund a live order,\n` +
        `    and the available-capital report would not be able to place them either.`
      : `    The fold excluded this reserve: paper execution mode, an unsupported\n` +
        `    currency, or a dangling account reference. It cannot fund a live order,\n` +
        `    and the available-capital report would not be able to place it either.`;
    const listing = [...byReserve].map(
      ([reserveId, orderIds]) =>
        `      ${reserveId}\n` +
        `${orderIds.map((orderId) => mark(`        ${orderId}`, orderId)).join("\n")}`,
    );
    sections.push(
      `  unfundable reserve — ${plural(byReserve.size, "reserve")}, ` +
        `${plural(unfundable.length, "rung")}\n${advice}\n${listing.join("\n")}`,
    );
  }

  if (mismatched.length > 0) {
    // Id on its own line, its mismatch indented beneath — the shape the unfundable section
    // already uses for a grouping and its rungs, rather than a third layout for this one.
    const listing = mismatched.map(
      (entry) =>
        `${mark(`      ${entry.rung.orderId}`, entry.rung.orderId)}\n` +
        `        quoted in ${entry.rung.currency}, declared against ` +
        `${entry.rung.fundingReserveId}`,
    );
    sections.push(
      `  currency mismatch — ${plural(mismatched.length, "rung")}\n` +
        `    Cross-currency funding is not supported; fix the declaration.\n` +
        `${listing.join("\n")}`,
    );
  }

  for (const [token, orderIds] of unclassified) {
    // No advice line: nothing here knows the remedy for a reason it does not know. The
    // token and the rungs are what can be said honestly, and they are enough to report.
    sections.push(
      `  ${token} — ${plural(orderIds.length, "rung")}\n` +
        `    This refusal has no section for that reason; it is named as the engine\n` +
        `    gave it, so no rung counted above goes unlisted.\n` +
        `${orderIds.map((orderId) => mark(`      ${orderId}`, orderId)).join("\n")}`,
    );
  }

  return (
    `${plural(unmatched.length, "rung")} cannot be placed against a fundable reserve.\n` +
    // Only when there is something to explain: a batch whose every unplaceable rung came
    // out of the export just read owes the operator no marker and no legend for one.
    (anyOnFile
      ? `Coverage weighs the WHOLE resting book, so rungs marked "on file" below were\n` +
        `already in the sidecar before this import, not in the export just read.\n`
      : ``) +
    `\n` +
    `${sections.join("\n\n")}\n\n` +
    // Wrapped at 72/71/19 rather than 80/83 (#202 review). Every other line this renderer
    // emits sits inside 76, and these two were the only ones that did not — so on an
    // 80-column terminal the one paragraph that admits what the operator has NOT been told
    // was also the one paragraph that wrapped, which is the worst place to spend the
    // reader's attention.
    `Reserve balances were NOT weighed: an unplaceable rung has no balance to\n` +
    `compare against, so a coverage refusal may still follow once every rung\n` +
    `above is placeable.\n`
    // That trailing newline is the blank line before `reject()`'s "Nothing was written to
    // …" tail. Without it the tail reads as a continuation of the balances sentence —
    // invisible when the body was one paragraph, plainly wrong now that it is several.
  );
}
