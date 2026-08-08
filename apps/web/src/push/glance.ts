/**
 * The push-side glance builder (PRD #146 seam B, slice #148).
 *
 * PURE. Given the folded read model, the composition report built from it, and the
 * Reserve floor in force as-of the anchor, it produces the {@link GlanceBlock} that
 * rides on the v3 projection payload.
 *
 * WHY THIS LIVES ON THE PUSH SIDE — the one rule that places every line in this
 * file: *does this computation need data D8 keeps off the wire?* Expectation-vs-
 * arrival does. It needs per-instrument MARK DATES, which are exactly what D14
 * refuses to ship, so the push computes the conclusion here and sends the
 * conclusion. Freshness does NOT — it is `summary.asOf` against the wall clock — so
 * it is a render-time derivation in slice 4's verdict module and must never be
 * pushed. Following that rule is what makes the verdict module pure by
 * construction.
 *
 * R5 — THE CALENDAR'S NAMED BLIND SPOT. The venue cadence below is weekday-only:
 * it has NO holiday awareness. A US market holiday that falls on a weekday is still
 * a day this file expects a mark on, so the alarm can ring on a day the venue was
 * legitimately closed. Under carry-forward (below) that false *yes* does not last a
 * single day — it PERSISTS until the venue next marks, because an unfilled
 * expectation is only cleared by a fill.
 *
 * That is accepted for v1 on R3's own logic — a false *yes* costs a glance at the
 * desk; a false *no* is the one failure a triage surface cannot have. And
 * carry-forward is robust to holiday ignorance in the direction that matters: a
 * holiday shifts WHICH DAY the alarm rings, never WHETHER it rings. The venue reopens,
 * marks, and the expectation is filled.
 *
 * (An earlier version of this note claimed 2026-07-03 fires a *false* gap because of
 * the Jul-4 holiday. Checked against the real log, 07-03 is a TRUE gap: the equity
 * feed had already been dark since Tue 06-30. No holiday was involved.)
 */
import type {
  CompositionReport,
  FundReviewData,
  InstrumentRegistryEntry,
  PriceSource,
} from "@numisma/engine";
import { addDays, composeRowDependencies, instrumentsForSource } from "@numisma/engine";
import type { GlanceBlock, GlanceMissingMark } from "../projection/contract.ts";
import { SUPPRESSION_KEYS } from "../projection/contract.ts";

/** How often a venue is expected to produce a mark. */
type VenueCadence = "daily" | "weekdays";

/**
 * THE VENUE CALENDAR — keyed on the registry's OWN `source` property, which is the
 * only reason this covers all thirteen instruments.
 *
 * READ THIS BEFORE EDITING: the non-crypto instruments are TWO registry groups, not
 * one. `EQUITY_ENTRIES` (3 US equities) and `MXN_DERIVED_ENTRIES` (6 SIC entries
 * priced off a US-listed underlying) are BOTH `source: "twelvedata"`. Keying on
 * `source` unions them for free; hand-listing "the equities" instead would
 * under-count the expectation by six and go silent on a real outage — a false *no*.
 *
 * `satisfies Record<PriceSource, VenueCadence>` is the compile-time latch: the day
 * the engine adds a third price source, this object stops compiling and somebody has
 * to state that venue's cadence rather than have it default to "never expected".
 */
const VENUE_CADENCE = {
  binance: "daily",
  twelvedata: "weekdays",
} as const satisfies Record<PriceSource, VenueCadence>;

/** Every registered instrument, across every source — the union, built from `source`. */
function allRegisteredInstruments(): InstrumentRegistryEntry[] {
  return (Object.keys(VENUE_CADENCE) as PriceSource[]).flatMap((source) =>
    instrumentsForSource(source),
  );
}

/**
 * The weekday is read in UTC from the plain `YYYY-MM-DD` anchor. A local-time
 * `new Date("2026-07-26")` is parsed as UTC midnight and then rendered in local
 * time, which west of Greenwich lands on the PREVIOUS day — enough to call a Monday
 * a Sunday and silently expect nothing.
 */
function isWeekend(asOf: string): boolean {
  const weekday = new Date(`${asOf}T00:00:00Z`).getUTCDay();
  return weekday === 0 || weekday === 6;
}

/**
 * The most recent date <= `asOf` on which this venue was expected to mark.
 *
 * CARRY-FORWARD, AND WHY IT REPLACED A SAME-DATE TEST. The original builder asked
 * "is a mark expected TODAY, and did one arrive TODAY" — so an obligation that went
 * unfilled on its due day simply EVAPORATED the next morning. Against the real log
 * the equity feed marked on 2026-06-26 and went dark until 07-06; on Sat 07-04 and
 * Sun 07-05 nothing is expected of a weekday venue, so the builder emitted
 * `{expected: 4, arrived: 4, missing: []}` with nothing suppressed and rendered a
 * full NAV whose nine of thirteen legs were priced eight days earlier. That is a
 * false *no* — the one failure a triage surface cannot have.
 *
 * An unfilled expectation now PERSISTS UNTIL IT IS FILLED. The question asked of each
 * instrument is not "did you quote today" but "is your newest mark at least as recent
 * as the last mark you owed me". The weekend walk is bounded by a guard rather than
 * unbounded, so a malformed anchor cannot spin.
 */
function lastExpectedMarkDate(source: PriceSource, asOf: string): string {
  if (VENUE_CADENCE[source] === "daily") {
    return asOf;
  }
  let cursor = asOf;
  for (let guard = 0; guard < 10 && isWeekend(cursor); guard += 1) {
    cursor = addDays(cursor, -1);
  }
  return cursor;
}

/**
 * Build the glance block for `report`'s own anchor.
 *
 * `reserveTargetPct` is passed IN, already resolved by `pickPolicyAsOf` against this
 * anchor's date, and `undefined` is a first-class answer meaning "no policy was in
 * effect" (R1). This function never consults a default, and deliberately has no
 * access to one.
 */
export function buildGlanceBlock(
  data: FundReviewData,
  report: CompositionReport,
  reserveTargetPct?: number,
): GlanceBlock {
  const asOf = report.dashboard.summary.asOf;

  // ARRIVAL, from the fold's own per-instrument mark record. `data.closes` carries
  // one entry per `PriceMarked` the fold applied (plus the t0 genesis anchors), so it
  // is the whole mark HISTORY, not just this anchor's row — which is what makes
  // carry-forward computable here with no change to this function's signature and no
  // new data crossing the seam. This is read from the FOLD rather than from
  // `report.priceJourneys` on purpose: the journey builder drops any instrument with
  // fewer than two points, which would report a genuinely-marked instrument as
  // missing on the genesis anchor.
  const lastMarkById = new Map<string, string>();
  for (const close of data.closes ?? []) {
    if (close.asOf > asOf) continue;
    const seen = lastMarkById.get(close.instrumentId);
    if (seen === undefined || close.asOf > seen) {
      lastMarkById.set(close.instrumentId, close.asOf);
    }
  }

  // Labels, preferring the string ALREADY ON THE WIRE (the composition row), falling
  // back to the instrument catalog — which produces the byte-identical
  // `SYMBOL (Name)` the row would have carried — for a registered instrument the
  // fund does not currently hold a position in. Expectation is deliberately NOT
  // gated on holding a position: gating it would make a whole venue's outage
  // invisible the moment its last position closes.
  const labels = new Map<string, string>();
  for (const instrument of data.instruments ?? []) {
    labels.set(instrument.id, `${instrument.symbol} (${instrument.name})`);
  }
  for (const section of report.dashboard.sections) {
    for (const row of section.rows) {
      if (row.kind === "instrument") {
        labels.set(row.id.slice("instrument:".length), row.label);
      }
    }
  }

  // EVERY registered instrument is expected on EVERY anchor, and that is a deliberate
  // consequence of carry-forward rather than an oversight. `lastExpectedMarkDate`
  // always resolves to some date <= `asOf`, so on any anchor all thirteen instruments
  // owe a current mark; `arrived` is the count of instruments that are FRESH against
  // that date. The reading is "thirteen instruments should have a current mark; N do".
  // Keeping `expected` at "due today" while `missing` carried forward absences from
  // previous days would make `arrived = expected - missing.length` go NEGATIVE.
  const expectedEntries = allRegisteredInstruments();
  const missing: GlanceMissingMark[] = expectedEntries
    .filter((entry) => {
      const lastMark = lastMarkById.get(entry.instrumentId);
      return (
        lastMark === undefined ||
        lastMark < lastExpectedMarkDate(entry.source, asOf)
      );
    })
    .map((entry) => ({
      rowId: `instrument:${entry.instrumentId}`,
      label: labels.get(entry.instrumentId) ?? entry.instrumentId,
    }));

  return {
    // R1: absent, not defaulted. A conditional spread rather than
    // `reserveTargetPct: reserveTargetPct` so the KEY itself is gone from the JSONB
    // — `{ reserveTargetPct: undefined }` would serialize as an absent key anyway,
    // but the type would claim the number exists.
    ...(reserveTargetPct === undefined ? {} : { reserveTargetPct }),
    feedGap: {
      expected: expectedEntries.length,
      arrived: expectedEntries.length - missing.length,
      missing,
    },
    suppressed: [
      ...suppressionKeysFor(missing.length > 0, reserveTargetPct === undefined),
      ...suppressedRowIds(data, report, missing),
    ],
  };
}

/**
 * D7 AT ROW ALTITUDE (slice #151) — which composition rows descend from a mark that
 * did not arrive.
 *
 * THE MAP IS COMPUTED HERE AND ONLY ITS CONCLUSION SHIPS. `composeRowDependencies`
 * answers *which instruments does this row descend from*, and the answer is exactly
 * the fund's instrument-to-grouping structure — pushing it would be D8 re-opened.
 * What crosses the wire is a list of row ids, which `sections` already carries.
 *
 * WHY A MAP AND NOT THE ROW ID. 19 of the fund's rows name no instrument — invariant
 * across all 28 anchors, while the row total is not (31 or 33, depending on whether the
 * late-opened instruments exist on that anchor). The 19 are the
 * tempo, account, tier and portfolio rows aggregate instruments without disclosing
 * which. Matching on the id is not merely imprecise, it is wrong in both directions
 * — an account someone named after a coin it does not hold would suppress, and every
 * aggregate that genuinely holds the missing instrument would stand. The second is
 * the failure that matters: a number rendered off a mark that never arrived.
 *
 * `data` and `report` are the SAME fold by construction (the caller derived one from
 * the other), so every row in the report has an entry in the map. That correspondence
 * is asserted in `row-dependencies.test.ts` at the engine seam and again here on the
 * emitted keys, rather than defended with a runtime throw on the daily push path.
 *
 * Emitted in the report's own row order, so the key list reads down the page.
 */
function suppressedRowIds(
  data: FundReviewData,
  report: CompositionReport,
  missing: readonly GlanceMissingMark[],
): string[] {
  if (missing.length === 0) return [];
  const absent = new Set(
    missing.map((entry) => entry.rowId.slice("instrument:".length)),
  );
  const dependencies = composeRowDependencies(data);
  const suppressed: string[] = [];
  for (const section of report.dashboard.sections) {
    for (const row of section.rows) {
      const dependsOn = dependencies.get(row.id) ?? [];
      if (dependsOn.some((instrumentId) => absent.has(instrumentId))) {
        suppressed.push(row.id);
      }
    }
  }
  return suppressed;
}

/**
 * V5/D7 — which numbers are unsafe to render, from the two causes visible PUSH-SIDE.
 * The third cause (a withheld reference anchor, suppressing `change` alone) is
 * reader-side and belongs to slice 4.
 *
 * | cause                          | suppresses                                  |
 * |--------------------------------|---------------------------------------------|
 * | unexpected mark absence        | fund value, change, AND Reserve %           |
 * | missing/quarantined policy (R5)| Reserve % alone                             |
 *
 * D7's ORIGINAL ILLUSTRATION IS WRONG AND THE SPEC CORRECTS IT. It said an absent
 * mark "leaves `Reserve 12%` standing, because Reserve is cash and no price touches
 * it". Reserve % is a RATIO WHOSE DENOMINATOR IS NAV, so a wrong NAV makes Reserve %
 * wrong too. Implementing D7 from its example would ship exactly the number U's
 * invariant forbids: *if I see a number, it is a correct one.* The rule survives; the
 * example does not.
 *
 * R2 — an absence never fails the whole surface. A missing policy leaves fund value,
 * change and `feedGap` untouched; only the Reserve key goes. The shape of what is
 * missing is itself diagnostic.
 */
function suppressionKeysFor(
  markAbsence: boolean,
  policyAbsence: boolean,
): string[] {
  const suppressed: string[] = [];
  if (markAbsence) {
    suppressed.push(SUPPRESSION_KEYS.fundValue, SUPPRESSION_KEYS.change);
  }
  // Union, not two branches: both causes reach Reserve %, and it must appear once.
  if (markAbsence || policyAbsence) {
    suppressed.push(SUPPRESSION_KEYS.reserve);
  }
  return suppressed;
}
