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
 *
 * ── THE SECOND AMENDMENT (spec #285, slice 3): THIS ONE GOES THROUGH THE WALL ────
 * The pin's own header says it "does not care which way the number moves, only that no
 * bump happens without this docstring being read". It has now been read, twice, and the
 * two crossings are different in kind. The first amendment could truthfully say the DCA
 * branch "walked around the wall, it did not go through it", because plans are
 * declarations of intent and the orders sidecar was never opened. THAT IS NO LONGER
 * TRUE. This slice goes through it, deliberately, and here is exactly what changed.
 *
 * 1. THE PUSH NOW READS `orders.jsonl`. It has to: the Fill Path's conclusions are a
 *    reconciliation of a declared ladder AGAINST THE ORDER STREAM, and no amount of
 *    care makes that computable without the stream. `loadOrders` and `resolveOrdersPath`
 *    therefore move from {@link ORDERS_SYMBOLS} to {@link ADMITTED_ORDER_SYMBOLS} — a
 *    NARROWING of the marker set, which is this file's own precedent (the rung marker
 *    was narrowed rather than deleted when plan-declared ladders arrived). Nothing is
 *    deleted; everything not named stays refused.
 *
 * 2. THE CONCLUSIONS ADMITTED, BY NAME, and only these: per-rung `venueAxis` /
 *    `bookAxis` / `label` / `joinProvenance` / `declaredPriceMismatch` / `resting`, the
 *    quantities behind them (`placedQuantity`, `venueConsumedQuantity`,
 *    `bookedQuantity`, `venueFilledFraction`, `orderPriceUsd`), the measured figures
 *    (`deployedUsd`, `unitsAcquired`, `avgEntryUsd`, `waitingDeclaredUsd`,
 *    `waitingRestingUsd`), the `orphanLots` count, the ladder's `planId`, the rung's
 *    DECLARED `sizeUsd`, and the fund-level `tornActs` COUNT. Each is a statement about
 *    ONE DECLARED LADDER — or, for the torn-act count, about the two files that record
 *    it — which is the fund's own intention rendered back to the operator who authored
 *    it (G-D2: authentication is the disclosure ceiling).
 *
 *    THE TWO LATE ADDITIONS ARE NOT ORDERS-DERIVED CAPITAL, and the distinction is the
 *    one this file's whole ban rests on. `sizeUsd` is a DECLARED figure out of the plans
 *    sidecar, whose sum (`waitingDeclaredUsd`) already crossed; what it adds is the
 *    ladder's SHAPE, which is what slice 4's `aria-hidden` chart needs an accessible
 *    substitute for. `tornActs` is a COUNT of halves-without-halves — a repair state of
 *    the fund's own records, carrying neither an amount nor an id — and it is emphatically
 *    not "how much of the fund is spoken for". Neither answers the whole-fund encumbrance
 *    question, which is the question that stays refused.
 *
 * 3. WHAT STAYS BANNED, AND WHY IT IS NOT ARBITRARY. Every DERIVED-CAPITAL marker:
 *    `availableCapital`, `committedRungs`, `committedByReserve`, `formatAvailableCapital`,
 *    `fundingReserveId`, and `pickRestingOrdersAsOf` — the whole-fund encumbrance view.
 *    Those answer "how much of the FUND is spoken for", which is a statement about the
 *    fund's total capital position rather than about one ladder's progress, and it is
 *    the class ADR-007's blast radius was computed without. The literal `orders.jsonl`
 *    stays banned too: resolving that filename is `resolveOrdersPath`'s job, so the
 *    string appearing in push source would mean someone bypassed the resolver.
 *
 * 4. SO THE WALL MOVED RATHER THAN FELL. It used to separate the orders sidecar from
 *    the push entirely. It now separates RAW ORDER ROWS from CONCLUSIONS, and it stands
 *    at `push/dca-block.ts`: orders and lots go in, per-rung states and figures come
 *    out, and no order id, order stamp or lot crosses. That is a boundary these tests
 *    can state and the old one could not have expressed.
 *
 * 5. THE POSITIVE LIST GREW WITH IT. {@link ADMITTED_ORDER_SYMBOLS} is asserted to be
 *    PRESENT in push source, exactly as `PLANS_SYMBOLS` is. Without that, a wire that
 *    silently stopped reconciling — the reconciliation deleted, the fields quietly gone
 *    — would satisfy every negative assertion in this file and read as a clean pass.
 *
 * WHAT DOES NOT NEED A NEW GUARD: confinement of the orders read to `src/push/`. Both
 * IO symbols live in `@numisma/preferences`, which `preferences-import-guard.test.ts`
 * already confines to that directory at package level.
 *
 * MUTATION-CHECKED: (1) `loadOrders` moved back into `ORDERS_SYMBOLS` — the negative
 * scan goes red naming `push-core.ts`, proving the scan really sees the new read.
 * (2) The reconciliation import deleted from `dca-block.ts` — the positive assertion
 * goes red naming the missing symbol rather than passing on a wire with no fill state.
 * (3) `reconcileFillActs` DELETED from `dca-block.ts` and its call replaced by an inline
 * `() => []` — the positive assertion goes red on the missing symbol, which is the
 * regression it exists for: the torn-act count would have silently gone absent on every
 * row while every negative assertion here stayed green. Note that ALIASING the import
 * (`reconcileFillActs as detectTorn`) does NOT trip it — the scan is a substring scan
 * over source, and the symbol is still named at the import site, which is the crossing
 * this file is about. All restored.
 * ────────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMPOSITION_SNAPSHOT_SCHEMA_VERSION, toProjectionReport } from "../projection/contract.ts";
import { loadFixture, TEST_DCA, TEST_GLANCE } from "./push-core.fixtures.ts";

/**
 * The version, and the fact that moving it is an ACT. It was 3 while the orders
 * increment's contract was "nothing changes"; 4 when spec #277 paid for the fourth
 * branch; 5 because spec #285 paid for the Fill Path in full — the bump at every site,
 * both allow-lists by enumeration, the fixture regeneration, the supported RANGE that
 * makes this the first bump with no cutover window, and this amendment. Editing this
 * line is still the visible price of a new field on the wire — the pin does not care
 * which way the number moves, only that no bump happens without this docstring being
 * read. 6 because #266 D6 paid for the venue-dark verdict the same way: the field
 * inside the existing `glance` branch, both allow-lists grown by enumeration, the
 * fixture regenerated, and no ADR-007 amendment owed — a venue name and a weekday
 * disclose strictly less than `feedGap.missing[]` already ships, and the floor stayed
 * at 4 because an absent field is a true statement about a v4 or v5 build.
 */
const PINNED_SCHEMA_VERSION = 6;

/**
 * The plans symbols the DCA branch legitimately brought into push source. Their
 * ABSENCE would mean the wire lost its source, which the version pin alone cannot
 * detect. Confinement to `src/push/` is a different claim, asserted by
 * `../plans-import-guard.test.ts`.
 */
const PLANS_SYMBOLS = ["loadPlans", "listPlansAsOf"];

/**
 * THE ADMITTED CROSSING (spec #285) — the symbols that legitimately entered push source
 * when the push started reading the orders sidecar, plus the reconciliation they exist
 * to feed. Asserted PRESENT, for the reason `PLANS_SYMBOLS` is: their disappearance
 * would mean the wire's fill fields lost their source while the version still claims
 * v5, and every negative assertion in this file would keep passing.
 *
 * `selectOrdersThrough` is here because it is what bounds the stream to the anchor. A
 * push that lost it would answer every historical anchor with today's fills — data-
 * shaped, wrong, and invisible to a scan that only checked the reconciliation ran.
 *
 * `reconcileFillActs` JOINED THEM WHEN THE TORN-ACT COUNT CROSSED, and it is worth saying
 * why it belongs on a list about ORDERS. The detector reads BOTH files — the durable log
 * and the orders sidecar — and pairs them by a derived id, so half of what it consumes is
 * the very sidecar this wall is about. It is admitted on the same terms as the rest: what
 * it produces here is a COUNT, and the acts themselves (an order id and a second-granular
 * stamp apiece) stop at `dca-block.ts` with the raw rows. Asserted PRESENT because its
 * disappearance would leave the wire's `tornActs` silently absent on every row while the
 * surface's red banner — the one that says recording is blocked — simply never rendered,
 * which is a false *no* and the failure this positive list exists to catch.
 *
 * The raw event list the detector's other half needs is NOT an orders symbol and is not
 * listed here: `@numisma/event-store` is the push's own long-standing input, confined to
 * `src/push/` by `../event-store-import-guard.test.ts`.
 */
const ADMITTED_ORDER_SYMBOLS = [
  "loadOrders",
  "resolveOrdersPath",
  "reconcileFillActs",
  "reconcileFillPath",
  "selectOrdersThrough",
];

/**
 * Symbols that exist only because the orders sidecar exists, MINUS the ones the Fill
 * Path admitted by name above. Every one still here answers a whole-fund capital
 * question — how much is committed, how much is available — rather than a question
 * about one declared ladder's progress, and that is the line the amendment drew. If any
 * appears in projection or push source, derived capital has reached the wire path.
 */
const ORDERS_SYMBOLS = [
  "composeAvailableCapital",
  "committedRungs",
  "committedByReserve",
  "pickRestingOrdersAsOf",
  "formatAvailableCapital",
  "orders.jsonl",
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
      `DERIVED CAPITAL reached the projection/push path. The Fill Path amendment ` +
        `admitted the orders READ and the per-ladder conclusions by name (see this ` +
        `file's header); it admitted nothing that answers "how much of the FUND is ` +
        `spoken for". That is a different disclosure and it costs its own decision, ` +
        `not a paste into this list.\n${hits.join("\n")}`,
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

  // ── The admitted crossing (spec #285, slice 3). The negative scan above can only
  // ever say what did NOT happen; these say the thing that was PAID FOR did.
  it("the orders sidecar DOES reach push source — the crossing was admitted, not smuggled", () => {
    const sources = projectionSources();
    const found = new Set(
      sources.flatMap((file) =>
        ADMITTED_ORDER_SYMBOLS.filter((symbol) => file.source.includes(symbol)),
      ),
    );
    expect(
      [...found].sort(),
      `the Fill Path's inputs are gone from push source. The wire says v5 and the ` +
        `payload's rungs claim reconciled fill state; if nothing reads the orders ` +
        `sidecar and nothing reconciles it, one of those is a lie — and every negative ` +
        `assertion in this file would still be green, which is exactly why this one ` +
        `exists.`,
    ).toEqual([...ADMITTED_ORDER_SYMBOLS].sort());
  });

  it("the wall stands at `dca-block.ts` — the conclusions cross, the rows do not", () => {
    // Where the amendment says the wall now is, asserted rather than described. The
    // reconciliation is called in exactly one place; if a second module started calling
    // it, "the conclusions are narrowed in one file" would have quietly stopped being
    // true and there would be two places for a raw order row to leak from.
    const callers = projectionSources()
      .filter((file) => file.source.includes("reconcileFillPath("))
      .map((file) => file.path);
    expect(callers).toEqual(["src/push/dca-block.ts"]);
  });
});
