/**
 * THE ATTRIBUTION REFUSAL'S LAYOUT, ASSERTED DIRECTLY — the reason the renderer left
 * `import-orders.ts`.
 *
 * Every rule below was reachable before only by driving a whole import: a temp dir, a CSV
 * written to disk, a seeded sidecar, a frozen clock, a scripted prompt and a synthetic
 * fund review — and each assertion was a `toContain`, a substring found SOMEWHERE in a
 * thirty-line string. The renderer takes two arrays and returns a string, so it is tested
 * as one, and the rules are stated on their own terms.
 *
 * FOUR OF THEM NOTHING HELD AT ALL, and they are the reason this file exists rather than
 * a nicety: the `default: never` fallback (unreachable by types, so no end-to-end fixture
 * can reach it), the ORDER of the sections, the LABEL → ADVICE → RUNGS order inside one,
 * and the 80-column wrap. No test in this suite measured a line length anywhere before
 * this one.
 *
 * THE THREE END-TO-END TESTS IN `import-orders.test.ts` STAY. They hold that this
 * renderer is what the `unattributed` branch actually calls and that its output reaches
 * the operator through `reject()` — a wiring fact no unit test over a pure function can
 * state. What moves here is the LAYOUT, which never needed the apparatus.
 *
 * FIXTURE IDS ARE REALISTIC ON PURPOSE. The renderer's own risk is width, and a real
 * synthesized order id (`bitget:BTCUSDT:buy:1000:2020-01-01T10:00:00`) is the widest
 * thing it indents. Ids invented shorter than the real ones would make the 80-column
 * assertion pass by fixture rather than by the renderer's own wrapping.
 */
import type { CommittedRung, UnmatchedRung } from "@numisma/engine";
import { describe, expect, it } from "vitest";
import { renderUnattributedRefusal } from "./import-orders-unattributed-refusal.js";

/** A real synthesized id, spelled the way `synthesizeOrderId` spells one. */
function orderId(price: string, observedAt = "2020-01-01T10:00:00"): string {
  return `bitget:BTCUSDT:buy:${price}:${observedAt}`;
}

function rung(id: string, fundingReserveId: string, currency: "USD" | "MXN" = "USD"): CommittedRung {
  return {
    orderId: id,
    observedAt: "2020-01-01T10:00:00",
    currency,
    symbol: "BTCUSDT",
    side: "buy",
    price: 1000,
    quantity: 0.1,
    remainingQuantity: 0.1,
    fundingReserveId,
    committed: 100,
  };
}

function unfundable(id: string, fundingReserveId: string): UnmatchedRung {
  return { rung: rung(id, fundingReserveId), reason: "unfundable-reserve" };
}

function mismatched(id: string, fundingReserveId: string): UnmatchedRung {
  return { rung: rung(id, fundingReserveId), reason: "currency-mismatch" };
}

/** Every listed rung is this batch's, so nothing is marked and no legend is owed. */
function allOf(unmatched: readonly UnmatchedRung[]): ReadonlySet<string> {
  return new Set(unmatched.map((entry) => entry.rung.orderId));
}

/** Nothing is this batch's — the whole book came off the sidecar. */
const NONE: ReadonlySet<string> = new Set<string>();

describe("the header — the count the whole refusal is measured against", () => {
  it("counts every unplaceable rung, with the noun agreeing", () => {
    const one = [unfundable(orderId("1000"), "reserve-paper")];
    expect(renderUnattributedRefusal(one, allOf(one))).toContain(
      "1 rung cannot be placed against a fundable reserve.\n",
    );

    const several = [
      unfundable(orderId("1000"), "reserve-paper"),
      unfundable(orderId("1100"), "reserve-paper"),
      mismatched(orderId("1200"), "reserve-mxn"),
    ];
    expect(renderUnattributedRefusal(several, allOf(several))).toContain(
      "3 rungs cannot be placed against a fundable reserve.\n",
    );
  });
});

describe("provenance — which listed rungs are this batch's to re-declare (#202)", () => {
  it("MARKS A RUNG OFF THE SIDECAR AT END-OF-LINE, and prints the legend that explains it", () => {
    // Coverage weighs the WHOLE resting book, so a listed rung need not appear in the
    // export just read. Unmarked, the header count invites a reconciliation against that
    // export which cannot come out even.
    const id = orderId("1000");
    const unmatched = [unfundable(id, "reserve-paper")];

    const refusal = renderUnattributedRefusal(unmatched, NONE);

    expect(refusal).toContain(`        ${id} — on file\n`);
    expect(refusal).toContain(
      'Coverage weighs the WHOLE resting book, so rungs marked "on file" below were\n' +
        "already in the sidecar before this import, not in the export just read.\n",
    );
  });

  it("OMITS BOTH THE MARKER AND THE LEGEND when every rung came out of the export just read", () => {
    // A batch that owes no marker owes no legend for one either — the paragraph is
    // conditional on there being something to explain, not printed unconditionally.
    const id = orderId("1000");
    const unmatched = [unfundable(id, "reserve-paper")];

    const refusal = renderUnattributedRefusal(unmatched, allOf(unmatched));

    expect(refusal).toContain(`        ${id}\n`);
    expect(refusal).not.toContain("— on file");
    expect(refusal).not.toContain("Coverage weighs the WHOLE resting book");
  });

  it("marks per rung, not per batch — a mixed book carries the marker only where it is true", () => {
    const mine = orderId("1000");
    const onFile = orderId("1100");
    const unmatched = [unfundable(mine, "reserve-paper"), unfundable(onFile, "reserve-paper")];

    const refusal = renderUnattributedRefusal(unmatched, new Set([mine]));

    expect(refusal).toContain(`        ${mine}\n`);
    expect(refusal).toContain(`        ${onFile} — on file\n`);
  });
});

describe("the unfundable-reserve section — grouped by RESERVE, because the fix is per reserve", () => {
  it("dedups to reserve ids and counts BOTH reserves and rungs, with agreeing nouns", () => {
    const unmatched = [
      unfundable(orderId("1000"), "reserve-paper"),
      unfundable(orderId("1100"), "reserve-paper"),
      unfundable(orderId("1200"), "reserve-odd"),
    ];

    const refusal = renderUnattributedRefusal(unmatched, allOf(unmatched));

    expect(refusal).toContain("  unfundable reserve — 2 reserves, 3 rungs\n");
  });

  it("says `this reserve` in the singular and `these reserves` in the plural", () => {
    // Two advice paragraphs rather than one with a conditional `s`, because the whole
    // paragraph shifts: "It cannot fund" against "They cannot fund", and "place it"
    // against "place them".
    const one = [unfundable(orderId("1000"), "reserve-paper")];
    expect(renderUnattributedRefusal(one, allOf(one))).toContain(
      "    The fold excluded this reserve: paper execution mode, an unsupported\n" +
        "    currency, or a dangling account reference. It cannot fund a live order,\n" +
        "    and the available-capital report would not be able to place it either.\n",
    );

    const two = [
      unfundable(orderId("1000"), "reserve-paper"),
      unfundable(orderId("1100"), "reserve-odd"),
    ];
    expect(renderUnattributedRefusal(two, allOf(two))).toContain(
      "    The fold excluded these reserves: paper execution mode, an unsupported\n" +
        "    currency, or a dangling account reference. They cannot fund a live order,\n" +
        "    and the available-capital report would not be able to place them either.\n",
    );
  });

  it("lists each reserve in FIRST-APPEARANCE order, its rungs beneath it in the order given", () => {
    // Nothing is sorted: the rungs' own order survives inside each reserve and across the
    // reserves, so what the operator reads is the order the engine handed over. The
    // interleaved fixture is the point — `reserve-odd` first appears BETWEEN two
    // `reserve-paper` rungs, and grouping must not reorder either.
    const first = orderId("1000");
    const middle = orderId("1100");
    const last = orderId("1200");
    const unmatched = [
      unfundable(first, "reserve-paper"),
      unfundable(middle, "reserve-odd"),
      unfundable(last, "reserve-paper"),
    ];

    const refusal = renderUnattributedRefusal(unmatched, allOf(unmatched));

    expect(refusal).toContain(
      `      reserve-paper\n        ${first}\n        ${last}\n` + `      reserve-odd\n        ${middle}`,
    );
  });
});

describe("the currency-mismatch section — PER RUNG, because the fix is per rung", () => {
  it("counts rungs only, and never dedups to a reserve", () => {
    const unmatched = [
      mismatched(orderId("1000"), "reserve-mxn"),
      mismatched(orderId("1100"), "reserve-mxn"),
    ];

    const refusal = renderUnattributedRefusal(unmatched, allOf(unmatched));

    expect(refusal).toContain("  currency mismatch — 2 rungs\n");
    expect(refusal).not.toContain("reserves,");
  });

  it("puts the id ALONE on its line and indents the mismatch beneath it", () => {
    // Not a third layout: it is the shape the unfundable section already uses for a
    // grouping and its rungs. It is also what keeps the "on file" marker at end-of-line —
    // the id plus the clause plus the marker do not fit inside 80 columns on one line.
    const id = orderId("1000");
    const unmatched = [mismatched(id, "reserve-mxn")];

    const refusal = renderUnattributedRefusal(unmatched, NONE);

    expect(refusal).toContain(
      "    Cross-currency funding is not supported; fix the declaration.\n" +
        `      ${id} — on file\n` +
        "        quoted in USD, declared against reserve-mxn",
    );
  });
});

describe("each section is absent when its class is", () => {
  it("renders ONE section for a homogeneous book, and does not name the other class", () => {
    const unmatched = [unfundable(orderId("1000"), "reserve-paper")];

    const refusal = renderUnattributedRefusal(unmatched, allOf(unmatched));

    expect(refusal).toContain("  unfundable reserve — 1 reserve, 1 rung\n");
    expect(refusal).not.toContain("currency mismatch");
  });

  it("renders the mismatch section alone when nothing is unfundable", () => {
    const unmatched = [mismatched(orderId("1000"), "reserve-mxn")];

    const refusal = renderUnattributedRefusal(unmatched, allOf(unmatched));

    expect(refusal).toContain("  currency mismatch — 1 rung\n");
    expect(refusal).not.toContain("unfundable reserve");
  });
});

describe("the closing paragraph — the honest cost of batching, and not droppable", () => {
  it("says the balances were NOT weighed, and ends on a blank line", () => {
    // Batching creates the expectation "I have now been told everything", and without this
    // sentence that expectation is false: `over-committed` never ran, because an
    // unplaceable rung has no balance to weigh. The trailing newline is the blank line
    // before `reject()`'s "Nothing was written to …" tail — without it the tail reads as a
    // continuation of this sentence.
    const unmatched = [unfundable(orderId("1000"), "reserve-paper")];

    const refusal = renderUnattributedRefusal(unmatched, allOf(unmatched));

    expect(refusal.endsWith(
      "Reserve balances were NOT weighed: an unplaceable rung has no balance to\n" +
        "compare against, so a coverage refusal may still follow once every rung\n" +
        "above is placeable.\n",
    )).toBe(true);
  });
});
