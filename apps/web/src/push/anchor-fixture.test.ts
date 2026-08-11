/**
 * The committed anchor-replay fixture, asserted on the BYTES THAT ARE CHECKED IN
 * (PRD #146 slice #149).
 *
 * NOTHING HERE SKIPS, AND THAT IS THE ENTIRE REASON THE FIXTURE EXISTS. Slice 4's
 * load-bearing test — replay every anchor through `verdict.ts` and reproduce the
 * measured history — reads this file. If the file were wrong, absent, stale or
 * narrower than the reader expects, slice 4 would go green against a shape that
 * means nothing. So the fixture's own guarantees are proven here, on every machine,
 * with no Postgres and no private log:
 *
 *  - it loads at all, at the CURRENT schema version;
 *  - it holds every anchor the log has, ascending and distinct, starting where the
 *    log's anchored history starts;
 *  - every payload is a real `ProjectionReport` — `{ totals, dashboard, glance }`
 *    and nothing wider (D8);
 *  - it discloses no mark date anywhere (D14);
 *  - AND IT DISCLOSES NO REAL MAGNITUDE. The file is SYNTHESIZED (see
 *    `fixture-synthesis.ts`): the shape and the trigger-relevant ratios are the real
 *    fund's, every magnitude is invented. This repository is public, so that is not a
 *    style preference — it is the bar the file has to clear, and it is asserted here
 *    on the committed bytes rather than trusted to whoever regenerates next.
 *
 * THE MAGNITUDE ASSERTIONS NAME NO REAL NUMBER, and that is a requirement on THIS FILE
 * too, not only on the fixture. An earlier form compared against three real NAVs and
 * against the real 06-28 move — which put the guarded values into a public repository
 * to guard them. Both are now expressed as properties: NAV sits inside the synthetic
 * band, and the 06-28 move still crosses the threshold. Whether the synthesized series
 * stayed faithful to the real one is checked at REGENERATION, by
 * `assertThresholdSideHolds`, which legitimately has the real series in hand and never
 * commits it.
 *
 * MUTATION-CHECKED (spec #285, slice 3): the committed file's `planId` replaced with a
 * real-shaped UUID and one rung `id` with an operator-shaped `r3`. The synthetic-id
 * guard goes red naming the offending value and the anchor it sits on. Restored after.
 */
import { describe, expect, it } from "vitest";
import { COMPOSITION_SNAPSHOT_SCHEMA_VERSION } from "../projection/contract.ts";
import { anchorAt, loadAnchorFixture } from "./anchor-fixture.ts";
import {
  NAV_MOVE_THRESHOLD_PCT,
  SYNTHETIC_FUND_ID,
  SYNTHETIC_PLAN_ID_PREFIX,
  SYNTHETIC_POSITION_PREFIX,
  SYNTHETIC_FUND_NAME,
  SYNTHETIC_START_NAV,
  syntheticRungId,
} from "./fixture-synthesis.ts";

/**
 * Where the log's anchored history starts. Genesis (2026-06-23) is t0, not an anchor.
 *
 * THE TOTAL COUNT IS DELIBERATELY NOT PINNED. The fixture grows by one on every push
 * — `pnpm backfill -- --fixture-only` is the only supported regeneration path, and
 * the thing an operator runs after any glance change — so a hard-coded 28 turns red
 * on a day whose only event was the fund having a normal one. What the count was
 * really guarding is that the file is not narrower than its readers expect, and that
 * is asserted below as properties the file keeps as it grows: it starts here, it
 * holds the dates this suite names, and it is longer than the handful of anchors any
 * single test reads.
 */
const FIRST_ANCHOR = "2026-06-26";

/**
 * The anchors THIS suite reads by name. Every one must be present, or the assertions
 * that read them would be asserting over a fixture that no longer contains the case
 * they were written for. `anchorAt` already throws on a missing date; naming them
 * here makes the dependency legible in one place instead of four call sites.
 */
const NAMED_ANCHORS = [FIRST_ANCHOR, "2026-06-28"];

/**
 * The tripwire's band, expressed WITHOUT the real series.
 *
 * This used to hold three real NAVs and assert none of them appeared in the file.
 * That worked, but it put the very numbers it was protecting into a public
 * repository — and it only ever sampled three anchors out of the whole file.
 *
 * The magnitude-free form is strictly stronger. Synthesis re-anchors the series at
 * {@link SYNTHETIC_START_NAV} and carries it forward by day-over-day moves that are
 * small by construction, so EVERY synthesized NAV sits near that anchor. The real
 * fund's NAV is a different order of magnitude entirely. So "is every number in the
 * file inside the synthetic band" catches a bypassed synthesis on EVERY anchor,
 * needs no real value to compare against, and cannot itself leak one.
 */
const SYNTHETIC_BAND_FACTOR = 2;

describe("the committed anchor fixture", () => {
  it("loads with no database and no durable log", async () => {
    const anchors = await loadAnchorFixture();
    const dates = anchors.map((a) => a.asOf);
    expect(dates[0]).toBe(FIRST_ANCHOR);
    // A real history, not a stub: the named cases are all here, and there is more in
    // the file than the cases any one test reads.
    for (const named of NAMED_ANCHORS) {
      expect(dates, `the fixture no longer holds ${named}`).toContain(named);
    }
    expect(dates.length).toBeGreaterThan(NAMED_ANCHORS.length);
    // AND IT NEVER SHRINKS. The count is not pinned, but a floor is: the old
    // equality pin at least caught a fixture that lost anchors, and dropping it
    // outright would let a regeneration that silently emitted ten fewer interior
    // days pass every assertion in this suite. A `>=` floor keeps that guard while
    // costing nothing as the file grows — it needs no edit on the ordinary day the
    // fixture gains an anchor, and moves only on a DELIBERATE truncation, which is
    // exactly the change that should have to be typed out here.
    expect(dates.length).toBeGreaterThanOrEqual(28);
  });

  it("holds distinct anchored dates in ascending order", async () => {
    const dates = (await loadAnchorFixture()).map((a) => a.asOf);
    expect(new Set(dates).size).toBe(dates.length);
    expect([...dates].sort()).toEqual(dates);
  });

  it("is one fund, and every anchor names it — by its SYNTHETIC id", async () => {
    // On the COMMITTED BYTES, not on the generator's output: the file is what this
    // public repository publishes, and the real `fund_id` used to be in it on every
    // anchor. A regeneration that bypassed synthesis would put it back, and a
    // generator-side test would not notice.
    const anchors = await loadAnchorFixture();
    expect(new Set(anchors.map((a) => a.fundId))).toEqual(
      new Set([SYNTHETIC_FUND_ID]),
    );
  });

  it("names every DCA plan by its SYNTHETIC id — no operator-authored string", async () => {
    // Also on the COMMITTED BYTES, and for the reason the fund-id guard exists: this
    // is the assertion whose absence let one real `positionId` ship into a public
    // repository (PR #282). A plan id comes from the private sidecar and its
    // convention names a live position's venue, instrument and strategy, so the file
    // must carry nothing but `synthetic-position-N` — checked against what is on
    // disk, not against what the generator would emit if re-run.
    const anchors = await loadAnchorFixture();
    const shape = new RegExp(`^${SYNTHETIC_POSITION_PREFIX}-\\d+$`);
    const seen = new Set<string>();
    for (const anchor of anchors) {
      for (const position of anchor.report.dca.positions) {
        expect(position.positionId, anchor.asOf).toMatch(shape);
        seen.add(position.positionId);
      }
    }
    // Numbered from 1 with no gaps, which is what `synthesizePositionIds` promises and
    // the only way the ordinals disclose nothing beyond the count.
    expect([...seen].sort()).toEqual(
      Array.from({ length: seen.size }, (_unused, i) => `${SYNTHETIC_POSITION_PREFIX}-${i + 1}`).sort(),
    );
  });

  it("names every LADDER and every RUNG by its synthetic id — v5's two identifiers", async () => {
    // The same claim the `positionId` guard above makes, extended to the two identifiers
    // v5 put on the wire, and on the COMMITTED BYTES for the same reason: a `planId` is
    // a UUID minted into the operator's private sidecar and a rung `id` is authored
    // beside it, so neither is a string this repository wrote. The authorship test — not
    // the is-it-a-magnitude test — is what puts both on the synthesized side.
    const anchors = await loadAnchorFixture();
    const planShape = new RegExp(`^${SYNTHETIC_PLAN_ID_PREFIX}\\d{12}$`);
    let ladders = 0;
    for (const anchor of anchors) {
      for (const position of anchor.report.dca.positions) {
        if (position.kind === "dcaLadder") {
          ladders += 1;
          expect(position.planId, `${anchor.asOf} ${position.positionId}`).toMatch(planShape);
        }
        // A rung on a v5 file always carries an id: a ladder row without one is a v4 row
        // wearing a v5 label, and the route resolves rungs by this key.
        (position.rungs ?? []).forEach((rung, index) => {
          expect(rung.id, `${anchor.asOf} rung ${index}`).toBe(syntheticRungId(index));
        });
      }
    }
    // False-pass guard: with no ladder in the file the loop above asserts nothing, which
    // is the failure mode a shape scan over real data is most prone to.
    expect(ladders).toBeGreaterThan(0);
  });

  it("records NO FILL STATE — history has none, and absence is the right answer", async () => {
    // AC/`G-D9`: a June anchor cannot carry fill data. Every fill field is optional and
    // every one of them is ABSENT here, which is the same shape a v4 row has and exactly
    // what the surface renders as day zero. A synthesizer that invented a fill history
    // would make slice 4 green against a state the fund has never been in.
    for (const anchor of await loadAnchorFixture()) {
      for (const position of anchor.report.dca.positions) {
        expect(position.figures, anchor.asOf).toBeUndefined();
        expect(position.orphanLots, anchor.asOf).toBeUndefined();
        for (const rung of position.rungs ?? []) {
          expect(Object.keys(rung).sort(), anchor.asOf).toEqual(["id", "priceUsd"]);
        }
      }
    }
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

  it("carries no NAV of real magnitude — the file is synthesized", async () => {
    // Every anchor's NAV, not a sample of three: a series of real magnitude anywhere
    // in the file means synthesis was bypassed. This is the check that would have
    // caught the un-sanitized fixture, and it runs on every machine.
    const anchors = await loadAnchorFixture();
    const low = SYNTHETIC_START_NAV / SYNTHETIC_BAND_FACTOR;
    const high = SYNTHETIC_START_NAV * SYNTHETIC_BAND_FACTOR;
    for (const anchor of anchors) {
      const nav = anchor.report.totals.fundValueUsd;
      expect(nav, `${anchor.asOf} NAV is outside the synthetic band`).toBeGreaterThan(
        low,
      );
      expect(nav, `${anchor.asOf} NAV is outside the synthetic band`).toBeLessThan(
        high,
      );
    }
  });

  it("reproduces the day-over-day NAV percentages navMove reads, within the jitter", async () => {
    // The magnitudes moved, and so — DELIBERATELY, by up to ±`NAV_JITTER_PP` — do the
    // moves. 06-28 fell against 06-26 in the real log by more than the threshold.
    // Preserving that move exactly would publish the whole real series, so the fixture
    // carries it displaced. What has to survive is not the number but the VERDICT:
    // `navMove` is a threshold test, and `fixture-synthesis.ts` refuses to emit a
    // series whose jitter moved any anchor across it.
    //
    // Asserted as a PROPERTY, not against the real value. Naming the real move here
    // and bounding the fixture within ±`NAV_JITTER_PP` of it would disclose that move
    // to within the jitter — handing back exactly what the jitter exists to withhold.
    // Faithfulness to the real series is `assertThresholdSideHolds`'s job, at
    // regeneration, where the real series is legitimately in hand.
    const anchors = await loadAnchorFixture();
    const first = anchorAt(anchors, "2026-06-26").report.totals.fundValueUsd;
    const second = anchorAt(anchors, "2026-06-28").report.totals.fundValueUsd;
    const move = (second / first - 1) * 100;
    expect(move).toBeLessThan(0);
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
    // every anchor, and one published NAV would hand over the whole series. The jitter makes
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

  it("D8: every payload is exactly `{ totals, dashboard, glance, dca }`", async () => {
    for (const anchor of await loadAnchorFixture()) {
      expect(Object.keys(anchor.report).sort(), anchor.asOf).toEqual([
        "dashboard",
        "dca",
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

  it("every anchor carries a well-formed glance block", async () => {
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
    // this build understands, so a version that ships without regenerating fails loudly
    // here rather than replaying a stale shape in the verdict replay.
    //
    // PINNED TO `CURRENT`, NOT TO THE READER'S SUPPORTED RANGE, and the difference is
    // deliberate. The reader accepts an older stored row because it cannot choose what
    // the projection already holds; this file is a COMMITTED ARTIFACT this repository
    // does choose, and letting it sit at the floor would let a stale fixture replay
    // forever under a range that was widened for a different reason.
    await expect(loadAnchorFixture()).resolves.toBeDefined();
    expect(COMPOSITION_SNAPSHOT_SCHEMA_VERSION).toBe(5);
  });

  it("anchorAt refuses a date the fixture does not hold", async () => {
    // "Never claim a date you don't have" (V3), applied to the test surface: a test
    // naming a missing anchor must FAIL, not assert over `undefined`.
    const anchors = await loadAnchorFixture();
    expect(() => anchorAt(anchors, "2026-06-27")).toThrow(/no 2026-06-27/);
  });
});
