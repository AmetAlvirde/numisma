/**
 * The glance builder (PRD #146 seam B, slice #148) — the four cases the spec names.
 *
 * The load-bearing one is THE QUIET SUNDAY, because it is the case V1 exists to
 * protect: 9 of 13 instruments have no mark on 2026-07-26, and that is not a
 * failure — it is a weekend. A builder that keyed suppression on mark AGE rather
 * than on UNEXPECTED absence would blank the header every Saturday and Sunday, which
 * is a false *yes* on 2 days in 7 and would train the operator to ignore the surface.
 *
 * The Sunday case runs against the REAL durable log (`NUMISMA_DATA_DIR` /
 * accumulus), because the whole point of it is that it is a measured day and not a
 * fixture somebody wrote to agree with the code. It SELF-SKIPS when the log is not
 * on the machine — the log is private, git-ignored, and must never be committed
 * (see accumulus). The outage, floor and R2 cases are constructed, so they run
 * everywhere.
 */
import { describe, expect, it } from "vitest";
import { access } from "node:fs/promises";
import type { CompositionReport, FundReviewData } from "@numisma/engine";
import { buildCompositionReport, instrumentsForSource } from "@numisma/engine";
import { loadFoldedReview, resolveEventStorePaths } from "@numisma/event-store";
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
 * Is the operator's real durable log present on this machine? The real-log cases
 * skip rather than fail without it — a machine that does not hold the private log
 * is a normal machine, not a broken one.
 */
async function realLogAvailable(): Promise<boolean> {
  try {
    const paths = resolveEventStorePaths();
    await access(paths.genesis);
    await access(paths.log);
    return true;
  } catch {
    return false;
  }
}

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

describe("the quiet Sunday over the REAL log (the case V1 exists to protect)", () => {
  it("expects only the 4 crypto ids on 2026-07-26 and suppresses nothing", async ({
    skip,
  }) => {
    if (!(await realLogAvailable())) {
      skip();
      return;
    }

    const data = await loadFoldedReview(resolveEventStorePaths(), QUIET_SUNDAY);
    const report = buildCompositionReport(data);
    // Guard against the fold silently answering a different question than the one
    // asked: every assertion below is about THIS anchor.
    expect(report.dashboard.summary.asOf).toBe(QUIET_SUNDAY);

    const glance = buildGlanceBlock(data, report, 10);

    expect(glance.feedGap).toEqual({ expected: 4, arrived: 4, missing: [] });
    // 9 of 13 instruments have no mark that day and the header still renders in
    // full. That absence is EXPECTED — twelvedata's venues are shut on a Sunday —
    // and expected absence suppresses nothing (V1).
    expect(glance.suppressed).toEqual([]);
    expect(glance.reserveTargetPct).toBe(10);
  });

  it("is the same 9-of-13 shortfall that WOULD be an outage on a weekday", async ({
    skip,
  }) => {
    // False-pass guard for the case above. If the fold at 2026-07-26 actually
    // carried all thirteen marks, `missing: []` would be true for the wrong reason
    // and the V1 rule would be untested. Prove the shortfall is real first.
    if (!(await realLogAvailable())) {
      skip();
      return;
    }
    const data = await loadFoldedReview(resolveEventStorePaths(), QUIET_SUNDAY);
    const marked = new Set(
      (data.closes ?? [])
        .filter((c) => c.asOf === QUIET_SUNDAY)
        .map((c) => c.instrumentId),
    );
    expect([...marked].sort()).toEqual([...CRYPTO_IDS].sort());
    expect(ALL_IDS.filter((id) => !marked.has(id))).toHaveLength(9);
  });
});

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

describe("the venue calendar", () => {
  it("expects crypto every day of the week and twelvedata only Mon–Fri", () => {
    // 2026-07-25 Sat, 26 Sun, 27 Mon … 31 Fri.
    const expectedByDate = new Map(
      [
        ["2026-07-25", 4],
        ["2026-07-26", 4],
        ["2026-07-27", 13],
        ["2026-07-28", 13],
        ["2026-07-29", 13],
        ["2026-07-30", 13],
        ["2026-07-31", 13],
      ].map(([date, expected]) => [date as string, expected as number]),
    );
    for (const [asOf, expected] of expectedByDate) {
      const { data, report } = constructedAnchor(asOf, ALL_IDS);
      expect(
        buildGlanceBlock(data, report, 10).feedGap.expected,
        `${asOf} expected ${expected}`,
      ).toBe(expected);
    }
  });

  it("reads the weekday in UTC, so a machine west of Greenwich sees the same day", () => {
    // `new Date("2026-07-27")` is UTC midnight; rendered in a negative-offset local
    // zone it is Sunday the 26th. Getting this wrong turns a Monday outage silent.
    const { data, report } = constructedAnchor("2026-07-27", CRYPTO_IDS);
    expect(buildGlanceBlock(data, report, 10).feedGap.expected).toBe(13);
  });
});
