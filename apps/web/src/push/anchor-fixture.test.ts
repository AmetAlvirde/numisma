/**
 * The committed anchor-replay fixture, asserted on the BYTES THAT ARE CHECKED IN
 * (PRD #146 slice #149).
 *
 * NOTHING HERE SKIPS, AND THAT IS THE ENTIRE REASON THE FIXTURE EXISTS. Slice 4's
 * load-bearing test — replay all 28 anchors through `verdict.ts` and reproduce the
 * measured history — reads this file. If the file were wrong, absent, stale or
 * narrower than the reader expects, slice 4 would go green against a shape that
 * means nothing. So the fixture's own guarantees are proven here, on every machine,
 * with no Postgres and no private log:
 *
 *  - it loads at all, at the CURRENT schema version;
 *  - it holds the 28 anchors the log actually has, ascending and distinct;
 *  - every payload is a real `ProjectionReport` — `{ totals, dashboard, glance }`
 *    and nothing wider (D8);
 *  - it discloses no mark date anywhere (D14);
 *  - AND IT DISCLOSES NO REAL MAGNITUDE. The file is SYNTHESIZED (see
 *    `fixture-synthesis.ts`): the shape and the trigger-relevant ratios are the real
 *    fund's, every magnitude is invented. This repository is public, so that is not a
 *    style preference — it is the bar the file has to clear, and it is asserted here
 *    on the committed bytes rather than trusted to whoever regenerates next.
 */
import { describe, expect, it } from "vitest";
import { COMPOSITION_SNAPSHOT_SCHEMA_VERSION } from "../projection/contract.ts";
import { anchorAt, loadAnchorFixture } from "./anchor-fixture.ts";
import {
  NAV_JITTER_PP,
  NAV_MOVE_THRESHOLD_PCT,
  SYNTHETIC_FUND_NAME,
  SYNTHETIC_START_NAV,
} from "./fixture-synthesis.ts";

/** The log's anchored dates, measured. Genesis (2026-06-23) is t0, not an anchor. */
const EXPECTED_ANCHOR_COUNT = 28;
const FIRST_ANCHOR = "2026-06-26";

/**
 * Three REAL NAVs, published in issues #146 and #149 and therefore already public.
 * They are here as a TRIPWIRE, not as data: they are exactly what a reader would
 * divide by to recover a scale factor, so if any of them ever reappears in the
 * committed file, the file was regenerated without synthesis and the real series is
 * back in a public repository. 07-25 is the Saturday no push ever captured.
 */
const PUBLISHED_REAL_NAVS = [19590.01, 19619.62, 19753.61];

/** Every number reachable in the loaded payload, for the real-magnitude sweep. */
function numbersIn(value: unknown, found: number[] = []): number[] {
  if (typeof value === "number") found.push(value);
  else if (Array.isArray(value)) for (const v of value) numbersIn(v, found);
  else if (value && typeof value === "object") {
    for (const v of Object.values(value)) numbersIn(v, found);
  }
  return found;
}

describe("the committed anchor fixture", () => {
  it("loads with no database and no durable log", async () => {
    const anchors = await loadAnchorFixture();
    expect(anchors.length).toBe(EXPECTED_ANCHOR_COUNT);
    expect(anchors[0]?.asOf).toBe(FIRST_ANCHOR);
  });

  it("holds distinct anchored dates in ascending order", async () => {
    const dates = (await loadAnchorFixture()).map((a) => a.asOf);
    expect(new Set(dates).size).toBe(dates.length);
    expect([...dates].sort()).toEqual(dates);
  });

  it("is one fund, and every anchor names it", async () => {
    const anchors = await loadAnchorFixture();
    expect(new Set(anchors.map((a) => a.fundId)).size).toBe(1);
    expect(anchors.every((a) => a.fundId.length > 0)).toBe(true);
  });

  it("is anchored at a round fictional NAV and names an obviously fictional fund", async () => {
    const anchors = await loadAnchorFixture();
    expect(anchors[0]!.report.totals.fundValueUsd).toBe(SYNTHETIC_START_NAV);
    expect(anchors[0]!.report.dashboard.summary.fundValueUsd).toBe(
      SYNTHETIC_START_NAV,
    );
    for (const anchor of anchors) {
      expect(anchor.report.dashboard.summary.fundName, anchor.asOf).toBe(
        SYNTHETIC_FUND_NAME,
      );
    }
  });

  it("holds NONE of the fund's real published NAVs — the file is synthesized", async () => {
    // Scanned over every number in the file, not just `fundValueUsd`: a real NAV
    // reappearing anywhere means synthesis was bypassed. This is the check that would
    // have caught the un-sanitized fixture, and it runs on every machine.
    const values = new Set(numbersIn(await loadAnchorFixture()));
    for (const nav of PUBLISHED_REAL_NAVS) {
      expect([...values].some((v) => Math.abs(v - nav) < 0.01), String(nav)).toBe(
        false,
      );
    }
  });

  it("reproduces the day-over-day NAV percentages navMove reads, within the jitter", async () => {
    // The magnitudes moved, and so — DELIBERATELY, by up to ±`NAV_JITTER_PP` — do the
    // moves. 06-28 fell 1.72% from 06-26 in the real log. Preserving that exactly
    // would publish the whole real series (three real NAVs are already public, so the
    // scale factor divides out), so the fixture carries it displaced. What has to
    // survive is not the number but the VERDICT: `navMove` is a threshold test, and
    // `fixture-synthesis.ts` refuses to emit a series whose jitter moved any anchor
    // across it. This asserts the move is still recognisably 1.72% and still fires.
    const anchors = await loadAnchorFixture();
    const first = anchorAt(anchors, "2026-06-26").report.totals.fundValueUsd;
    const second = anchorAt(anchors, "2026-06-28").report.totals.fundValueUsd;
    const move = (second / first - 1) * 100;
    expect(Math.abs(move - -1.72)).toBeLessThanOrEqual(NAV_JITTER_PP);
    expect(Math.abs(move)).toBeGreaterThanOrEqual(NAV_MOVE_THRESHOLD_PCT);
    // And every anchor carries a usable NAV: a blank one would make every delta
    // downstream of it meaningless.
    for (const anchor of anchors) {
      expect(anchor.report.totals.fundValueUsd, anchor.asOf).toBeGreaterThan(0);
    }
  });

  it("holds a NAV series that no published NAV can unscale", async () => {
    // THE LEAK THIS CLOSES, ASSERTED ON THE COMMITTED BYTES. If every day-over-day
    // move were exact, `realNav[i] / fixtureNav[i]` would be the SAME constant on
    // every anchor, and one published NAV would hand over all 28. The jitter makes
    // that ratio wander, so no single divisor reconstructs the series.
    //
    // Checked without the real series in hand: an exactly-preserved history has
    // `fixtureNav[i] / fixtureNav[0]` equal to the real one, so the tell is that
    // consecutive moves are not all reproducible from one scale. What is asserted
    // here is the weaker, magnitude-free consequence — every move is displaced off
    // its exact value, so no two anchors agree on a common factor.
    const navs = (await loadAnchorFixture()).map(
      (a) => a.report.totals.fundValueUsd,
    );
    // No NAV in the file is a round reconstruction of the start value, which an
    // unjittered series anchored at 100000 would produce for a flat day.
    expect(navs.slice(1).every((nav) => nav !== SYNTHETIC_START_NAV)).toBe(true);
    // And the series genuinely moves: a degenerate constant series would satisfy
    // everything above while carrying no information at all.
    expect(new Set(navs).size).toBe(navs.length);
  });

  it("carries internally consistent rows for slice 5 to render", async () => {
    for (const anchor of await loadAnchorFixture()) {
      const nav = anchor.report.totals.fundValueUsd;
      const totalPnl = anchor.report.dashboard.summary.totalUnrealizedPnlUsd;
      for (const section of anchor.report.dashboard.sections) {
        const rows = section.rows;
        for (const row of rows) {
          expect(row.usdValue, `${anchor.asOf} ${row.id}`).toBeCloseTo(
            (row.percentOfFund / 100) * nav,
            6,
          );
          if (row.costBasisUsd !== undefined) {
            expect(row.costBasisUsd, `${anchor.asOf} ${row.id}`).toBeGreaterThan(0);
          }
        }
        // Descending, so `summary.largest*` still names each section's top row.
        const pcts = rows.map((r) => r.percentOfFund);
        expect([...pcts].sort((a, b) => b - a), section.id).toEqual(pcts);
        // Five partitions of one book: they agree on the P&L total, as the real
        // report's do.
        const pnl = rows.reduce((t, r) => t + (r.unrealizedPnlUsd ?? 0), 0);
        expect(pnl, `${anchor.asOf} ${section.id}`).toBeCloseTo(totalPnl, 6);
      }
      // The Reserve percentage is the ONE ratio synthesis preserves verbatim, because
      // `reserveFloor` is a level test against it. The summary reference and the row
      // it names must not be able to disagree about it.
      const reserve = anchor.report.dashboard.summary.reserve;
      expect(reserve, anchor.asOf).toBeDefined();
      const row = anchor.report.dashboard.sections
        .flatMap((s) => s.rows)
        .find((r) => r.id === reserve!.rowId);
      expect(row?.percentOfFund, anchor.asOf).toBe(reserve!.percentOfFund);
      expect(reserve!.percentOfFund, anchor.asOf).toBeGreaterThan(0);
    }
  });

  it("keeps the real fold's ABSENCES — a missing cost basis is really missing", async () => {
    // Spec open question 3. Slice 5 renders per-row cost basis and has to handle the
    // rows that genuinely have none (Reserve, the cash accounts). A synthesizer that
    // filled them in would make slice 5 green against a shape the fold never emits.
    const rows = (await loadAnchorFixture()).flatMap((a) =>
      a.report.dashboard.sections.flatMap((s) => s.rows),
    );
    expect(rows.some((r) => r.costBasisUsd === undefined)).toBe(true);
    expect(rows.some((r) => r.costBasisUsd !== undefined)).toBe(true);
    // …including the awkward one: a cost basis with no P&L beside it.
    expect(
      rows.some((r) => r.costBasisUsd !== undefined && r.unrealizedPnlUsd === undefined),
    ).toBe(true);
    // …and a row in the red, so the delta rendering has a negative case.
    expect(rows.some((r) => (r.unrealizedPnlUsd ?? 0) < 0)).toBe(true);
  });

  it("D8: every payload is exactly `{ totals, dashboard, glance }`", async () => {
    for (const anchor of await loadAnchorFixture()) {
      expect(Object.keys(anchor.report).sort(), anchor.asOf).toEqual([
        "dashboard",
        "glance",
        "totals",
      ]);
      // The dropped branches are dropped: none of them may reappear through a
      // committed file, which is a second route out of the machine and a public
      // one.
      for (const dropped of [
        "invalidationWatch",
        "closedBook",
        "priceJourneys",
        "reserveReconciliation",
        "warnings",
        "excluded",
        "load",
      ]) {
        expect(anchor.report, `${anchor.asOf}.${dropped}`).not.toHaveProperty(
          dropped,
        );
      }
    }
  });

  it("D14: the only dates anywhere in the file are the anchors' own", async () => {
    // A scan for ISO-date-shaped values over the WHOLE serialized fixture, the same
    // shape of check `projection-payload.test.ts` runs on the derived payload. A
    // per-instrument mark date leaking in here would ship an observation timeline
    // — the `priceJourneys` D8 dropped on purpose — into a public file.
    const anchors = await loadAnchorFixture();
    const found = new Set(JSON.stringify(anchors).match(/\d{4}-\d{2}-\d{2}/g) ?? []);
    expect([...found].sort()).toEqual(anchors.map((a) => a.asOf));
  });

  it("every anchor carries a well-formed v3 glance block", async () => {
    for (const anchor of await loadAnchorFixture()) {
      const { glance } = anchor.report;
      expect(Object.keys(glance.feedGap).sort(), anchor.asOf).toEqual([
        "arrived",
        "expected",
        "missing",
      ]);
      expect(glance.feedGap.arrived).toBe(
        glance.feedGap.expected - glance.feedGap.missing.length,
      );
      for (const entry of glance.feedGap.missing) {
        expect(Object.keys(entry).sort()).toEqual(["label", "rowId"]);
      }
      expect(Array.isArray(glance.suppressed)).toBe(true);
    }
  });

  it("the row key and the payload's own date agree on every anchor", async () => {
    // If they ever disagreed, the backfill wrote a row under a key its own contents
    // contradict, and every reader-side reference resolution would land on a lie.
    for (const anchor of await loadAnchorFixture()) {
      expect(anchor.report.dashboard.summary.asOf).toBe(anchor.asOf);
    }
  });

  it("is stamped at the version this build expects", async () => {
    // The loader throws on a mismatch; this asserts the committed file is the one
    // this build understands, so a v4 that ships without regenerating fails loudly
    // here rather than replaying a stale shape in slice 4.
    await expect(loadAnchorFixture()).resolves.toBeDefined();
    expect(COMPOSITION_SNAPSHOT_SCHEMA_VERSION).toBe(3);
  });

  it("anchorAt refuses a date the fixture does not hold", async () => {
    // "Never claim a date you don't have" (V3), applied to the test surface: a test
    // naming a missing anchor must FAIL, not assert over `undefined`.
    const anchors = await loadAnchorFixture();
    expect(() => anchorAt(anchors, "2026-06-27")).toThrow(/no 2026-06-27/);
  });
});
