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
 * So this increment's phone-side contract is a NEGATIVE one: nothing changes. A
 * negative contract that nobody asserts is a contract that quietly stops being true the
 * first time someone finds it convenient to "just add committed to the payload" — which
 * is exactly the history `projection-payload.test.ts` was written to end (the engine
 * grew `invalidationWatch`, `closedBook`, `priceJourneys` and `reserveReconciliation`,
 * and the push silently inherited every one; nothing decided that).
 *
 * Three facts, all asserted against CODE rather than against ADR prose, which cannot
 * fail a test run.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMPOSITION_SNAPSHOT_SCHEMA_VERSION } from "../projection/contract.ts";

/**
 * The version this increment must NOT move. A bump is the visible price of a new field
 * on the wire; pinning it here means a bump can only happen deliberately, with this
 * line edited and this docstring read.
 */
const PINNED_SCHEMA_VERSION = 3;

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

describe("`Q7` — nothing from this increment reaches the phone", () => {
  it("the projection schema version is UNCHANGED — no bump was paid for", () => {
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
});
