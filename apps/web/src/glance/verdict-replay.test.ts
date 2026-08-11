/**
 * THE LOAD-BEARING TEST (PRD #146 slice #150): every anchor the fund has ever had,
 * replayed through `verdict.ts`, against the measured history.
 *
 * IT RUNS UNCONDITIONALLY. No Postgres gate, no substrate detection, no self-skip —
 * it reads the COMMITTED fixture (slice #149), so it runs on every machine and in
 * CI. That is the whole reason the fixture exists: a replay that skips where there
 * is no database passes by not running, on exactly the machines where the claim
 * would otherwise be unproven. If the fixture is missing or stale this test goes
 * RED, which is the correct outcome.
 *
 * WHAT "REPLAY" MEANS HERE. For each anchor the verdict is computed from the
 * history the surface COULD have known that day — anchors up to and including it —
 * with the wall clock set to that same day, so `freshness` is silent by
 * construction. Freshness is a render-time derivation against the clock (D6); it is
 * not a property of an anchor and cannot be replayed from one.
 *
 * NOTHING BELOW KEYS ON THE FIXTURE'S COUNT, and that is a hard rule, not a
 * preference. The prototype measured genesis 06-23 + 06-26…07-26; the fixture at the
 * time held 06-26…07-27 — two different sets that happened to be the same size, which
 * is exactly the coincidence a hard-coded count invites you to fuse. (It has since
 * grown to 06-26…08-10, as the paragraph below said it would — which is why this file
 * still names no total.) The count also GROWS BY ONE
 * on every push (`pnpm backfill -- --fixture-only` is the supported regeneration
 * path), so a pinned total goes red on a day the fund had a perfectly normal one —
 * and a red test that means "another normal day" teaches regenerate-and-edit-the-
 * number, which is how the *yes*-day assertion below eventually gets edited too.
 *
 * So the expectations here are DERIVED FROM THE FIXTURE: the *yes* days are named by
 * date, and the *no* days are whatever is left. Adding an anchor changes no literal
 * in this file unless it changes a VERDICT — which is the only thing worth a red.
 */
import { describe, expect, it } from "vitest";
import { loadAnchorFixture } from "../push/anchor-fixture.ts";
import { computeVerdict, type Verdict } from "./verdict.ts";

/**
 * The measured *yes* days, by date and by the trigger that took them. Five to
 * `feedGap` — "the feed didn't run" is the most actionable thing that happened all
 * month — and one to `navMove`. No day is taken by two triggers: the same-day
 * collision the precedence order exists for has never been observed.
 */
const MEASURED_YES: Record<string, string> = {
  "2026-06-26": "feedGap",
  "2026-06-30": "feedGap",
  "2026-07-03": "feedGap",
  "2026-07-04": "feedGap",
  "2026-07-05": "feedGap",
  "2026-07-14": "navMove",
};

async function replay(): Promise<{ asOf: string; verdict: Verdict }[]> {
  const anchors = await loadAnchorFixture();
  return anchors.map((anchor, index) => ({
    asOf: anchor.asOf,
    verdict: computeVerdict(
      anchor,
      anchors.slice(0, index + 1),
      new Date(`${anchor.asOf}T12:00:00Z`),
    ),
  }));
}

describe("the anchor replay", () => {
  it("reproduces the measured history — the named yes days, every other anchor no", async () => {
    const replayed = await replay();
    const yes = replayed.filter((r) => r.verdict.needsYou).map((r) => r.asOf);
    const no = replayed.filter((r) => !r.verdict.needsYou).map((r) => r.asOf);

    expect(yes).toEqual(Object.keys(MEASURED_YES));
    // The *no* days named rather than counted. `toEqual` against the fixture's own
    // remainder is strictly stronger than a total ever was — it catches a day that
    // flipped, which a count cannot when two flip in opposite directions — and it
    // survives the next push, which a count cannot at all.
    expect(no).toEqual(
      replayed.map((r) => r.asOf).filter((asOf) => !Object.hasOwn(MEASURED_YES, asOf)),
    );
    expect(yes.length + no.length).toBe(replayed.length);
    // Every named *yes* day is actually in the fixture: `toEqual` above would also
    // pass if the fixture had silently narrowed to nothing but yes days.
    expect(replayed.length).toBeGreaterThan(yes.length);
  });

  it("attributes each yes to the trigger that took it — 5 feedGap, 1 navMove", async () => {
    const replayed = await replay();
    const attributed = Object.fromEntries(
      replayed
        .filter((r) => r.verdict.needsYou)
        .map((r) => [r.asOf, r.verdict.fired[0]?.name]),
    );
    expect(attributed).toEqual(MEASURED_YES);

    // And no *yes* day fired two triggers: the precedence order is exercised by the
    // synthetic collisions in `verdict.test.ts`, never by real history.
    for (const { asOf, verdict } of replayed) {
      expect(verdict.fired.length, asOf).toBeLessThanOrEqual(1);
    }
  });

  it("declines navMove on 2026-06-28 — composition rule 1, not the threshold", async () => {
    const replayed = await replay();
    const day = replayed.find((r) => r.asOf === "2026-06-28")!;
    expect(day.verdict.needsYou).toBe(false);
    expect(day.verdict.fired).toEqual([]);
    expect(day.verdict.slots.change.suppressedBy).toBe("reference-withheld");
  });

  it("renders 2026-07-26 in full — V1's Sunday case", async () => {
    // Nine of thirteen instruments last marked on Friday, and that is EXPECTED of a
    // weekday venue on a Sunday. Zero unexpected absences, nothing suppressed, all
    // three slots standing, verdict *no*.
    const replayed = await replay();
    const day = replayed.find((r) => r.asOf === "2026-07-26")!;
    expect(day.verdict.needsYou).toBe(false);
    expect(day.verdict.slots.fundValue.rendered).toBe(true);
    expect(day.verdict.slots.change.rendered).toBe(true);
    expect(day.verdict.slots.reserve.rendered).toBe(true);
  });

  it("suppresses Change on the first anchor, which has no earlier anchor", async () => {
    // NOTE THE WEAKNESS OF THIS ASSERTION, deliberately recorded rather than
    // asserted around: on 2026-06-26 `summary.change` is ALSO suppressed by the
    // day's feed gap, so this cannot tell genesis from mark absence — it would keep
    // passing with the genesis rule deleted. The distinguishing case is the
    // synthetic clean-glance genesis in `verdict.test.ts`; this one only records
    // that the real first anchor does not render a change against nothing.
    const replayed = await replay();
    expect(replayed[0]!.verdict.slots.change.rendered).toBe(false);
  });

  it("never renders a change without naming the anchor it landed on (D4/V3)", async () => {
    for (const { asOf, verdict } of await replay()) {
      const change = verdict.slots.change;
      if (change.rendered) {
        expect(change.referenceAsOf, asOf).toBeDefined();
        expect(change.referenceLabel, asOf).toMatch(/^\w{3} \d{1,2} \w{3}$/);
      }
    }
  });

  it("never fires reserveFloor: Reserve has never breached (R4, still UNTESTED)", async () => {
    // 19.5–20.7% against a 10% floor on every anchor. This asserts the silence, and
    // is exactly why the breach behavior is exercised on synthesized anchors — this
    // module ships with its `reserveFloor` path unproven against real data.
    for (const { asOf, verdict } of await replay()) {
      expect(verdict.fired.map((t) => t.name), asOf).not.toContain("reserveFloor");
    }
  });
});
