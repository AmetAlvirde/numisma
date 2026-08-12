/**
 * STARTED-LADDER FIXTURES — the four ladders nobody had ever seen (spec #302 slice B,
 * issue #304), rendered by `routes/ladder-fixture.$state.tsx`.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────────────
 * Every branch of "a ladder that has started" was unexecuted, by anyone: the solid
 * segment, the filled dot, the `Filled` legend entry, the `is-filled` row tint, the whole
 * `Deployed` rule, `RowState`'s substatus line and `Pills`' partly-filled arm. Not because
 * they are hard to reach, but because there was no way to LOOK at them — the dev surface
 * reads the real projection through the session gate, and the real fund's ladder has zero
 * filled rungs. So the states shipped unseen, and one of them (a `deployed` total larger
 * than the axis it is plotted on) draws outside the plot.
 *
 * ── EVERY VALUE HERE IS AUTHORED, AND THAT IS THE LOAD-BEARING SENTENCE ─────────────
 * The repo's private-data line is AUTHORSHIP, NOT SHAPE (`docs/local-data.md`, and
 * `push/fixture-synthesis.ts`'s header states it flatly). Nothing below is a real trade,
 * a real level, a real size or a real quantity — not scaled, not perturbed, not reshaped
 * from any of them. The prices are round numbers on a 4,000-wide grid, the sizes are a
 * hand-drawn convex ramp, and every id is invented here and prefixed `fixture:` /
 * `fixture-` so that a screenshot of this surface can never be mistaken for the fund. The
 * fills are placed WHERE THE RENDER BRANCHES ARE, which is the opposite of what a copy of
 * reality would look like.
 *
 * What IS borrowed from reality is cardinality — eight rungs — and that is a count.
 *
 * ── HOW A FIXTURE EARNS ITS PLACE ───────────────────────────────────────────────────
 * One fixture per state branch, named for the branch, and each one is asserted to still
 * exercise that branch by `started-ladder.fixtures.test.ts`. A fixture that renders
 * something already reachable from live data would be a fifth thing to maintain and a
 * fifth thing to mistake for the real fund; a fixture whose claim quietly stops holding is
 * worse than none, because the reviewer trusts the name.
 *
 * ── SPOT IS DECLARED, NOT FETCHED ───────────────────────────────────────────────────
 * Each fixture carries its own {@link SpotReading}. Two of the states here are
 * SPOT-DEPENDENT — `isNext` and `waiting · price passed, unconfirmed` — and `RowState`'s
 * substatus arm needs a specific one of them (`isNext` on a rung the venue is not merely
 * resting on — `venueResting` false, #306). A live Binance reading against invented rung prices would land those
 * decorations wherever the market happened to be that afternoon, which is not a fixture.
 * It also means this surface performs NO network read at all.
 */
import type {
  DcaBlock,
  DcaPositionRow,
  DcaWireRung,
  SnapshotAnchor,
} from "../projection/contract.ts";
import { venueFilled, type SpotReading } from "./fill-path-view.ts";

/** One ladder to look at, and the name it answers to in the URL. */
export interface LadderFixture {
  /** The URL segment: `/ladder-fixture/<name>`. Typed by hand, so kebab and short. */
  name: string;
  /** The state branch this fixture exists to put on screen. Shown on the surface. */
  renders: string;
  /** Which plan id the composed page resolves — the row's own, invented below. */
  planId: string;
  /** See the header: declared, never fetched, because two decorations move with it. */
  spot: SpotReading;
  anchor: SnapshotAnchor;
}

/**
 * THE ONE DECLARED LADDER ALL FOUR FIXTURES WALK, so the four pictures are comparable:
 * change only what has FILLED and the eye reads the difference as progress rather than as
 * a different ladder. Eight rungs, 4,000 apart, on a hand-drawn convex ramp — the deepest
 * rung commits 5.5× the shallowest, which is what makes the price drop path curve.
 */
const LADDER: readonly { priceUsd: number; sizeUsd: number }[] = [
  { priceUsd: 50_000, sizeUsd: 200 },
  { priceUsd: 46_000, sizeUsd: 250 },
  { priceUsd: 42_000, sizeUsd: 300 },
  { priceUsd: 38_000, sizeUsd: 400 },
  { priceUsd: 34_000, sizeUsd: 500 },
  { priceUsd: 30_000, sizeUsd: 650 },
  { priceUsd: 26_000, sizeUsd: 850 },
  { priceUsd: 22_000, sizeUsd: 1_100 },
];

/** Σ of the declared sizes: 4,250. The x axis the `Deployed` rule is drawn against. */
const DECLARED_TOTAL_USD = LADDER.reduce((sum, rung) => sum + rung.sizeUsd, 0);

/** Arithmetic over the authored numbers above — a size at a price, in units. */
function qty(sizeUsd: number, priceUsd: number): number {
  return Math.round((sizeUsd / priceUsd) * 1e6) / 1e6;
}

const at = (index: number) => LADDER[index]!;
const rungId = (index: number) => `fixture-rung-${index + 1}`;

/**
 * A rung with an order the venue has not filled. The book has nothing to record, which is
 * why `bookAxis` is `not-recorded` and no warning follows from it (`needsRecording`'s
 * `consumed > 0` conjunct is what keeps day zero quiet).
 */
function resting(index: number): DcaWireRung {
  const { priceUsd, sizeUsd } = at(index);
  return {
    id: rungId(index),
    priceUsd,
    sizeUsd,
    venueAxis: "resting",
    bookAxis: "not-recorded",
    label: "waiting",
    joinProvenance: "declared",
    placedQuantity: qty(sizeUsd, priceUsd),
    venueConsumedQuantity: 0,
    bookedQuantity: 0,
    resting: true,
  };
}

/**
 * A rung the venue filled in full. `booked` false is the `filled at venue — not recorded`
 * variant — the call to action `UnrecordedWarnings` counts — and it is a DIFFERENT state
 * from an unfilled rung, which is the distinction the fixtures have to be able to show.
 */
function filled(index: number, booked = true): DcaWireRung {
  const { priceUsd, sizeUsd } = at(index);
  const units = qty(sizeUsd, priceUsd);
  return {
    id: rungId(index),
    priceUsd,
    sizeUsd,
    venueAxis: "filled",
    bookAxis: booked ? "recorded" : "not-recorded",
    label: booked ? "filled" : "filled at venue — not recorded",
    joinProvenance: "declared",
    placedQuantity: units,
    venueConsumedQuantity: units,
    bookedQuantity: booked ? units : 0,
    venueFilledFraction: 1,
    resting: false,
  };
}

/**
 * A rung the venue filled PART of, its remainder still resting. `venueFilledFraction` is
 * what becomes `filledPercent` on the view, and the engine's own label spells the same
 * percentage — both are authored here to agree, exactly as a real payload's would.
 */
function partlyFilled(index: number, fraction: number): DcaWireRung {
  const { priceUsd, sizeUsd } = at(index);
  const units = qty(sizeUsd, priceUsd);
  const consumed = qty(sizeUsd * fraction, priceUsd);
  return {
    id: rungId(index),
    priceUsd,
    sizeUsd,
    venueAxis: "partly-filled",
    bookAxis: "recorded",
    label: `partly filled · ${Math.round(fraction * 100)}%`,
    joinProvenance: "declared",
    placedQuantity: units,
    venueConsumedQuantity: consumed,
    bookedQuantity: consumed,
    venueFilledFraction: fraction,
    resting: true,
  };
}

/**
 * A rung NO ORDER EVER JOINED — absence rule 1, which is carried by carrying nothing:
 * `{id, priceUsd, sizeUsd}` and not one zeroed quantity, because a missing
 * `venueConsumedQuantity` is not a 0% fill. `toWireRung` builds exactly this.
 */
function declaredOnly(index: number): DcaWireRung {
  const { priceUsd, sizeUsd } = at(index);
  return { id: rungId(index), priceUsd, sizeUsd };
}

/**
 * Σ of the declared sizes of every rung the venue has NOT filled.
 *
 * THE PREDICATE IS BORROWED, NOT RE-SPELLED. `venueFilled` is the one site that reads the
 * `"filled"` literal, so these fixtures cannot come to disagree with the page they are
 * fixtures FOR about which rung filled — the drift a fifth `venueAxis` arm would otherwise
 * need three separate edits to avoid.
 */
function waitingDeclaredUsd(rungs: readonly DcaWireRung[]): number {
  return rungs
    .filter((rung) => !venueFilled(rung))
    .reduce((sum, rung) => sum + (rung.sizeUsd ?? 0), 0);
}

/** …and the half of that which is actually encumbered at the venue. */
function waitingRestingUsd(rungs: readonly DcaWireRung[]): number {
  return rungs
    .filter((rung) => rung.resting === true)
    .reduce((sum, rung) => sum + (rung.sizeUsd ?? 0), 0);
}

/**
 * Assembles one fixture. `deployedUsd`/`unitsAcquired` absent together is DAY ZERO
 * (absence rule 4 — the measured figures move as a set), and the `avgEntryUsd` beside
 * them is the two totals divided, never an average of prices.
 */
function fixtureOf(spec: {
  name: string;
  renders: string;
  spot: SpotReading;
  state: DcaPositionRow["state"];
  rungs: readonly DcaWireRung[];
  /** MEASURED. Omit for a ladder that has not started. */
  measured?: { deployedUsd: number; unitsAcquired: number };
  /** Recorded lots no declared rung explains. Absent-at-zero is not this file's call. */
  orphanLots: number;
}): LadderFixture {
  const rungs = [...spec.rungs];
  const measured =
    spec.measured === undefined
      ? {}
      : {
          deployedUsd: spec.measured.deployedUsd,
          unitsAcquired: spec.measured.unitsAcquired,
          avgEntryUsd:
            Math.round(
              (spec.measured.deployedUsd / spec.measured.unitsAcquired) * 100,
            ) / 100,
        };
  const row: DcaPositionRow = {
    positionId: `fixture:${spec.name}`,
    state: spec.state,
    kind: "dcaLadder",
    planId: planIdFor(spec.name),
    rungs,
    figures: {
      ...measured,
      waitingDeclaredUsd: waitingDeclaredUsd(rungs),
      waitingRestingUsd: waitingRestingUsd(rungs),
    },
    orphanLots: spec.orphanLots,
  };
  const dca: DcaBlock = {
    source: "loaded",
    positions: [row],
    unattributable: 0,
    // PRESENT AT ZERO on purpose (absence rule 3): these ladders were checked. An absent
    // count would make every fixture render "could not check", which is its own state and
    // not one of the four this file is for.
    tornActs: 0,
  };
  return {
    name: spec.name,
    renders: spec.renders,
    planId: row.planId!,
    spot: spec.spot,
    // NARROWED DELIBERATELY. `/ladder/$planId` reads exactly `asOf` and `report.dca`; the
    // rest of a `ProjectionReport` is the glance and the composition surfaces' business,
    // and inventing four more branches of it would be four more things to keep true. The
    // cast is the same one `fill-path-view.test.ts` makes, for the same reason.
    anchor: {
      fundId: "fixture-fund",
      asOf: "2026-08-12",
      report: { dca },
    } as SnapshotAnchor,
  };
}

/**
 * A stable, obviously-fictional plan id per fixture. UUID-SHAPED BECAUSE THE ROUTE'S
 * RESOLVER REQUIRES IT (`composeFillPathPage` refuses a non-UUID plan id, deliberately:
 * a real plan id is a UUID minted in the operator's sidecar and reached by tapping the
 * card). `facade` is hex AND a word, and the last group is a counter, so no minted id
 * could collide with one of these and no reader could mistake one for real.
 */
function planIdFor(name: string): string {
  const index = FIXTURE_ORDER.indexOf(name as FixtureName) + 1;
  return `facade00-0000-4000-8000-00000000000${index}`;
}

/** Fixture order, declared before the fixtures so `planIdFor` can count them. */
const FIXTURE_ORDER = [
  "day-zero",
  "partly-walked",
  "out-of-order",
  "overfilled",
] as const;

type FixtureName = (typeof FIXTURE_ORDER)[number];

/**
 * DAY ZERO — a reconciliation ran and found nothing filled. The one state live data does
 * reach, kept here as the baseline the other three are read against: the whole path
 * dashed, no `Filled` swatch in the legend, no `Deployed` rule, and the three measured
 * tiles replaced by the declared ladder's own projection.
 *
 * Spot sits ABOVE the whole ladder, which is where the fund usually is: the first rung is
 * `next` and nothing has been passed unconfirmed.
 */
const DAY_ZERO = fixtureOf({
  name: "day-zero",
  renders:
    "nothing filled — the day-zero projection, a fully dashed path, no Deployed rule",
  spot: { status: "live", priceUsd: 52_400 },
  state: "pending",
  rungs: LADDER.map((_, index) => resting(index)),
  orphanLots: 0,
});

/**
 * PARTLY WALKED — the state the whole slice is named for. Three rungs filled, the fourth
 * partly filled, two still resting and the deepest two never placed at all.
 *
 * SPOT IS PLACED AT 39,000 ON PURPOSE — just above the partly-filled rung. That makes the
 * partly-filled rung the one a falling price reaches NEXT, which is the only way to reach
 * `RowState`'s substatus line (`isNext` AND `venueResting` false) and, because
 * the cards open on the next rung, the only way `Pills`' partly-filled arm appears without
 * the reader dragging the slider.
 */
const PARTLY_WALKED = fixtureOf({
  name: "partly-walked",
  renders:
    "three rungs filled, one partly filled and next, two resting, two never placed",
  spot: { status: "live", priceUsd: 39_000 },
  state: "active",
  rungs: [
    filled(0),
    filled(1),
    filled(2),
    partlyFilled(3, 0.4),
    resting(4),
    resting(5),
    declaredOnly(6),
    declaredOnly(7),
  ],
  // 200 + 250 + 300 filled in full, plus 40% of 400. Units at each rung's own price.
  measured: {
    deployedUsd: 910,
    unitsAcquired:
      qty(200, 50_000) + qty(250, 46_000) + qty(300, 42_000) + qty(160, 38_000),
  },
  orphanLots: 0,
});

/**
 * OUT OF ORDER — the venue filled rungs 2, 4 and 5 while 1 and 3 sit resting, unanswered.
 *
 * THIS IS THE FIXTURE THE SOLID SEGMENT NEEDS. The path's handoff is the LAST filled rung,
 * not a per-rung classification, so the solid line runs down PAST two rungs that never
 * filled — the one picture that shows what `splitAt` actually claims ("everything up to
 * here has been walked"), and the one a per-segment drawing would shatter.
 *
 * It also carries the two warnings apart: rung 4 filled at the venue and was never
 * recorded, and spot at 31,000 has fallen through two resting orders the venue is silent
 * about. Those are different certainties, and this is where they render together.
 */
const OUT_OF_ORDER = fixtureOf({
  name: "out-of-order",
  renders:
    "rungs 2, 4 and 5 filled past two unanswered resting orders — the solid segment's handoff",
  spot: { status: "live", priceUsd: 31_000 },
  state: "active",
  rungs: [
    resting(0),
    filled(1),
    resting(2),
    filled(3, false),
    filled(4),
    resting(5),
    resting(6),
    declaredOnly(7),
  ],
  // 250 + 400 + 500, each at its own rung's price.
  measured: {
    deployedUsd: 1_150,
    unitsAcquired: qty(250, 46_000) + qty(400, 38_000) + qty(500, 34_000),
  },
  // A recorded lot no declared rung explains — beside a present `figures`, so `1` is a
  // real answer rather than an absence being read as one.
  orphanLots: 1,
});

/**
 * OVERFILLED — every rung filled, and `deployed` LARGER THAN THE WHOLE DECLARED LADDER.
 *
 * THE BLOCKER SLICE C (#305) REVIEWS AGAINST, and it exists because the `Deployed` rule is
 * plotted on a domain whose end is the max cumulative DECLARED total while `deployed` is
 * MEASURED — a quantity with no reason to respect that end. 1.3× the declared total is not
 * an exotic reading: fills at market above a declared level, or lots recorded against a
 * ladder from outside it, both produce one, and the two orphan lots below are how this
 * ladder got there.
 *
 * Nothing about the treatment is decided here. The fixture's whole job is to make the
 * out-of-domain arm VISIBLE so a human can judge what should happen to it.
 */
const OVERFILLED = fixtureOf({
  name: "overfilled",
  renders:
    "every rung filled and deployed 1.3× the declared total — the out-of-domain Deployed rule",
  // Price has fallen past the whole ladder: no rung is `next`, which is itself a branch.
  spot: { status: "live", priceUsd: 20_800 },
  state: "active",
  rungs: LADDER.map((_, index) => filled(index)),
  measured: {
    deployedUsd: Math.round(DECLARED_TOTAL_USD * 1.3),
    unitsAcquired: LADDER.reduce(
      (units, rung) => units + qty(rung.sizeUsd, rung.priceUsd),
      0,
    ),
  },
  orphanLots: 2,
});

/** Every fixture, in the order the surface lists them: a ladder's own progression. */
export const STARTED_LADDER_FIXTURES: readonly LadderFixture[] = [
  DAY_ZERO,
  PARTLY_WALKED,
  OUT_OF_ORDER,
  OVERFILLED,
];

export const LADDER_FIXTURE_NAMES: readonly string[] =
  STARTED_LADDER_FIXTURES.map((fixture) => fixture.name);

/** The one lookup the dev route makes. `undefined` for a name nobody authored. */
export function ladderFixture(name: string): LadderFixture | undefined {
  return STARTED_LADDER_FIXTURES.find((fixture) => fixture.name === name);
}
