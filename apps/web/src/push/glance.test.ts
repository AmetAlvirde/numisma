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
import { access } from "node:fs/promises";
import type { CompositionReport, FundReviewData } from "@numisma/engine";
import {
  buildCompositionReport,
  instrumentsForSource,
  parseFundReview,
} from "@numisma/engine";
import { loadFoldedReview, resolveEventStorePaths } from "@numisma/event-store";
import { anchorAt, loadAnchorFixture } from "./anchor-fixture.ts";
import { NAV_JITTER_PP } from "./fixture-synthesis.ts";
import { SUPPRESSION_KEYS } from "../projection/contract.ts";
import { buildGlanceBlock } from "./glance.ts";

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
    // Empty rather than absent (slice #151): the builder now also composes the row
    // dependency map, which walks the fold's positions and reserves. A fund with no
    // canonical lines has no ROWS to suppress, which is exactly right for these
    // cases — they are about the three HEADER keys, and they keep asserting the
    // header key list alone.
    positions: [],
    reserves: [],
    portfolios: [],
    accounts: [],
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

describe("the quiet Sunday (the case V1 exists to protect)", () => {
  it("counts all 13 fresh on 2026-07-26 and suppresses nothing", async () => {
    // RE-POINTED AT THE COMMITTED FIXTURE (slice #149), AND THAT IS THE FIX. This
    // case used to fold the private log directly and SELF-SKIP when the log was
    // absent — so the one worked example the spec names, on the one measured day
    // V1 exists for, silently did not run on any machine but the operator's. The
    // fixture is that same day's glance block, produced by THIS builder in a real
    // backfill against the real log and checked in, so the case now runs
    // unconditionally, everywhere.
    const glance = anchorAt(await loadAnchorFixture(), QUIET_SUNDAY).report.glance;

    // THIRTEEN EXPECTED, THIRTEEN ARRIVED — and the 13 is carry-forward's doing, not
    // a weakening. Every registered instrument owes a current mark on every anchor;
    // the nine twelvedata ones are FRESH here because their last expected mark was
    // Friday 2026-07-24 and that is what they carry. The case is unchanged in what it
    // proves: the Sunday is silent.
    expect(glance.feedGap).toEqual({ expected: 13, arrived: 13, missing: [] });
    // 9 of 13 instruments did not QUOTE that day and the header still renders in
    // full. That absence is EXPECTED — twelvedata's venues are shut on a Sunday, so
    // Friday's mark is still the current one — and expected absence suppresses
    // nothing (V1).
    expect(glance.suppressed).toEqual([]);
    expect(glance.reserveTargetPct).toBe(10);
  });

  it("agrees with a live fold of the real log, when the log is present", async ({
    skip,
  }) => {
    // THE HONESTY GATE, NARROWED TO WHAT IS STILL COMPARABLE. The fixture is a
    // RECORDING, and this is the case that keeps it from drifting away from the log
    // it was recorded from: when the private log IS on the machine, rebuild the same
    // anchor live and require the two to agree.
    //
    // It compares the TRIGGER-RELEVANT PROJECTIONS ONLY — the glance block, the
    // Reserve percentage, and the structural shape — because the fixture is
    // SYNTHESIZED (`fixture-synthesis.ts`) and its magnitudes deliberately differ
    // from the real fold's. Comparing payloads wholesale would fail by design and
    // teach the next reader to delete the check. What it still catches is the failure
    // that matters: a fixture whose SHAPE no longer matches the real log — a row
    // added, renamed, re-kinded, or a cost basis that appeared or vanished.
    //
    // It self-skips without the log — correctly, because a machine that does not hold
    // the private log is a normal machine — and the unconditional case above no
    // longer depends on it.
    if (!(await realLogAvailable())) {
      skip();
      return;
    }

    const data = await loadFoldedReview(resolveEventStorePaths(), QUIET_SUNDAY);
    const report = buildCompositionReport(data);
    // Guard against the fold silently answering a different question than the one
    // asked: every assertion below is about THIS anchor.
    expect(report.dashboard.summary.asOf).toBe(QUIET_SUNDAY);
    const recorded = anchorAt(await loadAnchorFixture(), QUIET_SUNDAY).report;

    // 1. The glance block, verbatim — synthesis copies it, so this is a true equality.
    expect(buildGlanceBlock(data, report, 10)).toEqual(recorded.glance);

    // 2. The Reserve percentage, verbatim — `reserveFloor` is a level test on it.
    expect(recorded.dashboard.summary.reserve?.percentOfFund).toBe(
      report.dashboard.summary.reserve?.percentOfFund,
    );

    // 3. The structural shape: section ids/titles/order, row ids/kinds/labels/order,
    // and — spec open question 3 — exactly which rows carry a cost basis and a P&L.
    const shape = (sections: CompositionReport["dashboard"]["sections"]): string =>
      sections
        .map(
          (section) =>
            `${section.id}|${section.title}|` +
            section.rows
              .map(
                (row) =>
                  `${row.id}:${row.kind}:${row.label}:` +
                  `${row.costBasisUsd !== undefined}:${row.unrealizedPnlUsd !== undefined}`,
              )
              .join(","),
        )
        .join("//");
    expect(shape(recorded.dashboard.sections)).toBe(shape(report.dashboard.sections));

    // 4. NAV moves, not NAV levels — TO WITHIN THE JITTER, and the tolerance is the
    // sanitization rather than sloppiness.
    //
    // WHY THE EXACTNESS WAS TRADED AWAY, so nobody "tightens" this back and silently
    // re-opens the leak: a day-over-day series preserved EXACTLY is the real NAV
    // series up to one unknown factor, and issues #146/#149 publish three real NAVs,
    // so dividing recovers the factor and unscales every day of it. `NAV_JITTER_PP`
    // displaces every move by up to ±0.05 PERCENTAGE POINTS to close that, which
    // moves this ratio by at most `NAV_JITTER_PP / 100`. A tighter bound here would
    // fail; a looser one would stop catching the drift this case exists to catch.
    const anchors = await loadAnchorFixture();
    const previous = anchors[anchors.findIndex((a) => a.asOf === QUIET_SUNDAY) - 1];
    expect(previous).toBeDefined();
    const priorFold = buildCompositionReport(
      await loadFoldedReview(resolveEventStorePaths(), previous!.asOf),
    );
    const recordedRatio =
      anchorAt(anchors, QUIET_SUNDAY).report.totals.fundValueUsd /
      previous!.report.totals.fundValueUsd;
    const realRatio = report.totals.fundValueUsd / priorFold.totals.fundValueUsd;
    expect(Math.abs(recordedRatio - realRatio)).toBeLessThanOrEqual(
      NAV_JITTER_PP / 100,
    );

    // False-pass guard: the fixture must NOT be a verbatim copy of the real fold.
    // If synthesis were ever bypassed, everything above would still pass.
    expect(recorded.totals.fundValueUsd).not.toBe(report.totals.fundValueUsd);
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

/**
 * PER-ROW SUPPRESSION (slice #151) — the load-bearing case of the whole slice, and
 * the one the acceptance criteria name: *a missing crypto mark suppresses the
 * instrument row AND the tempo / account / tier rows that aggregate it, and leaves
 * the rows that do not.*
 *
 * WHY THE FIXTURE IS SHAPED THE WAY IT IS. The claim under test is that suppression
 * comes from `composeRowDependencies` — a real map over the fold — and not from
 * matching an instrument id against a row id. So the fixture is built to make a
 * name-prefix implementation fail in BOTH directions at once:
 *
 *  - `account:btc` is an account LITERALLY NAMED `btc` that holds no BTC (only ETH).
 *    A prefix guess suppresses it. The map must not: its number is fine.
 *  - `tempo:Storage`, `account:vault`, `portfolio:alpha` and `tier:c1` hold nothing
 *    BUT BTC and say so nowhere in their ids. A prefix guess leaves them standing —
 *    which is the worse error: a number rendered off a mark that never arrived.
 *
 * The mechanical anti-coincidence assertion is spelled out at the end: of the eleven
 * row ids in play, EXACTLY ONE contains the substring "btc" that is not the
 * instrument row, and it is the one row that must NOT be suppressed.
 */
describe("per-row suppression: a missing crypto mark, and what it poisons", () => {
  /** A Tuesday — every venue is open, so all thirteen instruments are expected. */
  const ANCHOR = "2026-07-28";
  /** Every registered instrument marks on the anchor EXCEPT btc. */
  const MARKED = ALL_IDS.filter((id) => id !== "btc");

  const lots = (quantity: number, cost: number, tier: string) => [
    { quantity, cost, tier },
  ];

  const REVIEW: unknown = {
    fund: { id: "row-suppression", name: "Row Suppression Fund", baseCurrency: "USD" },
    review: { asOf: ANCHOR, usdMxn: 17.31 },
    portfolios: [
      { id: "alpha", name: "Alpha" },
      { id: "beta", name: "Beta" },
    ],
    accounts: [
      // THE DECOY. Named `btc`, holds ETH.
      { id: "btc", name: "Confusingly Named Desk", platform: "XTB", currency: "USD" },
      { id: "vault", name: "Vault", platform: "T1", currency: "USD" },
      { id: "desk", name: "Equities Desk", platform: "GBM", currency: "USD" },
      { id: "cashbox", name: "Cash", platform: "XTB", currency: "USD" },
    ],
    instruments: ALL_IDS.map((id) => ({
      id,
      name: `Test ${id}`,
      symbol: id.toUpperCase(),
      currency: "USD",
    })),
    reserves: [
      {
        id: "cash-beta",
        portfolioId: "beta",
        tempo: "Reserve",
        executionMode: "live",
        accountId: "cashbox",
        currency: "USD",
        amount: 5000,
      },
    ],
    positions: [
      {
        id: "btc-in-the-vault",
        portfolioId: "alpha",
        tempo: "Storage",
        executionMode: "live",
        accountId: "vault",
        instrumentId: "btc",
        direction: "long",
        markPrice: 100000,
        currency: "USD",
        lots: lots(0.1, 8000, "c1"),
      },
      {
        id: "eth-in-the-btc-account",
        portfolioId: "beta",
        tempo: "Trading",
        executionMode: "live",
        accountId: "btc",
        instrumentId: "eth",
        direction: "long",
        markPrice: 3000,
        currency: "USD",
        lots: lots(2, 5000, "c2"),
      },
      {
        id: "aapl-on-the-desk",
        portfolioId: "beta",
        tempo: "Trading",
        executionMode: "live",
        accountId: "desk",
        instrumentId: "aapl",
        direction: "long",
        markPrice: 200,
        currency: "USD",
        lots: lots(10, 1500, "c2"),
      },
    ],
    closes: MARKED.map((id) => ({ instrumentId: id, asOf: ANCHOR, price: 1 })),
  };

  function fold(): { data: FundReviewData; report: CompositionReport } {
    const parsed = parseFundReview(REVIEW);
    if (parsed.kind !== "ok") {
      throw new Error(`the per-row fixture does not parse: ${parsed.kind}`);
    }
    return { data: parsed.value, report: buildCompositionReport(parsed.value) };
  }

  const { data, report } = fold();
  const glance = buildGlanceBlock(data, report, 10);
  const suppressed = new Set(glance.suppressed);

  it("names btc, and only btc, as the shortfall", () => {
    // False-pass guard: if a second instrument were also missing, the split below
    // would be about something other than the case the criteria name.
    expect(glance.feedGap.missing.map((m) => m.rowId)).toEqual(["instrument:btc"]);
  });

  it("suppresses the instrument row AND every aggregate row that holds it", () => {
    for (const rowId of [
      "instrument:btc",
      "tempo:Storage",
      "account:vault",
      "portfolio:alpha",
      "tier:c1",
    ]) {
      expect([...suppressed], rowId).toContain(rowId);
    }
  });

  it("leaves every row that does NOT hold it — including the decoy account", () => {
    for (const rowId of [
      "account:btc", // named for it, holds none of it
      "instrument:eth",
      "instrument:aapl",
      "instrument:reserve",
      "tempo:Trading",
      "tempo:Reserve",
      "account:desk",
      "account:cashbox",
      "portfolio:beta",
      "tier:c2",
    ]) {
      expect([...suppressed], rowId).not.toContain(rowId);
    }
  });

  it("cannot be passing by name coincidence — the ids say so mechanically", () => {
    // THE ANTI-COINCIDENCE ASSERTION. Every SUPPRESSED aggregate row id is free of
    // the string "btc", so no substring rule could have produced them; and the ONE
    // row id that does contain "btc" while not being the instrument row is precisely
    // the row left standing. A prefix implementation fails this test in both
    // directions, which is the only way to prove the map is doing the work.
    const aggregates = [...suppressed].filter(
      (id) => id !== "instrument:btc" && !id.startsWith("summary."),
    );
    expect(aggregates.length).toBeGreaterThan(0);
    for (const rowId of aggregates) {
      expect(rowId, `${rowId} must not name the instrument`).not.toContain("btc");
    }
    const rowIds = report.dashboard.sections.flatMap((s) => s.rows.map((r) => r.id));
    expect(rowIds.filter((id) => id.includes("btc")).sort()).toEqual([
      "account:btc",
      "instrument:btc",
    ]);
    expect(suppressed.has("account:btc")).toBe(false);
  });

  it("keeps the three header keys first, then the rows — one flat key list, no v4", () => {
    // Slice 2 chose a key LIST over N booleans precisely so this slice costs no
    // schema change. Assert the encoding, not just the contents.
    expect(glance.suppressed.slice(0, 3)).toEqual([
      SUPPRESSION_KEYS.fundValue,
      SUPPRESSION_KEYS.change,
      SUPPRESSION_KEYS.reserve,
    ]);
    expect(new Set(glance.suppressed).size).toBe(glance.suppressed.length);
    expect(glance.suppressed.every((key) => typeof key === "string")).toBe(true);
  });

  it("suppresses NO row when every mark arrived", () => {
    // The other half of the claim: row suppression is caused by the absence, not by
    // the presence of a dependency map. Mark btc too and the whole table stands.
    const complete = {
      ...(REVIEW as Record<string, unknown>),
      closes: ALL_IDS.map((id) => ({ instrumentId: id, asOf: ANCHOR, price: 1 })),
    };
    const parsed = parseFundReview(complete);
    if (parsed.kind !== "ok") throw new Error(parsed.kind);
    const clean = buildGlanceBlock(parsed.value, buildCompositionReport(parsed.value), 10);
    expect(clean.feedGap.missing).toEqual([]);
    expect(clean.suppressed).toEqual([]);
  });

  it("every suppressed row id is a row the payload actually carries", () => {
    // A key naming a row the reader will never see is dead weight the reader cannot
    // act on — and would hide a drift between the map and the report.
    const rowIds = new Set(
      report.dashboard.sections.flatMap((s) => s.rows.map((r) => r.id)),
    );
    for (const key of glance.suppressed) {
      if (key.startsWith("summary.")) continue;
      expect([...rowIds], key).toContain(key);
    }
  });
});
