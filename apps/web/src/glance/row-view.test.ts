/**
 * Below the tap: per-row provenance and named-reference deltas (PRD #146 slice
 * #151).
 *
 * Two claims, and the second is the one D4 is actually about:
 *
 *  1. A row the push suppressed renders as ABSENT — not as zero, not as a stale
 *     number, and not silently missing from the table. The invariant is the header's,
 *     one altitude down: *if I see a number, it is a correct one.*
 *  2. Every delta names its reference. ONE FEATURE, TWO REFERENCE KINDS — a resolved
 *     anchor date or cost basis — which is what makes unrealized P&L and a period
 *     change the same feature rather than two, and what makes YoY / MoM / vs-weekly-
 *     close a parameter rather than a rewrite.
 *
 * Anchors here are the committed fixture's, deliberately mutated: the shapes are the
 * real fold's even where the values are invented.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SnapshotAnchor } from "../projection/contract.ts";
import { loadAnchorFixture } from "../push/anchor-fixture.ts";
import { composeBigPicture } from "./row-view.ts";

async function fixture(): Promise<SnapshotAnchor[]> {
  return structuredClone(await loadAnchorFixture());
}

/** Anchors up to and including `asOf` — what the surface could have known that day. */
async function historyThrough(asOf: string): Promise<SnapshotAnchor[]> {
  const anchors = await fixture();
  const cut = anchors.findIndex((anchor) => anchor.asOf === asOf);
  expect(cut, `the fixture holds no ${asOf}`).toBeGreaterThanOrEqual(0);
  return anchors.slice(0, cut + 1);
}

/** Every row id the anchor's payload carries, in page order. */
function rowIds(anchor: SnapshotAnchor): string[] {
  return anchor.report.dashboard.sections.flatMap((s) => s.rows.map((r) => r.id));
}

describe("a clean anchor — every row renders, every delta names its reference", () => {
  it("resolves ONE date reference for the whole page and names it", async () => {
    const anchors = await historyThrough("2026-07-27");
    const view = composeBigPicture(anchors[anchors.length - 1]!, anchors);

    // V3: the date landed on, never the date asked for, and always rendered.
    expect(view.reference).toEqual({ asOf: "2026-07-26", label: "Sun 26 Jul" });
    // The cost-basis reference is the OTHER kind of the same feature, and it is
    // named too — never an implied "vs today".
    expect(view.costBasisLabel).toBe("cost basis");
  });

  it("renders every row, with both deltas where the inputs exist", async () => {
    const anchors = await historyThrough("2026-07-27");
    const latest = anchors[anchors.length - 1]!;
    const view = composeBigPicture(latest, anchors);

    expect([...view.rows.keys()].sort()).toEqual([...rowIds(latest)].sort());
    for (const rowId of rowIds(latest)) {
      expect(view.rows.get(rowId)!.rendered, rowId).toBe(true);
    }

    // A row with a cost basis carries the cost-basis delta; the number is the
    // difference against the NAMED reference, not a re-labelled `unrealizedPnlUsd`.
    const row = latest.report.dashboard.sections
      .flatMap((s) => s.rows)
      .find((r) => r.costBasisUsd !== undefined)!;
    const delta = view.rows.get(row.id)!.vsCostBasis;
    expect(delta.rendered).toBe(true);
    expect(delta.usdValue).toBeCloseTo(row.usdValue - row.costBasisUsd!, 6);
    expect(delta.percent).toBeCloseTo(
      (row.usdValue / row.costBasisUsd! - 1) * 100,
      6,
    );
  });

  it("computes the date delta against the SAME row in the reference anchor", async () => {
    const anchors = await historyThrough("2026-07-27");
    const latest = anchors[anchors.length - 1]!;
    const previous = anchors[anchors.length - 2]!;
    const view = composeBigPicture(latest, anchors);

    const row = latest.report.dashboard.sections[0]!.rows[0]!;
    const before = previous.report.dashboard.sections
      .flatMap((s) => s.rows)
      .find((r) => r.id === row.id)!;
    const delta = view.rows.get(row.id)!.vsAnchor;
    expect(delta.rendered).toBe(true);
    expect(delta.usdValue).toBeCloseTo(row.usdValue - before.usdValue, 6);
  });
});

describe("a row missing its cost basis suppresses ONLY its own delta", () => {
  it("names the cause, and leaves the row and its date delta standing", async () => {
    // Spec open question 3, answered systematically: SIX rows across the real fold
    // carry neither a cost basis nor a P&L — `instrument:reserve`, `tempo:Reserve`,
    // `tempo:Foresight` and three cash accounts — because they hold nothing but
    // cash, and the engine omits a key whose sum is exactly zero. A seventh
    // (`tier:c3`) carries a cost basis with NO P&L beside it. This is the shape the
    // feature has to survive, and it is the real fold's, not a hypothetical.
    const anchors = await historyThrough("2026-07-27");
    const latest = anchors[anchors.length - 1]!;
    const view = composeBigPicture(latest, anchors);

    const cashRow = latest.report.dashboard.sections
      .flatMap((s) => s.rows)
      .find((r) => r.costBasisUsd === undefined)!;
    expect(cashRow, "the fixture must still hold a row with no cost basis").toBeDefined();

    const row = view.rows.get(cashRow.id)!;
    expect(row.rendered).toBe(true);
    expect(row.vsCostBasis.rendered).toBe(false);
    expect(row.vsCostBasis.suppressedBy).toBe("no-cost-basis");
    // ONLY its own delta: the row's value and its date delta are untouched.
    expect(row.vsAnchor.rendered).toBe(true);
  });
});

describe("the genesis anchor — no earlier anchor to name", () => {
  it("suppresses every date delta and renders no reference", async () => {
    const anchors = await historyThrough("2026-06-26");
    const view = composeBigPicture(anchors[0]!, anchors);

    expect(view.reference).toBeUndefined();
    for (const [rowId, row] of view.rows) {
      if (row.rendered) {
        expect(row.vsAnchor.suppressedBy, rowId).toBe("no-earlier-anchor");
      }
    }
  });
});

describe("per-row suppression, rendered as absence", () => {
  /** Suppress `rowId` on an anchor exactly as the push would. */
  function suppress(anchor: SnapshotAnchor, ...rowIdsToSuppress: string[]): void {
    anchor.report.glance.suppressed.push(...rowIdsToSuppress);
  }

  it("renders a suppressed row as absent, with BOTH deltas gone", async () => {
    const anchors = await historyThrough("2026-07-27");
    const latest = anchors[anchors.length - 1]!;
    const [poisoned, spared] = rowIds(latest);
    suppress(latest, poisoned!);
    const view = composeBigPicture(latest, anchors);

    const absent = view.rows.get(poisoned!)!;
    expect(absent.rendered).toBe(false);
    expect(absent.suppressedBy).toBe("unexpected-absence");
    // A suppressed row must not leak its number through a delta computed from it.
    expect(absent.vsAnchor.rendered).toBe(false);
    expect(absent.vsCostBasis.rendered).toBe(false);
    expect(absent.vsAnchor.usdValue).toBeUndefined();
    expect(absent.vsCostBasis.usdValue).toBeUndefined();

    // And the rows that were not suppressed are untouched — per-row, as the header
    // suppression is per-number.
    expect(view.rows.get(spared!)!.rendered).toBe(true);
  });

  it("withholds a date delta whose REFERENCE row was suppressed", async () => {
    // Composition rule 1 at row altitude: a comparative number declines when its own
    // reference is withheld. The row itself is fine today; the comparison is not.
    const anchors = await historyThrough("2026-07-27");
    const latest = anchors[anchors.length - 1]!;
    const reference = anchors[anchors.length - 2]!;
    const rowId = rowIds(latest)[0]!;
    suppress(reference, rowId);
    const view = composeBigPicture(latest, anchors);

    const row = view.rows.get(rowId)!;
    expect(row.rendered).toBe(true);
    expect(row.vsAnchor.rendered).toBe(false);
    expect(row.vsAnchor.suppressedBy).toBe("reference-withheld");
    // The cost-basis reference is a DIFFERENT reference and is unaffected — which is
    // the practical payoff of the two-reference-kind architecture.
    expect(row.vsCostBasis.rendered).toBe(true);
  });

  it("withholds a date delta for a row the reference anchor never had", async () => {
    const anchors = await historyThrough("2026-07-27");
    const latest = anchors[anchors.length - 1]!;
    const reference = anchors[anchors.length - 2]!;
    const rowId = rowIds(latest)[0]!;
    for (const section of reference.report.dashboard.sections) {
      section.rows = section.rows.filter((r) => r.id !== rowId);
    }
    const view = composeBigPicture(latest, anchors);

    expect(view.rows.get(rowId)!.vsAnchor.rendered).toBe(false);
    expect(view.rows.get(rowId)!.vsAnchor.suppressedBy).toBe("no-reference-row");
  });

  it("suppresses the % of fund COLUMN whenever NAV is suppressed", async () => {
    // THE ONE THING PER-ROW SUPPRESSION ALONE WOULD GET WRONG. `percentOfFund` has
    // NAV in its denominator, so an unexpected absence anywhere makes EVERY row's
    // percentage wrong — including the rows whose own value is fine. This is D7's
    // corrected illustration exactly (Reserve % is a ratio whose denominator is NAV),
    // applied to the table: the value column survives per-row, the percentage column
    // does not survive at all.
    const anchors = await historyThrough("2026-07-27");
    const latest = anchors[anchors.length - 1]!;
    expect(composeBigPicture(latest, anchors).percentOfFundRendered).toBe(true);

    latest.report.glance.suppressed.push("summary.fundValueUsd");
    const view = composeBigPicture(latest, anchors);
    expect(view.percentOfFundRendered).toBe(false);
    // …and the rows themselves still stand: a suppressed NAV is not a suppressed row.
    expect(view.rows.get(rowIds(latest)[0]!)!.rendered).toBe(true);
  });

  it("withholds the FUND VALUE ITSELF, as a fact of its own", async () => {
    // THE ALTITUDE TRAP, stated so it cannot be re-collapsed later. This is the same
    // boolean as `percentOfFundRendered` today by coincidence of CAUSE, not of
    // MEANING: one governs the NAV slot on the card, the other a column of ratios
    // that merely happen to share NAV as a denominator. Naming the NAV slot after the
    // percentage column would bake the coincidence in, and the first cause that took
    // one without the other would find the surface lying. Two facts, one check.
    const anchors = await historyThrough("2026-07-27");
    const latest = anchors[anchors.length - 1]!;
    expect(composeBigPicture(latest, anchors).fundValueRendered).toBe(true);

    latest.report.glance.suppressed.push("summary.fundValueUsd");
    expect(composeBigPicture(latest, anchors).fundValueRendered).toBe(false);
  });
});

describe("the real history, after the push learned to suppress rows", () => {
  it("suppresses rows on the outage anchors and none on the quiet ones", async () => {
    // The fixture is the real fold's `glance` block verbatim, so this is a statement
    // about the FUND: on the five feed-gap days the poisoned rows are named, and on
    // the days every mark arrived nothing is.
    const anchors = await fixture();
    const outage = anchors.find((a) => a.asOf === "2026-06-30")!;
    const quiet = anchors.find((a) => a.asOf === "2026-07-26")!;

    const rowKeys = (anchor: SnapshotAnchor): string[] =>
      anchor.report.glance.suppressed.filter((key) => !key.startsWith("summary."));

    expect(rowKeys(outage).length).toBeGreaterThan(0);
    expect(rowKeys(quiet)).toEqual([]);
    // Every suppressed key names a row the anchor actually carries.
    const carried = new Set(rowIds(outage));
    for (const key of rowKeys(outage)) expect([...carried], key).toContain(key);
    // And it is not the whole table: a per-row suppression that took every row would
    // be a whole-page blackout wearing per-row clothes.
    expect(rowKeys(outage).length).toBeLessThan(carried.size);
  });
});

/**
 * The component wiring, asserted at SOURCE level — the same precedent and the same
 * limitation `route-move.test.ts` records: this repo has no RTL toolchain and this
 * increment deliberately does not add one (docs/coverage-rationale.md §6). What is
 * asserted is the part that can regress SILENTLY — the surface quietly going back to
 * rendering three columns off the raw payload, or a suppressed row rendering its
 * number anyway. The reader must open the page to judge the layout; nothing here
 * pretends otherwise.
 */
describe("the /big-picture wiring", () => {
  const read = (file: string) =>
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", file), "utf-8");

  it("composes the view once, from the anchor history", () => {
    const page = read("routes/big-picture.tsx");
    expect(page).toMatch(/composeBigPicture\(latest, anchors\)/);
    // It passes the view down rather than re-deriving it per table, so all five
    // sections name the same reference.
    expect(page).toMatch(/<SectionTable[\s\S]*?view=\{view\}/);
  });

  it("renders absence through the em dash, never a zero", () => {
    const table = read("components/SectionTable.tsx");
    expect(table).toMatch(/—/);
    expect(table).toMatch(/rowView\.rendered/);
    // The reference is rendered in the header, so it is stated and not implied.
    expect(table).toMatch(/vs \{view\.reference\?\.label/);
    expect(table).toMatch(/vs \{view\.costBasisLabel\}/);
    // And the percentage column is gated on the page-level NAV fact.
    expect(table).toMatch(/view\.percentOfFundRendered/);
  });

  it("withholds the NAV, and the P&L that divides by it, on the card above", () => {
    // `SummaryCard` was the ONE renderer in the app that never consulted
    // `glance.suppressed`, and it sits directly ABOVE tables that do. On 2026-06-30 —
    // 13 of 13 marks missing, 27 rows suppressed — it printed a fund value of
    // $98,321.96 while every `% of fund` cell beneath it was an em dash. The glance
    // showed no current mark; this card showed the number the glance refused to.
    const page = read("routes/big-picture.tsx");
    expect(page).toMatch(/<SummaryCard[\s\S]*?fundValueRendered=\{view\.fundValueRendered\}/);

    const card = read("components/SummaryCard.tsx");
    // BOTH metrics gate on the one fact — the NAV, and the unrealized P&L that
    // divides by it. The P&L is worse than the NAV, not better: it carries no
    // suppression key of its own, so nothing upstream could ever withhold it, and it
    // renders a wrong numerator over a wrong denominator. It is derived, so the
    // reader derives its absence. More than one mention, so this cannot pass on the
    // prop merely being received and ignored.
    expect(card.match(/fundValueRendered/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});
