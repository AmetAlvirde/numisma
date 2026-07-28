/**
 * The glance builder (PRD #146 seam B, slice #148) — the four cases the spec names.
 *
 * The load-bearing one is THE QUIET SUNDAY, because it is the case V1 exists to
 * protect: 9 of 13 instruments have no mark on 2026-07-26, and that is not a
 * failure — it is a weekend. A builder that keyed suppression on mark AGE rather
 * than on UNEXPECTED absence would blank the header every Saturday and Sunday, which
 * is a false *yes* on 2 days in 7 and would train the operator to ignore the surface.
 *
 * The Sunday case is a MEASURED day, not a fixture somebody wrote to agree with the
 * code. It used to fold the private log directly and self-skip when the log was
 * absent, which meant the spec's one worked example ran nowhere but the operator's
 * machine. Slice #149's committed backfill fixture holds that same day's block —
 * built by this builder, from the real log — so the worked case now runs
 * unconditionally, and a second case re-derives it live and requires the two to
 * agree WHEN the log is present. Only that agreement check skips. The outage, floor
 * and R2 cases are constructed, so they run everywhere.
 */
import { describe, expect, it } from "vitest";
import type { CompositionReport, FundReviewData } from "@numisma/engine";
import { buildCompositionReport, instrumentsForSource } from "@numisma/engine";
import { buildGlanceBlock, SUPPRESSION_KEYS } from "./glance.ts";

/** The measured quiet Sunday. Marks that day: btc, eth, render, gram — the 4 crypto. */
const QUIET_SUNDAY = "2026-07-26";
/** A Tuesday: every venue is open, so all thirteen instruments are expected. */
const OPEN_TUESDAY = "2026-07-28";

const CRYPTO_IDS = instrumentsForSource("binance").map((e) => e.instrumentId);
const TWELVEDATA_IDS = instrumentsForSource("twelvedata").map(
  (e) => e.instrumentId,
);
const ALL_IDS = [...CRYPTO_IDS, ...TWELVEDATA_IDS];

/**
 * A synthetic fold + report carrying exactly what the builder reads: the anchor
 * date, the per-instrument marks dated on it, and the instrument rows that supply
 * `missing`'s labels. Cast because a full `FundReviewData`/`CompositionReport` is
 * an order of magnitude more shape than this unit touches (the repo's existing push
 * tests construct their inputs the same way).
 */
function constructedAnchor(
  asOf: string,
  markedIds: readonly string[],
): { data: FundReviewData; report: CompositionReport } {
  const data = {
    instruments: ALL_IDS.map((id) => ({
      id,
      symbol: id.toUpperCase(),
      name: `Test ${id}`,
    })),
    closes: markedIds.map((id) => ({ instrumentId: id, asOf, price: 1 })),
  } as unknown as FundReviewData;

  const report = {
    dashboard: {
      summary: { asOf },
      sections: [
        {
          id: "instruments",
          title: "Instruments",
          rows: ALL_IDS.map((id) => ({
            id: `instrument:${id}`,
            kind: "instrument",
            label: `${id.toUpperCase()} (Test ${id})`,
            usdValue: 1,
            percentOfFund: 1,
          })),
        },
      ],
    },
  } as unknown as CompositionReport;

  return { data, report };
}

/**
 * The same synthetic anchor, but with marks carrying THEIR OWN dates rather than
 * all landing on the anchor. This is what an anchor actually looks like once a feed
 * has been down for days: `data.closes` holds the whole history the fold applied,
 * and the newest entry for a stalled instrument is older than the anchor.
 *
 * `markDates` maps instrument id -> the dates it marked on. Anything absent from the
 * map never marked at all.
 */
function anchorWithMarkHistory(
  asOf: string,
  markDates: Record<string, readonly string[]>,
): { data: FundReviewData; report: CompositionReport } {
  const base = constructedAnchor(asOf, []);
  const closes = Object.entries(markDates).flatMap(([id, dates]) =>
    dates.map((date) => ({ instrumentId: id, asOf: date, price: 1 })),
  );
  return {
    data: { ...base.data, closes } as unknown as FundReviewData,
    report: base.report,
  };
}

describe("a real outage: the same 9-of-13 shortfall on a Tuesday", () => {
  const { data, report } = constructedAnchor(OPEN_TUESDAY, CRYPTO_IDS);
  const glance = buildGlanceBlock(data, report, 10);

  it("expects all thirteen — the two twelvedata registry groups, not one", () => {
    // THE LANDMINE. The 9 non-crypto instruments are TWO registry groups (3 US
    // equities + 6 MXN-derived SIC entries), both `source: "twelvedata"`. A builder
    // that hand-listed "the equities" would expect 7, count 3 missing, and stay
    // silent on six dead feeds.
    expect(glance.feedGap.expected).toBe(13);
    expect(glance.feedGap.arrived).toBe(4);
    expect(glance.feedGap.missing).toHaveLength(9);
    expect(glance.feedGap.missing.map((m) => m.rowId).sort()).toEqual(
      TWELVEDATA_IDS.map((id) => `instrument:${id}`).sort(),
    );
  });

  it("carries rowId + label ONLY — never a mark date (D14)", () => {
    for (const entry of glance.feedGap.missing) {
      expect(Object.keys(entry).sort()).toEqual(["label", "rowId"]);
    }
    expect(JSON.stringify(glance)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("suppresses all three header keys — Reserve % descends from NAV too", () => {
    // D7's own illustration is WRONG here and the spec corrects it: Reserve % is a
    // ratio whose DENOMINATOR is NAV, so an unexpectedly-absent mark makes it wrong
    // exactly as it makes fund value wrong. "Reserve stands because it's cash" would
    // ship the one number the invariant forbids.
    expect(glance.suppressed).toEqual([
      SUPPRESSION_KEYS.fundValue,
      SUPPRESSION_KEYS.change,
      SUPPRESSION_KEYS.reserve,
    ]);
    // Suppression is about the NUMBERS, not about the floor: the policy was in
    // force and is still stamped on the anchor.
    expect(glance.reserveTargetPct).toBe(10);
  });

  it("names each missing instrument by the label sections already carry", () => {
    expect(glance.feedGap.missing[0]).toEqual({
      rowId: `instrument:${TWELVEDATA_IDS[0]}`,
      label: `${TWELVEDATA_IDS[0]!.toUpperCase()} (Test ${TWELVEDATA_IDS[0]})`,
    });
  });
});

describe("R1 — the floor is never invented", () => {
  const { data, report } = constructedAnchor(OPEN_TUESDAY, ALL_IDS);

  it("omits reserveTargetPct entirely when no policy is in effect as-of the anchor", () => {
    const glance = buildGlanceBlock(data, report, undefined);

    // ABSENT, not undefined-valued and above all not 10. `defaultProfitPolicyEntry`
    // is a seed for a NEW sidecar, never a read-gap filler (V2/R1), and it sits one
    // import away in the package this push path already depends on.
    expect("reserveTargetPct" in glance).toBe(false);
    expect(glance.reserveTargetPct).toBeUndefined();
    expect(glance.reserveTargetPct).not.toBe(10);
    // The absence must survive serialization to JSONB as an absent KEY.
    expect(JSON.parse(JSON.stringify(glance))).not.toHaveProperty(
      "reserveTargetPct",
    );
  });

  it("R2 — an absent policy suppresses the Reserve key ALONE", () => {
    const glance = buildGlanceBlock(data, report, undefined);

    // Fund value, change and feedGap are untouched: nothing about a missing policy
    // makes NAV wrong. The shape of what is missing is itself diagnostic.
    expect(glance.suppressed).toEqual([SUPPRESSION_KEYS.reserve]);
    expect(glance.feedGap).toEqual({ expected: 13, arrived: 13, missing: [] });
  });

  it("stamps the floor verbatim when a policy IS in effect (C4: the wire says target)", () => {
    expect(buildGlanceBlock(data, report, 12.5).reserveTargetPct).toBe(12.5);
    expect(buildGlanceBlock(data, report, 12.5).suppressed).toEqual([]);
  });

  it("does not name the Reserve key twice when both causes fire at once", () => {
    // Mark absence AND no policy. Reserve % is unsafe for two reasons; it is one key.
    const outage = constructedAnchor(OPEN_TUESDAY, CRYPTO_IDS);
    const glance = buildGlanceBlock(outage.data, outage.report, undefined);
    expect(glance.suppressed).toEqual([
      SUPPRESSION_KEYS.fundValue,
      SUPPRESSION_KEYS.change,
      SUPPRESSION_KEYS.reserve,
    ]);
    expect(new Set(glance.suppressed).size).toBe(glance.suppressed.length);
  });
});

describe("carry-forward: an unfilled expectation survives the weekend", () => {
  /**
   * THE FALSE *NO* THIS EXISTS TO KILL. Against the real log the equity feed marked
   * on 2026-06-26 and then went dark until 2026-07-06. On Sat 2026-07-04 and Sun
   * 2026-07-05 all nine `twelvedata` instruments were 8 and 9 days stale — but a
   * builder that compares expectation and arrival ONLY on the day the mark was due
   * expects nothing from twelvedata on a weekend, so it emits a clean
   * `{expected: 4, arrived: 4, missing: []}` and renders a full, unsuppressed NAV
   * whose nine of thirteen legs are priced 06-26. Miss the due day and the
   * obligation evaporates. Under carry-forward it persists until it is FILLED.
   */
  const CRYPTO_DAILY = (through: string): string[] => {
    const dates: string[] = [];
    for (let cursor = "2026-06-26"; cursor <= through; ) {
      dates.push(cursor);
      const next = new Date(`${cursor}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      cursor = next.toISOString().slice(0, 10);
    }
    return dates;
  };

  /** The real outage: crypto keeps marking, twelvedata's last mark is 2026-06-26. */
  const stalledEquities = (asOf: string) =>
    anchorWithMarkHistory(asOf, {
      ...Object.fromEntries(CRYPTO_IDS.map((id) => [id, CRYPTO_DAILY(asOf)])),
      ...Object.fromEntries(TWELVEDATA_IDS.map((id) => [id, ["2026-06-26"]])),
    });

  for (const [asOf, weekday] of [
    ["2026-07-04", "Saturday"],
    ["2026-07-05", "Sunday"],
  ] as const) {
    it(`${asOf} (${weekday}) still reports the nine stale twelvedata instruments`, () => {
      const { data, report } = stalledEquities(asOf);
      const glance = buildGlanceBlock(data, report, 10);

      // Every registered instrument is expected on every anchor: carry-forward
      // resolves a last-expected date <= asOf for all thirteen. `arrived` is the
      // count of FRESH instruments, not of instruments that quoted today.
      expect(glance.feedGap.expected).toBe(13);
      expect(glance.feedGap.arrived).toBe(4);
      expect(glance.feedGap.missing.map((m) => m.rowId).sort()).toEqual(
        TWELVEDATA_IDS.map((id) => `instrument:${id}`).sort(),
      );
      // The whole point: the header must NOT render. Nine of thirteen legs are
      // priced 06-26, which makes NAV, change and Reserve % (NAV in its
      // denominator) all wrong.
      expect(glance.suppressed).toEqual([
        SUPPRESSION_KEYS.fundValue,
        SUPPRESSION_KEYS.change,
        SUPPRESSION_KEYS.reserve,
      ]);
    });
  }

  it("2026-07-03 (Friday) is a TRUE gap — the feed was already down from 06-30", () => {
    const { data, report } = stalledEquities("2026-07-03");
    const glance = buildGlanceBlock(data, report, 10);
    expect(glance.feedGap.expected).toBe(13);
    expect(glance.feedGap.arrived).toBe(4);
    expect(glance.feedGap.missing).toHaveLength(9);
  });

  it("the quiet Sunday stays SILENT: equities fresh against Friday 2026-07-24", () => {
    // The spec's worked example, restated under the new semantics. Carry-forward
    // must not turn every weekend into an alarm: Sunday's last EXPECTED twelvedata
    // mark is Friday the 24th, and the 24th is exactly what they carry.
    const { data, report } = anchorWithMarkHistory(QUIET_SUNDAY, {
      ...Object.fromEntries(CRYPTO_IDS.map((id) => [id, [QUIET_SUNDAY]])),
      ...Object.fromEntries(TWELVEDATA_IDS.map((id) => [id, ["2026-07-24"]])),
    });
    const glance = buildGlanceBlock(data, report, 10);
    expect(glance.feedGap).toEqual({ expected: 13, arrived: 13, missing: [] });
    expect(glance.suppressed).toEqual([]);
  });

  it("still fires on a Monday whose crypto feed alone is stale", () => {
    // Carry-forward is per-instrument and per-cadence: `binance` is daily, so its
    // last-expected date is the anchor itself and Friday's mark does not carry.
    const { data, report } = anchorWithMarkHistory("2026-07-27", {
      ...Object.fromEntries(CRYPTO_IDS.map((id) => [id, ["2026-07-24"]])),
      ...Object.fromEntries(TWELVEDATA_IDS.map((id) => [id, ["2026-07-27"]])),
    });
    const glance = buildGlanceBlock(data, report, 10);
    expect(glance.feedGap.expected).toBe(13);
    expect(glance.feedGap.arrived).toBe(9);
    expect(glance.feedGap.missing.map((m) => m.rowId).sort()).toEqual(
      CRYPTO_IDS.map((id) => `instrument:${id}`).sort(),
    );
  });
});

describe("the venue calendar", () => {
  it("expects crypto every day of the week and twelvedata only Mon–Fri", () => {
    // REWRITTEN FOR CARRY-FORWARD, and the rewrite is the point. This case used to
    // read the cadence off `feedGap.expected` (4 on a weekend, 13 on a weekday).
    // Under carry-forward `expected` is ALWAYS 13 — every registered instrument owes
    // a current mark on every anchor — so the cadence distinction moved to where it
    // belongs: WHICH instruments a Friday mark still satisfies. Hold every
    // instrument's last mark at Friday 2026-07-24 and walk the week: twelvedata is
    // satisfied across Sat/Sun and goes stale on Monday; binance, being daily, is
    // stale from Saturday on.
    const fridayMarks = Object.fromEntries(
      ALL_IDS.map((id) => [id, ["2026-07-24"]]),
    );
    // 2026-07-25 Sat, 26 Sun, 27 Mon … 31 Fri.
    const staleByDate: Array<[string, number]> = [
      ["2026-07-25", 4],
      ["2026-07-26", 4],
      ["2026-07-27", 13],
      ["2026-07-28", 13],
      ["2026-07-29", 13],
      ["2026-07-30", 13],
      ["2026-07-31", 13],
    ];
    for (const [asOf, staleCount] of staleByDate) {
      const { data, report } = anchorWithMarkHistory(asOf, fridayMarks);
      const glance = buildGlanceBlock(data, report, 10);
      expect(glance.feedGap.expected, `${asOf} expected`).toBe(13);
      expect(glance.feedGap.missing, `${asOf} stale ${staleCount}`).toHaveLength(
        staleCount,
      );
      expect(glance.feedGap.arrived, `${asOf} arrived`).toBe(13 - staleCount);
    }
  });

  it("reads the weekday in UTC, so a machine west of Greenwich sees the same day", () => {
    // `new Date("2026-07-27")` is UTC midnight; rendered in a negative-offset local
    // zone it is Sunday the 26th. Getting this wrong turns a Monday outage silent —
    // and carry-forward makes the hazard SHARPER, not milder: a Monday misread as a
    // Sunday walks the expectation back to Friday the 24th, so twelvedata's Friday
    // mark would count as fresh and the Monday outage would go unreported.
    const { data, report } = anchorWithMarkHistory("2026-07-27", {
      ...Object.fromEntries(CRYPTO_IDS.map((id) => [id, ["2026-07-27"]])),
      ...Object.fromEntries(TWELVEDATA_IDS.map((id) => [id, ["2026-07-24"]])),
    });
    const glance = buildGlanceBlock(data, report, 10);
    expect(glance.feedGap.expected).toBe(13);
    expect(glance.feedGap.missing).toHaveLength(9);
  });
});
