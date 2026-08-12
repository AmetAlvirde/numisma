/**
 * THE FIXTURE SURFACE'S OWN PROMISE (spec #302 slice B, issue #304).
 *
 * `started-ladder.fixtures.ts` exists so a human can LOOK at a ladder that has started —
 * every branch of it — on a surface that reaches no real data. The fixtures are data, so
 * the thing that can rot is not their arithmetic but their CLAIM: a fixture named
 * `overfilled` that quietly stops overfilling still renders, still looks fine, and stops
 * being the thing slice C reviews against.
 *
 * SO EACH TEST BELOW ASSERTS ONE FIXTURE STILL EXERCISES THE BRANCH IT IS NAMED FOR,
 * through the real `composeFillPathPage` the route uses. Nothing here asserts what a
 * component RENDERS from it — that is out of this slice's scope by #304, and the repo has
 * no RTL toolchain (docs/coverage-rationale.md §6). The render itself is judged by opening
 * the page, which is what the fixture surface is for.
 *
 * ── MUTATION CHECK (repo discipline; performed 2026-08-12) ───────────────────────────
 * Each guard was broken once against the finished fixtures, confirmed red for the right
 * reason, and restored:
 *
 *  - dropped `deployedUsd` to `4_000` on `overfilled` (inside the declared total) → "an
 *    overfilled ladder deploys MORE than the axis can hold" red. Right reason: the one
 *    fact slice C reviews against is the figure leaving the domain, not the fixture's
 *    existence.
 *  - moved `partly-walked`'s spot BELOW the partly-filled rung (39,000 → 33,000) → "the
 *    rung price will reach next is in a non-default state" red (re-confirmed 2026-08-12
 *    against #306's predicate: `expected true to be false`, the next rung being one the
 *    venue is merely resting on). Right reason: `RowState`'s substatus arm is `isNext &&
 *    !venueResting`, so it lands only while the partly-filled rung is the next one, and
 *    only a fixture-declared spot can put it there. (Moving spot ABOVE the whole ladder
 *    does NOT kill it — the first WAITING rung is still the partly-filled one. Recorded
 *    because it was the first mutant tried and it survived: the claim is about which rung
 *    is next, not about where spot is.)
 *  - re-sorted `out-of-order`'s fills into a prefix → "a filled rung sits BELOW an
 *    unfilled one" red. Right reason: the solid segment runs to the LAST filled rung, and
 *    a prefix of fills cannot show that.
 *  - static-imported the fixtures into the route → "the fixture surface cannot reach
 *    production" red. Right reason: a static import survives dead-code elimination and
 *    ships the whole fixture set in the production bundle.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { composeFillPathPage, type FillPathView } from "./fill-path-view.ts";
import { cumulate, splitAt, withRadius } from "./price-drop-path.ts";
import {
  LADDER_FIXTURE_NAMES,
  STARTED_LADDER_FIXTURES,
  ladderFixture,
  type LadderFixture,
} from "./started-ladder.fixtures.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Composes a fixture exactly the way `routes/ladder-fixture.$state.tsx` does. */
function render(name: string): FillPathView {
  const fixture = ladderFixture(name);
  expect(fixture, `no fixture named ${name}`).toBeDefined();
  const page = composeFillPathPage(
    fixture!.anchor,
    fixture!.planId,
    fixture!.spot,
  );
  expect(page.status, `${name} does not compose to a renderable ladder`).toBe(
    "ok",
  );
  return (page as { status: "ok"; view: FillPathView }).view;
}

/** The x axis the `Deployed` rule is drawn against: the whole declared ladder. */
function declaredTotalUsd(view: FillPathView): number {
  return view.rungs.reduce((total, rung) => total + (rung.sizeUsd ?? 0), 0);
}

describe("the started-ladder fixture surface", () => {
  it("names one fixture per URL segment, each reachable by that name", () => {
    expect(STARTED_LADDER_FIXTURES.length).toBeGreaterThanOrEqual(4);
    expect(new Set(LADDER_FIXTURE_NAMES).size).toBe(
      STARTED_LADDER_FIXTURES.length,
    );
    for (const fixture of STARTED_LADDER_FIXTURES) {
      expect(ladderFixture(fixture.name)).toBe(fixture);
      // The name is typed into a URL by hand — keep it typeable.
      expect(fixture.name).toMatch(/^[a-z][a-z-]*[a-z]$/);
      expect(fixture.renders.length).toBeGreaterThan(0);
    }
    expect(ladderFixture("no-such-fixture")).toBeUndefined();
  });

  it("renders every fixture as a PLOTTABLE ladder, chart and caption included", () => {
    // A fixture that composes to `no-price-axis`, or to a ladder the plottability gate
    // refuses, is a fixture nobody can look at — which is the whole deliverable.
    for (const fixture of STARTED_LADDER_FIXTURES) {
      const view = render(fixture.name);
      expect(view.chart, `${fixture.name} plots nothing`).toBeDefined();
      expect(view.caption, `${fixture.name} has no caption`).toBeDefined();
      expect(view.rungs.length).toBeGreaterThanOrEqual(2);
      expect(new Set(view.rungs.map((rung) => rung.priceUsd)).size).toBe(
        view.rungs.length,
      );
      for (const rung of view.rungs) {
        expect(rung.sizeUsd, `${fixture.name} ships a sizeless rung`).toBeDefined();
      }
      expect(view.reconciled, `${fixture.name} never reconciled`).toBe(true);
    }
  });

  it("day zero: nothing filled, and the ladder's own projection stands in", () => {
    const view = render("day-zero");
    expect(view.rungs.some((rung) => rung.filled)).toBe(false);
    expect(view.notStarted).toBe(true);
    expect(view.expected).toBeDefined();
    expect(view.deployed.known).toBe(false);
    expect(view.figures?.split).toBe("all-resting");
  });

  it("partly walked: filled rungs, ONE partly filled, and the rest waiting", () => {
    const view = render("partly-walked");
    expect(view.rungs.filter((rung) => rung.filled).length).toBeGreaterThan(0);
    expect(
      view.rungs.filter((rung) => rung.filledPercent !== undefined),
    ).toHaveLength(1);
    expect(view.rungs.some((rung) => rung.resting && !rung.filled)).toBe(true);
    expect(view.rungs.some((rung) => rung.notPlaced)).toBe(true);
    // The three measured tiles and the chart's `Deployed` rule both need this.
    expect(view.deployed.known).toBe(true);
    expect(view.notStarted).toBe(false);
    expect(view.expected).toBeUndefined();
    // The split that makes hidden encumbrance visible.
    expect(view.figures?.split).toBe("partly-unplaced");
  });

  it("partly walked: the rung price will reach next is in a non-default state", () => {
    // `RowState`'s SUBSTATUS arm is `isNext && !venueResting` — unreachable from live
    // data, and unreachable without a fixture-declared spot. Asserted on the FACT the
    // component branches on (#306), not on the words it happens to print.
    const next = render("partly-walked").rungs.find((rung) => rung.isNext);
    expect(next).toBeDefined();
    expect(next!.venueResting).toBe(false);
    // The same rung is the one the cards open on, which is what puts `Pills`'
    // partly-filled arm on screen.
    expect(next!.filledPercent).toBeDefined();
  });

  it("out of order: a filled rung sits BELOW an unfilled one", () => {
    const view = render("out-of-order");
    const points = withRadius(
      cumulate(
        view.rungs.map((rung) => ({
          key: rung.key,
          priceUsd: rung.priceUsd,
          sizeUsd: rung.sizeUsd!,
          filled: rung.filled,
        })),
      ),
    );
    const handoff = splitAt(points);
    expect(handoff).toBeGreaterThan(0);
    // The whole point: the solid segment runs PAST rungs that never filled.
    expect(
      points.slice(0, handoff).some((point) => !point.filled),
      "every rung above the handoff filled — this is a prefix, not an out-of-order fill",
    ).toBe(true);
    // Price has fallen through resting orders the venue has not answered for.
    expect(view.warnings.pricePassedNoFill).toBeGreaterThan(0);
  });

  it("overfilled: an overfilled ladder deploys MORE than the axis can hold", () => {
    // THE BLOCKER FOR SLICE C (#305). The `Deployed` rule is plotted on a domain whose
    // end is the max cumulative DECLARED total; this fixture is the only way to look at
    // a measured figure sitting outside it.
    const view = render("overfilled");
    expect(view.deployed.known).toBe(true);
    expect((view.deployed as { value: number }).value).toBeGreaterThan(
      declaredTotalUsd(view),
    );
    expect(view.rungs.every((rung) => rung.filled)).toBe(true);
    expect(view.progress?.percent).toBe(100);
    expect(view.figures?.split).toBe("nothing-waiting");
  });

  it("the fixture surface cannot reach production", () => {
    // The mechanism, asserted rather than described: the dev route reads the fixtures
    // ONLY inside an `import.meta.env.DEV` branch, and reaches them by DYNAMIC import so
    // the production build's dead-code elimination takes the module — and every value in
    // it — out of the bundle entirely.
    const route = readFileSync(
      join(HERE, "..", "routes", "ladder-fixture.$state.tsx"),
      "utf-8",
    );
    expect(route).toMatch(/import\.meta\.env\.DEV/);
    expect(route).toMatch(
      /import\(\s*["'][^"']*started-ladder\.fixtures\.ts["']\s*\)/,
    );
    expect(
      route,
      "a STATIC import of the fixtures ships them in the production bundle",
    ).not.toMatch(/from\s*["'][^"']*started-ladder\.fixtures\.ts["']/);
    // And the live surface is untouched: the fixtures reach no session-gated path.
    const live = readFileSync(
      join(HERE, "..", "routes", "ladder.$planId.tsx"),
      "utf-8",
    );
    expect(live).not.toMatch(/fixture/i);
  });

  it("is authored here, and never seeded from real trade output", () => {
    // The repo's private-data line is AUTHORSHIP, not shape (docs/local-data.md). What
    // that means mechanically for a fixture nobody can diff against reality: the ids are
    // this file's own inventions, and the module says so.
    const source = readFileSync(
      join(HERE, "started-ladder.fixtures.ts"),
      "utf-8",
    );
    expect(source).toMatch(/AUTHORED/);
    const positionIds = STARTED_LADDER_FIXTURES.map(
      (fixture: LadderFixture) => render(fixture.name).positionId,
    );
    for (const positionId of positionIds) {
      expect(positionId).toMatch(/^fixture:/);
    }
  });
});
