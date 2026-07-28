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
 * it has NO holiday awareness. 2026-07-03 (a Friday, US observed holiday) will flag
 * 9 equities missing and fire a false `feedGap`. That is accepted for v1 on R3's own
 * logic — a false *yes* costs a glance at the desk; a false *no* is the one failure
 * a triage surface cannot have. It is named here rather than discovered later.
 */
import type {
  CompositionReport,
  FundReviewData,
  InstrumentRegistryEntry,
  PriceSource,
} from "@numisma/engine";
import { instrumentsForSource } from "@numisma/engine";
import type { GlanceBlock, GlanceMissingMark } from "../projection/contract.ts";

/**
 * The three header keys this slice can suppress — the closed set of standing
 * numbers D3 names. Slice 5 adds `CompositionRow.id`s to the same array; that
 * costs no schema change, which is the whole reason `suppressed` is a key list and
 * not N booleans.
 */
export const SUPPRESSION_KEYS = {
  fundValue: "summary.fundValueUsd",
  change: "summary.change",
  reserve: "summary.reserve",
} as const;

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
 * Is a mark from this venue EXPECTED on this calendar date?
 *
 * The weekday is read in UTC from the plain `YYYY-MM-DD` anchor. A local-time
 * `new Date("2026-07-26")` is parsed as UTC midnight and then rendered in local
 * time, which west of Greenwich lands on the PREVIOUS day — enough to call a Monday
 * a Sunday and silently expect nothing.
 */
function isExpectedOn(source: PriceSource, asOf: string): boolean {
  if (VENUE_CADENCE[source] === "daily") {
    return true;
  }
  const weekday = new Date(`${asOf}T00:00:00Z`).getUTCDay();
  return weekday >= 1 && weekday <= 5;
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
  // one entry per `PriceMarked` the fold applied (plus the t0 genesis anchors), so
  // "did instrument X quote on this anchor" is an exact-date membership test. This
  // is read from the FOLD rather than from `report.priceJourneys` on purpose: the
  // journey builder drops any instrument with fewer than two points, which would
  // report a genuinely-marked instrument as missing on the genesis anchor.
  const arrivedIds = new Set(
    (data.closes ?? [])
      .filter((close) => close.asOf === asOf)
      .map((close) => close.instrumentId),
  );

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

  const expectedEntries = allRegisteredInstruments().filter((entry) =>
    isExpectedOn(entry.source, asOf),
  );
  const missing: GlanceMissingMark[] = expectedEntries
    .filter((entry) => !arrivedIds.has(entry.instrumentId))
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
    suppressed: suppressionKeysFor(missing.length > 0, reserveTargetPct === undefined),
  };
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
