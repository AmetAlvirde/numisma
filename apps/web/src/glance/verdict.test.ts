/**
 * The verdict module's unit surface (PRD #146 slice #150).
 *
 * The load-bearing test — all 28 anchors replayed against the measured history —
 * lives in `verdict-replay.test.ts`. THIS file covers the cases the replay cannot
 * reach, and every one of them is a case real history does not contain:
 *
 *  - a Reserve floor breach (there is none in 34 days of log, R4);
 *  - a genesis anchor whose glance is CLEAN (the real first anchor's is not — see
 *    the synthetic-genesis test for why that distinction is the whole point);
 *  - a missing Reserve policy (the sidecar has covered every anchor so far);
 *  - a stale anchor (launchd has anchored daily since it was installed);
 *  - a same-day collision between two triggers (never observed — the precedence
 *    order is CHOSEN, and this is where the choice is actually exercised).
 *
 * Every anchor here is derived from the committed fixture and then deliberately
 * mutated, so the shapes are the real fold's even where the values are invented.
 */
import { describe, expect, it } from "vitest";
import type { SnapshotAnchor } from "../projection/contract.ts";
import { anchorAt, loadAnchorFixture } from "../push/anchor-fixture.ts";
import {
  NAV_MOVE_THRESHOLD_PCT,
  STALE_ANCHOR_DAYS,
  TRIGGER_PRECEDENCE,
  computeVerdict,
  resolveNearestAnchor,
} from "./verdict.ts";

/** Anchors up to and including `asOf` — what the surface could have known that day. */
async function historyThrough(asOf: string): Promise<SnapshotAnchor[]> {
  const anchors = await loadAnchorFixture();
  const cut = anchors.findIndex((anchor) => anchor.asOf === asOf);
  expect(cut, `the fixture holds no ${asOf}`).toBeGreaterThanOrEqual(0);
  return anchors.slice(0, cut + 1);
}

/** A deep copy, so a mutation in one test cannot reach another's anchors. */
function clone(anchor: SnapshotAnchor): SnapshotAnchor {
  return structuredClone(anchor);
}

/** Force an anchor's Reserve percentage — both places the payload states it. */
function withReserve(anchor: SnapshotAnchor, percentOfFund: number): SnapshotAnchor {
  const next = clone(anchor);
  const reserve = next.report.dashboard.summary.reserve;
  if (!reserve) throw new Error(`${anchor.asOf} has no reserve focus to force`);
  reserve.percentOfFund = percentOfFund;
  for (const section of next.report.dashboard.sections) {
    for (const row of section.rows) {
      if (row.id === reserve.rowId) row.percentOfFund = percentOfFund;
    }
  }
  return next;
}

/** Midday UTC on a calendar date — the wall clock the reader is handed. */
function at(asOf: string): Date {
  return new Date(`${asOf}T12:00:00Z`);
}

describe("the trigger constants", () => {
  it("names every threshold rather than inlining it", () => {
    expect(NAV_MOVE_THRESHOLD_PCT).toBe(1.5);
    expect(STALE_ANCHOR_DAYS).toBe(2);
  });

  it("orders precedence freshness > feedGap > reserveFloor > navMove", () => {
    expect([...TRIGGER_PRECEDENCE]).toEqual([
      "freshness",
      "feedGap",
      "reserveFloor",
      "navMove",
    ]);
  });
});

describe("a quiet day — D1's default", () => {
  it("says no, and renders all three slots", async () => {
    const anchors = await historyThrough("2026-07-27");
    const verdict = computeVerdict(anchors[anchors.length - 1]!, anchors, at("2026-07-27"));

    expect(verdict.needsYou).toBe(false);
    expect(verdict.fired).toEqual([]);
    expect(verdict.slots.fundValue.rendered).toBe(true);
    expect(verdict.slots.reserve.rendered).toBe(true);
    // D4: the change is always against a NAMED reference, never a bare "today".
    expect(verdict.slots.change.rendered).toBe(true);
    expect(verdict.slots.change.referenceAsOf).toBe("2026-07-26");
    expect(verdict.slots.change.referenceLabel).toBe("Sun 26 Jul");
  });
});

describe("navMove", () => {
  it("fires on 2026-07-14 and names its own reference in the verdict", async () => {
    const anchors = await historyThrough("2026-07-14");
    const verdict = computeVerdict(anchors[anchors.length - 1]!, anchors, at("2026-07-14"));

    expect(verdict.needsYou).toBe(true);
    expect(verdict.fired.map((t) => t.name)).toEqual(["navMove"]);
    // The verdict names the CONDITION; the slot carries the NUMBER.
    expect(verdict.sentence).toBe("Fund moved more than 1.5% since Mon 13 Jul");
    expect(verdict.sentence).not.toMatch(/1\.8/);
    expect(verdict.slots.change.rendered).toBe(true);
    expect(verdict.slots.change.percent).toBeCloseTo(1.8329, 3);
    expect(verdict.slots.change.referenceAsOf).toBe("2026-07-13");
  });

  it("declines when its own reference anchor has withheld provenance (rule 1)", async () => {
    // 2026-06-28 moved −1.68% in the fixture (−1.72% real), comfortably past the
    // threshold — and does NOT fire, because its reference 06-26 is withheld. This
    // is the reason `anchor-fixture.ts`'s header can say "navMove on 07-14 only"
    // while three anchors cross 1.5%: the header describes the SUPPRESSION
    // COMPOSITION, not the threshold.
    const anchors = await historyThrough("2026-06-28");
    const latest = anchors[anchors.length - 1]!;
    const move =
      (latest.report.totals.fundValueUsd /
        anchorAt(anchors, "2026-06-26").report.totals.fundValueUsd -
        1) *
      100;
    expect(Math.abs(move)).toBeGreaterThan(NAV_MOVE_THRESHOLD_PCT);

    const verdict = computeVerdict(latest, anchors, at("2026-06-28"));
    expect(verdict.fired).toEqual([]);
    expect(verdict.needsYou).toBe(false);
    // Per-number suppression, the one split real history produces: the reference is
    // unshowable, so Change alone goes — fund value and Reserve still render.
    expect(verdict.slots.change.rendered).toBe(false);
    expect(verdict.slots.change.suppressedBy).toBe("reference-withheld");
    expect(verdict.slots.change.referenceAsOf).toBe("2026-06-26");
    expect(verdict.slots.fundValue.rendered).toBe(true);
    expect(verdict.slots.reserve.rendered).toBe(true);
  });
});

describe("nearest-anchor resolution (V3)", () => {
  it("lands on the nearest anchor <= the target and never claims the target", async () => {
    // From 07-03 the requested reference is 07-02, which was never anchored; the
    // nearest anchor at-or-before it is 06-30 — a three-day step.
    const anchors = await historyThrough("2026-07-03");
    expect(resolveNearestAnchor(anchors, "2026-07-02")?.asOf).toBe("2026-06-30");
    const verdict = computeVerdict(anchors[anchors.length - 1]!, anchors, at("2026-07-03"));
    expect(verdict.slots.change.referenceAsOf).toBe("2026-06-30");
  });

  it("resolves nothing before the first anchor", async () => {
    const anchors = await historyThrough("2026-07-03");
    expect(resolveNearestAnchor(anchors, "2026-06-25")).toBeUndefined();
  });
});

describe("D4's genesis case", () => {
  it("suppresses Change for want of an EARLIER ANCHOR, distinguishably", async () => {
    // LANDMINE, named in the handoff: asserting this against the real first anchor
    // (2026-06-26) passes for the wrong reason. That anchor's `summary.change` is
    // ALREADY suppressed by its own feed gap, so the test would stay green with the
    // genesis rule deleted. So genesis is exercised here on a SYNTHETIC first
    // anchor: 07-14's payload — whose glance is entirely clean — replayed as the
    // only anchor in history. Nothing else can suppress Change, so the assertion
    // below has exactly one possible cause, and `suppressedBy` names it.
    const genesis = anchorAt(await loadAnchorFixture(), "2026-07-14");
    expect(genesis.report.glance.suppressed).toEqual([]);

    const verdict = computeVerdict(genesis, [genesis], at("2026-07-14"));
    expect(verdict.slots.change.rendered).toBe(false);
    expect(verdict.slots.change.suppressedBy).toBe("no-earlier-anchor");
    expect(verdict.slots.change.referenceAsOf).toBeUndefined();
    // No special-case copy, and no comparative trigger: there is nothing to compare
    // against, so `navMove` declines rather than fires on a 1.8% move it cannot see.
    expect(verdict.fired).toEqual([]);
    // The rest of the surface is intact — absence is per-number, not whole-page.
    expect(verdict.slots.fundValue.rendered).toBe(true);
    expect(verdict.slots.reserve.rendered).toBe(true);
  });
});

describe("R5 — a missing Reserve policy", () => {
  it("suppresses the slot, declines the trigger, and never defaults to 10", async () => {
    // THE DISCRIMINATING CASE. Reserve is forced to 8% — below the 10% seed that
    // `defaultProfitPolicyEntry` carries — with NO policy on the wire. A reader that
    // quietly fell back to that seed would fire `reserveFloor` here and print a
    // floor the operator never set. It must stay silent instead.
    const source = anchorAt(await loadAnchorFixture(), "2026-07-27");
    const noPolicy = withReserve(source, 8);
    delete noPolicy.report.glance.reserveTargetPct;
    noPolicy.report.glance.suppressed = ["summary.reserve"];

    const anchors = [...(await historyThrough("2026-07-26")), noPolicy];
    const verdict = computeVerdict(noPolicy, anchors, at("2026-07-27"));

    expect(verdict.fired).toEqual([]);
    expect(verdict.needsYou).toBe(false);
    expect(verdict.slots.reserve.rendered).toBe(false);
    expect(verdict.slots.reserve.suppressedBy).toBe("no-policy");
    // R2: an absence never fails the whole surface.
    expect(verdict.slots.fundValue.rendered).toBe(true);
    expect(verdict.slots.change.rendered).toBe(true);
  });
});

describe("R3/R4 — the synthesized Reserve floor breach", () => {
  it("fires on the first day below the floor, naming no duration", async () => {
    const anchors = await historyThrough("2026-07-27");
    const breached = withReserve(anchors[anchors.length - 1]!, 8.2);
    const verdict = computeVerdict(breached, [...anchors.slice(0, -1), breached], at("2026-07-27"));

    expect(verdict.needsYou).toBe(true);
    expect(verdict.fired.map((t) => t.name)).toEqual(["reserveFloor"]);
    expect(verdict.sentence).toBe("Reserve is 8.2%, below its 10% floor");
    expect(verdict.slots.reserve.rendered).toBe(true);
  });

  it("is a STATE rule: it fires again the next day, and names the duration", async () => {
    // An edge rule goes quiet on day two while the fund is still under-reserved —
    // a `no` that isn't. R3 says it fires every day and counts.
    const anchors = await historyThrough("2026-07-27");
    const day1 = withReserve(anchorAt(anchors, "2026-07-26"), 8.2);
    const day2 = withReserve(anchorAt(anchors, "2026-07-27"), 8.4);
    const history = [...anchors.slice(0, -2), day1, day2];

    expect(computeVerdict(day1, history.slice(0, -1), at("2026-07-26")).sentence).toBe(
      "Reserve is 8.2%, below its 10% floor",
    );
    expect(computeVerdict(day2, history, at("2026-07-27")).sentence).toBe(
      "Reserve is 8.4%, below its 10% floor — 2nd day",
    );
  });

  it("declines when the Reserve number itself is suppressed", async () => {
    // Not composition rule 1 (which governs COMPARATIVE triggers only) — this is the
    // simpler rule that a trigger may not assert a breach off a number the surface
    // refuses to show.
    const anchors = await historyThrough("2026-07-27");
    const breached = withReserve(anchors[anchors.length - 1]!, 8.2);
    breached.report.glance.suppressed = [
      "summary.fundValueUsd",
      "summary.change",
      "summary.reserve",
    ];
    const verdict = computeVerdict(breached, [...anchors.slice(0, -1), breached], at("2026-07-27"));

    expect(verdict.fired.map((t) => t.name)).not.toContain("reserveFloor");
    expect(verdict.slots.reserve.rendered).toBe(false);
    expect(verdict.slots.reserve.suppressedBy).toBe("unexpected-absence");
  });
});

describe("freshness (D6) — a render-time derivation, never a pushed field", () => {
  it("stays silent while the anchor is younger than the threshold", async () => {
    const anchors = await historyThrough("2026-07-27");
    const verdict = computeVerdict(anchors[anchors.length - 1]!, anchors, at("2026-07-28"));
    expect(verdict.fired).toEqual([]);
    expect(verdict.staleDays).toBe(1);
  });

  it("REPLACES the verdict rather than sitting beside it", async () => {
    // The collision that proves the replacement: a stale anchor that is ALSO under
    // its floor. Two triggers fire; one sentence renders, and it is freshness's.
    const anchors = await historyThrough("2026-07-27");
    const breached = withReserve(anchors[anchors.length - 1]!, 8.2);
    const verdict = computeVerdict(breached, [...anchors.slice(0, -1), breached], at("2026-07-30"));

    expect(verdict.fired.map((t) => t.name)).toEqual(["freshness", "reserveFloor"]);
    expect(verdict.sentence).toBe("Data is 3 days old — last anchored Mon 27 Jul");
    expect(verdict.sentence).not.toMatch(/Reserve/);
    expect(verdict.needsYou).toBe(true);
  });
});

describe("same-day precedence — chosen, not measured", () => {
  it("ranks reserveFloor above navMove when both fire", async () => {
    const anchors = await historyThrough("2026-07-14");
    const both = withReserve(anchors[anchors.length - 1]!, 8.2);
    const verdict = computeVerdict(both, [...anchors.slice(0, -1), both], at("2026-07-14"));

    expect(verdict.fired.map((t) => t.name)).toEqual(["reserveFloor", "navMove"]);
    expect(verdict.sentence).toBe("Reserve is 8.2%, below its 10% floor");
    // Everything that fired is still carried, for /big-picture to list.
    expect(verdict.fired[1]?.sentence).toBe("Fund moved more than 1.5% since Mon 13 Jul");
  });
});
