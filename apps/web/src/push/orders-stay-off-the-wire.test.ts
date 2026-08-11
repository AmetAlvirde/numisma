/**
 * `Q7` — "the phone stays SILENT, not wrong". ASSERTED, NOT ASSUMED.
 *
 * The orders grill had licensed exactly one phone correction, and justified it
 * precisely: it was "not a new feature, it is a defect in a number the phone already
 * shows", shipping inside an existing field for no schema bump and no ADR-007
 * amendment. The Tempo grill DESTROYED that justification — the glance's Reserve slot
 * resolves `tempo:Reserve` (`compose/report.ts`), and the funding container for this
 * ladder is a DIFFERENT Tempo, so the number that licence pointed at is INERT here.
 * The justification is gone; the cost is not. Anything else on the phone is a new field
 * at the full schema-bump price list plus a standalone ADR-007 amendment, and increment
 * two already commits to that amendment.
 *
 * The orders increment's phone-side contract was a NEGATIVE one: nothing changes. A
 * negative contract that nobody asserts is a contract that quietly stops being true the
 * first time someone finds it convenient to "just add committed to the payload" — which
 * is exactly the history `projection-payload.test.ts` was written to end (the engine
 * grew `invalidationWatch`, `closedBook`, `priceJourneys` and `reserveReconciliation`,
 * and the push silently inherited every one; nothing decided that).
 *
 * ── THE AMENDMENT HAPPENED (spec #277, slice 2) ─────────────────────────────────
 * That "nothing changes" framing described a STATE, not a promise never to move, and
 * increment two is the move it always named. The wire now carries a fourth top-level
 * branch, `dca`, and the schema version is 4. So this file INVERTED rather than
 * relaxed, and the two halves are worth telling apart:
 *
 *  - THE NEGATIVE CONTRACT IS INTACT, every byte of it. All eight `ORDERS_SYMBOLS`
 *    and every field marker still never appear in push or projection source, because
 *    `dca` derives from the PLANS sidecar — declarations of intent — and not from the
 *    orders sidecar. Nothing in the amendment weakens that wall; the DCA branch walked
 *    around it, it did not go through it.
 *  - THE PIN NOW ASSERTS THE PRICE WAS PAID. It reads 4, not 3, and what it records is
 *    that the bump was DELIBERATE: it rode the full price list this file's header
 *    quotes — the version bump at all four sites, the allow-list growth, the fixture
 *    regeneration, and ADR-007's third amendment. A pin that merely tracked whatever
 *    the constant happens to say would assert nothing at all.
 *
 * Positive assertions land beside the negative ones for the first time, in the style
 * of the has-teeth guards this repo already uses: the plans symbols DO appear in push
 * source, and `dca` IS a payload key. Without those, "nothing from ORDERS reached the
 * phone" and "nothing reached the phone" are indistinguishable failures.
 * ────────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMPOSITION_SNAPSHOT_SCHEMA_VERSION, toProjectionReport } from "../projection/contract.ts";
import { loadFixture, TEST_DCA, TEST_GLANCE } from "./push-core.fixtures.ts";

/**
 * The version, and the fact that moving it is an ACT. It was 3 while the orders
 * increment's contract was "nothing changes"; it is 4 because spec #277 paid for the
 * fourth branch in full. Editing this line is still the visible price of a new field
 * on the wire — the pin does not care which way the number moves, only that no bump
 * happens without this docstring being read.
 */
const PINNED_SCHEMA_VERSION = 4;

/**
 * The plans symbols the DCA branch legitimately brought into push source. Their
 * ABSENCE would mean the wire lost its source, which the version pin alone cannot
 * detect. Confinement to `src/push/` is a different claim, asserted by
 * `../plans-import-guard.test.ts`.
 */
const PLANS_SYMBOLS = ["loadPlans", "listPlansAsOf"];

/**
 * Symbols that exist only because the orders sidecar exists. If any of them appears in
 * the projection or push source, the sidecar has reached the wire path.
 */
const ORDERS_SYMBOLS = [
  "composeAvailableCapital",
  "committedRungs",
  "committedByReserve",
  "pickRestingOrdersAsOf",
  "formatAvailableCapital",
  "orders.jsonl",
  "loadOrders",
  "resolveOrdersPath",
];

/**
 * Strip comments before scanning. The scan is about what the CODE does, and this repo's
 * source is heavily commented — "the committed bytes on disk" is prose about git, not a
 * committed-capital field, and a scanner that cannot tell them apart is a scanner
 * nobody will keep.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Every source file on the projection/push path, excluding the tests that police it. */
function projectionSources(): { path: string; source: string }[] {
  const roots = ["src/push", "src/projection"];
  const files: { path: string; source: string }[] = [];
  for (const root of roots) {
    const dir = new URL(`../../${root}/`, import.meta.url).pathname;
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) continue;
      if (entry.includes(".test.") || entry.includes(".fixtures.")) continue;
      files.push({
        path: join(root, entry),
        source: stripComments(readFileSync(join(dir, entry), "utf8")),
      });
    }
  }
  return files;
}

describe("`Q7` — nothing from the ORDERS increment reaches the phone", () => {
  it("the projection schema version is the PAID-FOR bump, not a drifted one", () => {
    expect(COMPOSITION_SNAPSHOT_SCHEMA_VERSION).toBe(PINNED_SCHEMA_VERSION);
  });

  it("no projection or push source imports or names the orders sidecar", () => {
    const sources = projectionSources();
    // False-pass guard: an empty or mis-resolved file list would make every assertion
    // below vacuous, which is the exact failure mode a source scan is prone to.
    expect(sources.length).toBeGreaterThan(3);
    expect(sources.some((file) => file.path.includes("push-core"))).toBe(true);

    const hits = sources.flatMap((file) =>
      ORDERS_SYMBOLS.filter((symbol) => file.source.includes(symbol)).map(
        (symbol) => `${symbol} @ ${file.path}`,
      ),
    );
    expect(
      hits,
      `the orders sidecar reached the projection/push path. This increment's phone-side ` +
        `contract is that NOTHING changes: no schema bump, no allow-list edit, no ` +
        `ADR-007 amendment, no backfill. Anything on the phone rides the hosted-` +
        `projection amendment in increment two.\n${hits.join("\n")}`,
    ).toEqual([]);
  });

  it("no projection or push source carries a committed/available/rung field name", () => {
    const sources = projectionSources();
    // THE RUNG MARKER IS ORDERS-QUALIFIED, and was narrowed deliberately. Its target
    // has always been ORDERS-COMMITTED capital reaching the wire under a renamed
    // field — not the word `rungs`. The generic `\brungs?\s*[:,)]` form could not
    // survive spec #277 slice 1: plan-DECLARED ladders now legitimately name `rungs`
    // in push and projection source (`push/dca-block.ts`, the projection's own
    // `DcaBlock`), because the DCA branch derives its rungs from the plans sidecar,
    // which is a declaration of intent and not an order. Orders-DERIVED rung capital
    // remains banned, here and in ORDERS_SYMBOLS above.
    const markers =
      /\b(availableCapital|committedRungs|committedByReserve|fundingReserveId|restingOrder)\b|[.:]\s*committed\b|\b[a-z]*(?:committed|resting|order)[a-z]*rungs?\s*[:,)]|\brungs?(?:committed|resting|order)[a-z]*\s*[:,)]/i;
    const hits = sources
      .filter((file) => markers.test(file.source))
      .map((file) => file.path);
    expect(hits).toEqual([]);
  });

  // ── The positive half (spec #277, slice 2). Has teeth in the same sense the two
  // import guards do: without these, a wire that lost the DCA branch entirely would
  // satisfy every negative assertion above and read as a clean pass.
  it("the plans sidecar DOES reach push source — the branch has a source", () => {
    const sources = projectionSources();
    const found = new Set(
      sources.flatMap((file) => PLANS_SYMBOLS.filter((symbol) => file.source.includes(symbol))),
    );
    expect(
      [...found].sort(),
      `the DCA branch's inputs are gone from push source. The wire says v4 and the ` +
        `payload claims a plans-derived branch; if nothing reads the plans sidecar, ` +
        `one of those two is a lie.`,
    ).toEqual([...PLANS_SYMBOLS].sort());
  });

  it("`dca` IS a payload key — the bump bought a fourth branch", async () => {
    const payload = toProjectionReport(await loadFixture(), TEST_GLANCE, TEST_DCA);
    expect(Object.keys(payload).sort()).toEqual(["dashboard", "dca", "glance", "totals"]);
  });
});
