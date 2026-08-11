/**
 * FIXTURE SYNTHESIS — the step that stands between the real fund's folded anchors
 * and the file this PUBLIC repository checks in (PRD #146, slice #149).
 *
 * WHY IT EXISTS. `writeAnchorFixture` writes a COMMITTED file so slice 4's replay
 * runs with no Postgres and no private log. The payload it starts from is exactly
 * `toProjectionReport`'s output — publishable under D8/ADR-007 — but D8 governs what
 * may leave the machine for the AUTH-GATED projection DB, and THIS REPOSITORY IS
 * PUBLIC. Those are different bars. The sibling `composition-report.fixture.json`
 * has always held the public-bar answer: a "Sanitized Exploratory Fund" with invented
 * round-number positions. This module makes the anchor fixture obey the same rule, by
 * construction rather than by remembering to.
 *
 * ── WHAT IS PRESERVED, AND WHY EACH ONE ─────────────────────────────────────────
 * Everything the anchor replay reads. These are COUNTS, RATIOS and SHAPES,
 * none of which discloses a magnitude:
 *
 *  - every anchor DATE, in order, and the anchor count;
 *  - the `glance` block VERBATIM — `feedGap.expected` / `arrived` / `missing[]`
 *    (rowId + label), `suppressed[]`, and `reserveTargetPct`'s presence and value.
 *    `feedGap` is what the outage triggers count; it is copied, never recomputed;
 *  - the RESERVE ROW'S `percentOfFund` on every anchor (`summary.reserve` and the
 *    section row it names). `reserveFloor` is a LEVEL TEST against it, so a
 *    perturbed value would change the verdict history;
 *  - the DAY-OVER-DAY PERCENTAGE CHANGE of NAV between consecutive anchors.
 *    `navMove` is a percent test against a named reference, and the measured history
 *    (what fires on 06-28, and on 07-14) has to reproduce;
 *  - the full STRUCTURAL shape: section ids/titles/order, row ids/kinds/labels/order,
 *    row counts, which rows carry `costBasisUsd`/`unrealizedPnlUsd` and which
 *    genuinely lack them (spec open question 3 — slice 5's per-row cost-basis
 *    rendering depends on the absences being real), `dataSafety`, schema version;
 *  - the `dca` branch's SHAPE: `source`, every `state` and `kind`, the position COUNT,
 *    the rung COUNT per position, and the `unattributable` count. Those are states and
 *    counts, the same class as `feedGap`, and the card renders them. The `positionId`
 *    itself is NOT among them — see below;
 *  - the v5 FILL STATE's conclusions: every `venueAxis`, `bookAxis`, `label`,
 *    `joinProvenance`, `declaredPriceMismatch` and `resting`, the `orphanLots` count,
 *    the PRESENCE of each measured figure, and `venueFilledFraction` — a ratio, which
 *    discloses no size and which the preserved `label` already renders as a percentage.
 *    ABSENCE IS PRESERVED TOO, and it is the load-bearing half: a rung with no fill key
 *    comes back with none, because that absence is the day-zero state the surface
 *    renders and the state the live fund is actually in.
 *
 * ── WHAT IS INVENTED, AND WHY IT MUST BE ────────────────────────────────────────
 * Everything no trigger reads. Preserving these would leak the fund's composition
 * for no test-side gain:
 *
 *  - the NAV MAGNITUDE. The series is re-anchored at a round, obviously fictional
 *    {@link SYNTHETIC_START_NAV} and carried forward by the real day-over-day ratios;
 *  - every row's `usdValue`, `costBasisUsd` and `unrealizedPnlUsd`;
 *  - every row's `percentOfFund` EXCEPT the Reserve row's;
 *  - the fund NAME, which becomes {@link SYNTHETIC_FUND_NAME} — the loudest possible
 *    signal, at a glance, that nothing in this file is a real position;
 *  - the fund ID, which is re-derived as the slug of that synthetic name rather than
 *    carried over. It is not a magnitude, but it WAS the real fund's identifier, and
 *    it appeared on every anchor of a file this public repository checks in;
 *  - every rung `priceUsd` in the `dca` branch. A declared rung price is the operator's
 *    intended entry level — a magnitude, and one ADR-006 explicitly notes is the same
 *    shape as a stop level — so it falls under the magnitudes rule with everything
 *    else. The COUNT and the ORDER survive because the card is a rung table; the
 *    LEVELS are invented from {@link SYNTHETIC_RUNG_TOP} down;
 *  - every `planId`, which becomes a counted {@link syntheticPlanId}. A plan id is a
 *    UUID minted into the operator's PRIVATE sidecar: not a magnitude and not a
 *    disclosure of strategy the way a `positionId` is, but not a string this repository
 *    authored either, and the authorship test is the one that decides;
 *  - every rung `id`, which becomes `rung-N` positionally, for the same reason;
 *  - every fill QUANTITY and the mismatched `orderPriceUsd` — `placedQuantity`,
 *    `venueConsumedQuantity`, `bookedQuantity`, `deployedUsd`, `unitsAcquired`,
 *    `avgEntryUsd` and both waiting totals. They are amounts of a real asset at a real
 *    venue, and the waiting totals in particular are sums of the declared `sizeUsd` the
 *    wire deliberately does not ship — carrying them would publish it in aggregate;
 *  - every `positionId`, which becomes `synthetic-position-N` by first appearance
 *    across the series. It is not a magnitude, but the operator's naming convention
 *    spells out a live position's VENUE, INSTRUMENT and STRATEGY, and the string is
 *    lifted straight out of the private sidecar. See {@link synthesizeDca} for why the
 *    repo's "code identifiers keep their literal names" policy does not reach it, and
 *    why the rung wobble is re-seeded from the synthetic id rather than the real one.
 *
 * ── WHAT THIS IS NOT ────────────────────────────────────────────────────────────
 * This is not de-identification, and the committed fixture is not identity-clean.
 * Row IDs and row LABELS are PRESERVED VERBATIM, deliberately: they are load-bearing
 * shape (see the structural bullet above) and the file carries the project's own
 * names — `portfolio:accumulus` and `"Accumulus"` appear on every anchor, dozens of
 * times each. That is repo policy, not an oversight: `docs/local-data.md` holds the
 * line that code identifiers keep their literal names.
 *
 * THE LINE THAT POLICY DRAWS IS AUTHORSHIP, NOT SYNTAX, and it is worth stating flatly
 * because this module already got it wrong once. A string kept verbatim must be one
 * THIS REPOSITORY AUTHORS — a section id, a row kind, `portfolio:accumulus`, a source
 * path. A string read out of the private store is DATA no matter how identifier-shaped
 * it looks, and it is synthesized. `positionId` sat on the wrong side of that line
 * when the `dca` branch landed, and shipped once in a public fixture (PR #282). When a new field
 * arrives on this payload, the question is not "is it a magnitude" — it is "did we
 * write this string, or did the operator's private file". Only the first is kept.
 *
 * What synthesis withholds is therefore six things — MAGNITUDES (the fill quantities
 * among them, since v5), the NAV series' scale, the fund NAME, the fund ID, every
 * `positionId`, and every durable IDENTIFIER minted into the private sidecars (`planId`,
 * rung `id`) — and nothing else should be inferred from the fact that this module ran.
 *
 * ── THE NAV SERIES, AND WHY IT IS JITTERED ──────────────────────────────────────
 * Preserving every day-over-day NAV change EXACTLY would be mathematically the same
 * as publishing the real NAV series up to a single unknown factor — and any single
 * real NAV that ever becomes public makes that factor recoverable by division, which
 * unscales the whole series. Composition, cost basis and P&L are SYNTHESIZED
 * HERE FROM INVENTED PARAMETERS rather than scaled, so recovering the factor recovers
 * nothing about them (a uniform scale of the whole payload — the cheap alternative —
 * would have handed all of it back). The NAV series was the last thing it still
 * bought, and {@link NAV_JITTER_PP} closes it: every day-over-day percent change
 * carries a deterministic offset of up to ±0.05 percentage points, so no division
 * recovers the real series.
 *
 * WHAT THE JITTER MUST NOT DO is move a verdict. `navMove` is a THRESHOLD test at
 * {@link NAV_MOVE_THRESHOLD_PCT}, and slice 4's replay asserts a measured 6 *yes* /
 * 22 *no* across the anchors it was measured on. The headroom is sufficient by construction — the
 * gap between the smallest firing move and the largest non-firing one is wider than
 * the jitter band by more than an order of magnitude — but sufficiency is ASSERTED,
 * not trusted: {@link assertThresholdSideHolds} runs on every regeneration, has the
 * real series in hand, and throws rather than emit a fixture whose verdict history
 * differs from the fund's by one day.
 *
 * THE MOVES THEMSELVES ARE NOT NAMED HERE. This repository is public, and a comment
 * listing the firing moves to two decimals publishes the fund's largest days as surely
 * as the NAV series would. The real values belong to `assertThresholdSideHolds`'s
 * runtime, and to the private notes vault — never to a committed doc comment.
 *
 * ── HOW THE INVENTED NUMBERS ARE BUILT ──────────────────────────────────────────
 * Deterministically, from `(asOf, rowId)` only — no clock, no randomness, no run id —
 * so regenerating against an unchanged log rewrites byte-identical content.
 *
 *  1. NAV: `nav[0] = 100000`; each subsequent anchor compounds the REAL day-over-day
 *     percent change plus that anchor's own jitter offset, hashed from its date.
 *  2. PERCENTAGES: each section gets a RANK LADDER — `RANK_DECAY^rank`, times a small
 *     deterministic wobble so consecutive anchors move differently per row (slice 5
 *     renders per-row deltas; a flat share would make every row's delta the NAV's).
 *     The Reserve row is PINNED to its real percentage and the rest of its section
 *     fills what remains. Ladders are strictly decreasing, so the section stays sorted
 *     and `summary.largest*` still names each section's top row.
 *  3. FUND-LEVEL P&L: `P = PNL_RATE * nav`, and total cost basis `C = A - P`, where
 *     `A` is the invested (non-Reserve) share of the fund. `A` is not free: it is the
 *     value that lets EVERY section's cost basis sum to the same `C` and P&L sum to
 *     the same `P`, exactly as the real report's five partitions of one book do.
 *     Sections carrying no slack row (all their cost rows satisfy the identity) pin
 *     `A`; the rest are nudged above it via {@link solveNonCostScale}.
 *  4. PER-ROW COST AND P&L: `P` is spread across a section's P&L rows by
 *     `usdValue * gain`, the smallest row taking a LOSS so slice 5 has a negative to
 *     render. Then, per row, `costBasisUsd = usdValue - unrealizedPnlUsd - slack`,
 *     where `slack` is ZERO for rows on which the real data holds
 *     `pnl == usd - cost`, and POSITIVE for rows on which it does not (rows mixing
 *     cash with positions). The identity therefore holds in the fixture exactly where
 *     it holds in the real fold, and breaks exactly where it breaks.
 *
 * There is NO real-magnitude variant, by choice. The generator has one output and it
 * is sanitized; no flag, no env toggle, no second path that could write real
 * magnitudes to disk and be committed by accident. Cross-checking the fixture against
 * the real log is `glance.test.ts`'s job — it re-derives an anchor live and compares
 * the TRIGGER-RELEVANT projections, which is the comparison that can still catch
 * structural drift now that magnitudes deliberately differ.
 */
import type {
  CompositionReport,
  CompositionRow,
  DashboardFocus,
  DashboardSection,
} from "@numisma/engine";
import type {
  DcaBlock,
  DcaWireFillFigures,
  DcaWireRung,
  SnapshotAnchor,
} from "../projection/contract.ts";
import { fundIdOf } from "../projection/contract.ts";
import { NAV_MOVE_THRESHOLD_PCT } from "../glance/verdict.ts";

/** The round, obviously fictional NAV the synthetic series starts at. */
export const SYNTHETIC_START_NAV = 100_000;

/**
 * Peak deterministic offset applied to each day-over-day NAV percent change, in
 * PERCENTAGE POINTS. The offset is drawn from the anchor's own date, so it is stable
 * across regenerations — `cmp` on two runs must be clean — and it is what stops the
 * published NAVs from unscaling the series by division.
 *
 * Exported because the honesty gate in `glance.test.ts` compares a fixture NAV ratio
 * against a live fold's and needs to admit exactly this much drift and no more.
 */
export const NAV_JITTER_PP = 0.05;

/**
 * The `navMove` trigger's threshold, in percent. This module does not implement the
 * trigger — it re-exports the READER'S OWN constant so it can prove the jitter never
 * carries a move across it.
 *
 * Re-exported rather than re-declared (slice #150): a second copy of `1.5` here could
 * drift from the one the verdict actually tests against, and the generator's whole
 * claim is that the committed fixture reproduces the verdict history. Importing the
 * real constant makes "no move crossed the threshold" a statement about the threshold
 * that ships, not about a number that agreed with it once.
 */
export { NAV_MOVE_THRESHOLD_PCT };

/**
 * The fund name every synthetic anchor carries. Deliberately the same posture as the
 * sibling `composition-report.fixture.json`'s "Sanitized Exploratory Fund": a reader
 * who opens the file must not have to reason about whether it is real.
 */
export const SYNTHETIC_FUND_NAME = "Sanitized Exploratory Fund";

/**
 * `fundIdOf` over a bare fund name. The slug reads nothing but
 * `dashboard.summary.fundName`, so a name-shaped stand-in is enough — and going
 * through the REAL derivation, rather than a second copy of its regex, is what keeps
 * the synthetic id from drifting away from the synthetic name.
 */
function fundIdOfName(fundName: string): string {
  return fundIdOf({
    dashboard: { summary: { fundName } },
  } as unknown as CompositionReport);
}

/**
 * The fund id every synthetic anchor carries — {@link SYNTHETIC_FUND_NAME} put through
 * the system's own `fundIdOf`, which is also how {@link synthesizeAnchor} derives the
 * id it writes onto each anchor. Both come from one derivation, so there is no literal
 * left here to hand-maintain and nothing for a pin test to catch.
 *
 * The id used to pass through untouched, which meant the committed fixture named the
 * real fund on every one of its anchors while its `fundName` said otherwise. `fundName`
 * is the loud signal; `fund_id` is the quiet one, and a public repository publishes
 * both equally.
 *
 * Exported for `anchor-fixture.test.ts`, whose guard reads the COMMITTED BYTES: the
 * file on disk must carry this id on every anchor, not merely whatever the generator
 * would produce if it were re-run.
 */
export const SYNTHETIC_FUND_ID = fundIdOfName(SYNTHETIC_FUND_NAME);

/**
 * The round, obviously fictional price the synthetic rung ladder starts at, and the
 * fraction each rung steps down by. A DCA ladder's shape is "a descending sequence of
 * limits", so the synthetic one is generated as exactly that and nothing more: the
 * count and the ordering are real, the levels are not.
 *
 * THE STEP IS GEOMETRIC — `(1 - RUNG_STEP) ** index`, each rung a fixed FRACTION of
 * the one above — and that is a correctness requirement, not a taste. The linear form
 * this started as (`1 - RUNG_STEP * index`) reaches zero at rung 17 and goes NEGATIVE
 * after it, so a ladder deeper than sixteen rungs would have published negative limit
 * prices into a public fixture and rendered `-$200.14` on the card. Neither existing
 * assertion could see it: a negative tail is still strictly descending, and it still
 * carries over no real value. A price is a POSITIVE magnitude, and the geometric form
 * is the one that says so at every depth. `synthesizeDca`'s own test pins a
 * twenty-four-rung ladder against exactly that.
 *
 * A deterministic per-rung wobble (drawn from {@link hashUnit} on the anchor date and
 * the position id, like every other invented number here) keeps the values from
 * reading as a clean decay curve. At ±1% against a 6% step it can never reorder two
 * rungs — worst case the ratio between neighbours is 0.94 × 1.01 / 0.99 < 1 — and,
 * being multiplicative like the step itself, it cannot change a price's sign either.
 */
const SYNTHETIC_RUNG_TOP = 10_000;
const RUNG_STEP = 0.06;
const RUNG_WOBBLE = 0.01;

/**
 * The prefix every synthetic `positionId` carries — the same posture as
 * {@link SYNTHETIC_FUND_NAME}: a reader who opens the committed file must not have to
 * reason about whether a position is real.
 *
 * Exported for `anchor-fixture.test.ts`, whose guard reads the COMMITTED BYTES: every
 * `positionId` in the file on disk must match this shape, not merely whatever the
 * generator would produce if it were re-run.
 */
export const SYNTHETIC_POSITION_PREFIX = "synthetic-position";

/**
 * The invented per-rung declared size, and the invented quantity a synthetic order is
 * placed for. Both are MAGNITUDES the wire started carrying at v5 (the waiting figures
 * are sums of the first; the placed/consumed/booked quantities are the second), so both
 * fall under the magnitudes rule with everything else here.
 *
 * Round and fictional on purpose, like {@link SYNTHETIC_START_NAV} and
 * {@link SYNTHETIC_RUNG_TOP} above: a reader who opens the file must not have to reason
 * about whether a figure is the desk's.
 */
const SYNTHETIC_RUNG_SIZE_USD = 250;
const SYNTHETIC_PLACED_QUANTITY = 2;
/** How far a mismatched order's invented price sits from its rung's, as a fraction. */
const SYNTHETIC_MISMATCH_OFFSET = 0.004;

/**
 * The UUID shape every synthetic `planId` carries — the repo's counted-UUID fixture
 * convention (`00000000-0000-4000-8000-<ordinal>`), which reads as obviously fake at a
 * glance while still being a well-formed v4 UUID for anything that parses it.
 *
 * A REAL `planId` IS DATA, not a code identifier, and the distinction is the one this
 * module's header draws: the id is a UUID minted into the operator's PRIVATE plans
 * sidecar. It discloses no venue or strategy the way a `positionId` does, but it is a
 * durable handle on a real ladder, and the authorship test — did this repository write
 * this string, or did the operator's private file — puts it on the synthesized side
 * without needing a second argument about how much it leaks.
 *
 * Exported for `anchor-fixture.test.ts`, which reads the COMMITTED BYTES.
 */
export const SYNTHETIC_PLAN_ID_PREFIX = "00000000-0000-4000-8000-";

/** The synthetic plan id for an ordinal — counted from 1, zero-padded to 12 digits. */
export function syntheticPlanId(ordinal: number): string {
  return `${SYNTHETIC_PLAN_ID_PREFIX}${String(ordinal).padStart(12, "0")}`;
}

/**
 * The synthetic rung id at one position in a ladder — counted from 1, as declared.
 *
 * Exported for `anchor-fixture.test.ts`, which reads the COMMITTED BYTES: every rung in
 * the file on disk must carry this shape, not merely whatever the generator would emit
 * if it were re-run.
 */
export function syntheticRungId(index: number): string {
  return `rung-${index + 1}`;
}

/**
 * Map every distinct real `positionId` in a whole series to its synthetic stand-in,
 * numbered by FIRST APPEARANCE across the anchors in order.
 *
 * SERIES-LEVEL rather than per-anchor, because a plan that appears on twelve anchors
 * is ONE plan and the fixture has to keep saying so: the card groups by id, and a
 * per-anchor renaming would turn one position into twelve.
 *
 * The ordinal discloses only the position COUNT and the order in which they first
 * appear — both already preserved as shape, both already visible in the file. It is
 * deliberately NOT a hash of the real id: a hash is a commitment the real string can
 * be tested against by anyone who guesses it, which is the same disclosure at a higher
 * price.
 */
function synthesizePositionIds(
  anchors: readonly SnapshotAnchor[],
): Map<string, string> {
  const ids = new Map<string, string>();
  for (const anchor of anchors) {
    for (const position of anchor.report.dca.positions) {
      if (!ids.has(position.positionId)) {
        ids.set(position.positionId, `${SYNTHETIC_POSITION_PREFIX}-${ids.size + 1}`);
      }
    }
  }
  return ids;
}

/**
 * The key one LADDER is identified by across the series: its position and its own id
 * together. Written `positionId\0planId` for the reason {@link hashUnit} joins on the
 * escape — so `("ab", "c")` and `("a", "bc")` cannot collide on one entry.
 */
function ladderKey(positionId: string, planId: string | undefined): string {
  return `${positionId}\0${planId ?? ""}`;
}

/**
 * Map every distinct declared LADDER in a series to its synthetic plan id, numbered by
 * first appearance — the same series-level discipline
 * {@link synthesizePositionIds} follows, and for the same reason: one ladder appearing
 * on twelve anchors is one ladder, and the route resolves on this key.
 *
 * KEYED BY `(positionId, planId)` RATHER THAN BY `planId` ALONE, which is what lets one
 * rule serve two cases. A v5-era anchor carries a real plan id and it maps. An anchor
 * REGENERATED FROM A v4-ERA SHAPE carries none — the field did not exist when the row
 * was built — and it still needs an id, because the file is stamped v5 and a ladder row
 * without one is a v4 row wearing a v5 label. Keying on the pair gives the idless case
 * its own ordinal instead of collapsing every one of them onto a single shared id.
 *
 * SUPERSESSION IS THEREFORE PRESERVED: two ladders declared for one position across the
 * series are two keys and get two ids, exactly as the real file has two.
 */
function synthesizePlanIds(anchors: readonly SnapshotAnchor[]): Map<string, string> {
  const ids = new Map<string, string>();
  for (const anchor of anchors) {
    for (const position of anchor.report.dca.positions) {
      if (position.kind !== "dcaLadder") continue;
      const key = ladderKey(position.positionId, position.planId);
      if (!ids.has(key)) {
        ids.set(key, syntheticPlanId(ids.size + 1));
      }
    }
  }
  return ids;
}

/**
 * Synthesize ONE rung's v5 fill state: every STATE and the measured FRACTION verbatim,
 * every QUANTITY and PRICE invented.
 *
 * THE SPLIT IS THE SAME ONE THIS MODULE ALREADY DRAWS. `venueAxis`, `bookAxis`, `label`,
 * `joinProvenance`, `declaredPriceMismatch` and `resting` are conclusions with no
 * magnitude in them — the class copied whole, like `state` and the `glance` block.
 * `placedQuantity`, `venueConsumedQuantity`, `bookedQuantity` and `orderPriceUsd` are
 * amounts of a real asset at a real venue, and they are invented.
 *
 * `venueFilledFraction` IS PRESERVED, and it is the one number here that is neither
 * copied-because-harmless nor invented-because-a-magnitude. It is a RATIO — it
 * discloses no size — and the `label` beside it already renders it (`partly filled ·
 * 50%`), so inventing it would make the fixture's own two fields disagree. The invented
 * quantities are then derived FROM it, which is what keeps `consumed / placed` equal to
 * the fraction the label states.
 *
 * ABSENCE IS PRESERVED EXACTLY. A rung with no order joined carries no fill key, and
 * comes back carrying none: that absence is the day-zero state the surface renders, and
 * manufacturing a state for it would make the fixture claim a history the fund never had.
 */
function synthesizeRung(rung: DcaWireRung, index: number): DcaWireRung {
  const synthetic: DcaWireRung = { id: syntheticRungId(index), priceUsd: rung.priceUsd };
  if (rung.venueAxis === undefined) {
    return synthetic;
  }
  const placed = SYNTHETIC_PLACED_QUANTITY;
  const fraction =
    rung.venueFilledFraction ??
    (rung.venueAxis === "filled" ? 1 : rung.venueAxis === "resting" ? 0 : 0.5);
  const consumed = placed * fraction;
  const booked =
    rung.bookAxis === "recorded"
      ? consumed
      : rung.bookAxis === "partly-recorded"
        ? consumed / 2
        : 0;
  return {
    ...synthetic,
    venueAxis: rung.venueAxis,
    ...(rung.bookAxis === undefined ? {} : { bookAxis: rung.bookAxis }),
    ...(rung.label === undefined ? {} : { label: rung.label }),
    ...(rung.joinProvenance === undefined ? {} : { joinProvenance: rung.joinProvenance }),
    ...(rung.declaredPriceMismatch
      ? {
          // Invented, and derived from the rung's ALREADY-SYNTHETIC price so it carries
          // nothing of the real one — while still landing off the declared level, which
          // is the only fact the mismatch flag is making.
          orderPriceUsd:
            Math.round(rung.priceUsd * (1 - SYNTHETIC_MISMATCH_OFFSET) * 100) / 100,
        }
      : {}),
    ...(rung.declaredPriceMismatch === undefined
      ? {}
      : { declaredPriceMismatch: rung.declaredPriceMismatch }),
    placedQuantity: placed,
    venueConsumedQuantity: consumed,
    bookedQuantity: booked,
    ...(rung.venueFilledFraction === undefined
      ? {}
      : { venueFilledFraction: rung.venueFilledFraction }),
    ...(rung.resting === undefined ? {} : { resting: rung.resting }),
  };
}

/**
 * Synthesize a ladder's measured figures: PRESENCE preserved exactly, every value
 * invented from the synthetic rungs beside them.
 *
 * PRESENCE IS THE LOAD-BEARING PART, because absence is what the surface renders as
 * "no fill recorded" with a named cause. A synthesizer that filled the three measured
 * figures in would make slice 4 green against a shape the push never emits on day zero,
 * which is the state the live fund is actually in.
 *
 * The waiting figures are rebuilt as COUNTS × an invented rung size rather than carried
 * over: they are sums of `sizeUsd`, which is the one declared quantity the wire
 * deliberately does not ship, and carrying them would publish it in aggregate.
 */
function synthesizeFigures(
  figures: DcaWireFillFigures,
  rungs: readonly DcaWireRung[],
): DcaWireFillFigures {
  const unfilled = rungs.filter((rung) => rung.venueAxis !== "filled").length;
  const resting = rungs.filter((rung) => rung.resting === true).length;
  const units = rungs.reduce((sum, rung) => sum + (rung.bookedQuantity ?? 0), 0);
  const deployed = rungs.reduce(
    (sum, rung) => sum + (rung.bookedQuantity ?? 0) * rung.priceUsd,
    0,
  );
  return {
    ...(figures.deployedUsd === undefined ? {} : { deployedUsd: deployed }),
    ...(figures.unitsAcquired === undefined ? {} : { unitsAcquired: units }),
    ...(figures.avgEntryUsd === undefined
      ? {}
      : { avgEntryUsd: units > 0 ? deployed / units : 0 }),
    waitingDeclaredUsd: unfilled * SYNTHETIC_RUNG_SIZE_USD,
    waitingRestingUsd: resting * SYNTHETIC_RUNG_SIZE_USD,
  };
}

/**
 * Synthesize the DCA branch: every state and count VERBATIM, every identifier and
 * every rung price INVENTED.
 *
 * `source`, `state`, `kind` and `unattributable` are copied because they are
 * CONCLUSIONS with no magnitude in them — the same reasoning that copies the `glance`
 * block whole.
 *
 * `positionId` IS REPLACED, and it is the one identifier in this file that is. Row ids
 * and row labels stay verbatim under the repo policy that code identifiers keep their
 * literal names (`docs/local-data.md`) — but that policy governs names THIS REPOSITORY
 * AUTHORS: source paths, doc filenames, `portfolio:accumulus`. A `positionId` is not
 * one of those. It is an operator-authored string lifted out of the PRIVATE sidecar,
 * and the convention names the venue, the instrument and the strategy of a live
 * position — the fund's composition, in the one field that had been reasoned about as
 * though it were a code identifier. One real id did ship on exactly that reasoning
 * (PR #282), which is why the rule now lives in code rather than in a paragraph:
 * DATA-DERIVED strings are synthesized, REPOSITORY-AUTHORED names are kept, and
 * `anchor-fixture.test.ts` reads the committed bytes rather than trusting either.
 *
 * THE RUNG WOBBLE IS SEEDED FROM THE SYNTHETIC ID, not the real one. Seeding it from
 * the real string would leave every committed rung price a hash commitment to the very
 * thing this function exists to withhold — the disclosure would survive the rename,
 * in a form nobody would think to grep for.
 *
 * Among the rungs only `priceUsd` is replaced, and it is replaced positionally so that
 * a ladder of eight rungs stays a ladder of eight rungs: the card under test renders a
 * row per rung, and a synthesis that changed the count would change what the fixture
 * proves.
 *
 * The rung ORDER is left where it was found. This module never sorts; the view does.
 */
function synthesizeDca(
  dca: DcaBlock,
  asOf: string,
  ids: ReadonlyMap<string, string>,
  planIds: ReadonlyMap<string, string>,
): DcaBlock {
  return {
    source: dca.source,
    unattributable: dca.unattributable,
    positions: dca.positions.map((position) => {
      const positionId = ids.get(position.positionId);
      if (positionId === undefined) {
        // Unreachable through `synthesizeAnchors`, which maps the whole series before
        // it synthesizes any anchor. A throw rather than a fallback to the real id:
        // the one outcome this function must never have is emitting the private
        // string because a lookup missed.
        throw new Error(
          `fixture synthesis: no synthetic id was assigned for a position on ${asOf}.`,
        );
      }
      // Spread first so the override lands in `positionId`'s ORIGINAL slot: the
      // committed file's key order is asserted elsewhere, and a renamed key that
      // moved would read as a shape change.
      const synthetic = { ...position, positionId };
      if (position.kind === "dcaLadder") {
        const planId = planIds.get(ladderKey(position.positionId, position.planId));
        if (planId === undefined) {
          // Unreachable through `synthesizeAnchors`, which maps the whole series first.
          // A throw rather than a fallback, for the reason the position-id lookup throws:
          // the one outcome this function must never have is emitting the private value
          // because a lookup missed.
          throw new Error(
            `fixture synthesis: no synthetic plan id was assigned for a ladder on ${asOf}.`,
          );
        }
        synthetic.planId = planId;
      }
      if (position.rungs !== undefined) {
        synthetic.rungs = position.rungs.map((rung, index) => {
          const wobble = RUNG_WOBBLE * (2 * hashUnit(asOf, positionId, `rung-${index}`) - 1);
          const level =
            SYNTHETIC_RUNG_TOP * Math.pow(1 - RUNG_STEP, index) * (1 + wobble);
          return synthesizeRung(
            { ...rung, priceUsd: Math.round(level * 100) / 100 },
            index,
          );
        });
      }
      if (position.figures !== undefined) {
        synthetic.figures = synthesizeFigures(position.figures, synthetic.rungs ?? []);
      }
      return synthetic;
    }),
  };
}

/** Each rank holds this fraction of the one above it, before the wobble. */
const RANK_DECAY = 0.72;
/** Peak per-row, per-anchor deviation from the ladder. Small enough to keep rank order. */
const WOBBLE = 0.03;
/** Fund-level unrealized P&L, as a fraction of NAV. */
const PNL_RATE = 0.12;
/** Per-row gain rate range, used only to spread the fund total across rows. */
const GAIN_MIN = 0.02;
const GAIN_SPAN = 0.28;
/** How far above the pinning share a slack-bearing section's invested share sits. */
const SLACK_MARGIN_PCT = 1.5;
/** Invested share to assume when no section can pin one (degenerate shapes only). */
const FALLBACK_INVESTED_PCT = 60;
/** Cost-basis fraction used only on the fallback path (a section that cannot balance). */
const FALLBACK_COST_MIN = 0.55;
const FALLBACK_COST_SPAN = 0.3;

const PCT_EPSILON = 1e-9;

/**
 * FNV-1a over the inputs, mapped to `[0, 1)`. The ONLY source of variation in this
 * module, and it is a pure function of `(asOf, rowId, salt)` — which is what makes
 * regeneration byte-identical.
 *
 * The parts are joined on `\0` so that `("ab", "c")` and `("a", "bc")` cannot collide
 * on one seed. It is written as the ESCAPE and must stay that way: the literal control
 * character was here first, and a single raw NUL made every text tool — `grep`, `rg`,
 * GitHub's blob view — classify this whole file as binary and silently skip it. A
 * sanitizer that no code search can find is a bad place to hide.
 */
function hashUnit(...parts: string[]): number {
  let hash = 0x811c9dc5;
  for (const part of parts.join("\0")) {
    hash ^= part.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash / 0x1_0000_0000;
}

/** Does `usdValue - costBasisUsd == unrealizedPnlUsd` hold on this row, as folded? */
function identityHolds(row: CompositionRow): boolean {
  if (row.costBasisUsd === undefined || row.unrealizedPnlUsd === undefined) {
    return false;
  }
  const residual = row.usdValue - row.costBasisUsd - row.unrealizedPnlUsd;
  return Math.abs(residual) <= 1e-6 * Math.max(1, Math.abs(row.usdValue));
}

/** Per-row facts the plan needs, read from the REAL row's shape (never its values). */
interface RowPlan {
  readonly row: CompositionRow;
  readonly rank: number;
  readonly weight: number;
  readonly hasCost: boolean;
  readonly hasPnl: boolean;
  /** A cost row whose `usd - cost == pnl` does NOT hold — where slack may be placed. */
  readonly isSlack: boolean;
  readonly pinnedPct: number | undefined;
  percentOfFund: number;
}

interface SectionPlan {
  readonly section: DashboardSection;
  readonly rows: RowPlan[];
  /** Section percentage total: 100 when the real section covers the whole fund. */
  total: number;
  /** Percentage of fund held by this section's cost-bearing rows. */
  investedPct: number;
  readonly isFull: boolean;
  readonly hasCostRows: boolean;
  readonly hasSlackRows: boolean;
}

/**
 * Solve the multiplier on the non-cost rows' ladder weights that makes a section's
 * COST-BEARING rows hold exactly `targetPct` of the fund.
 *
 * This is what lets five different partitions of one book agree on a single total
 * cost basis. Returns `undefined` when the section has no non-cost row to move (its
 * invested share is then fixed and the caller falls back).
 */
function solveNonCostScale(
  plan: SectionPlan,
  targetPct: number,
): number | undefined {
  let pinnedCost = 0;
  let pinnedOther = 0;
  let costWeight = 0;
  let nonCostWeight = 0;
  for (const row of plan.rows) {
    if (row.pinnedPct !== undefined) {
      if (row.hasCost) pinnedCost += row.pinnedPct;
      else pinnedOther += row.pinnedPct;
      continue;
    }
    if (row.hasCost) costWeight += row.weight;
    else nonCostWeight += row.weight;
  }
  const free = plan.total - pinnedCost - pinnedOther;
  const wanted = targetPct - pinnedCost;
  if (nonCostWeight <= 0 || costWeight <= 0 || wanted <= 0 || free <= 0) {
    return undefined;
  }
  const scale = ((free * costWeight) / wanted - costWeight) / nonCostWeight;
  return scale > 0 ? scale : undefined;
}

/** Lay the ladder down over a section, honouring pins and the non-cost multiplier. */
function assignPercentages(plan: SectionPlan, nonCostScale: number): void {
  let pinned = 0;
  let weight = 0;
  for (const row of plan.rows) {
    if (row.pinnedPct !== undefined) {
      pinned += row.pinnedPct;
      continue;
    }
    weight += row.hasCost ? row.weight : row.weight * nonCostScale;
  }
  const free = plan.total - pinned;
  let invested = 0;
  for (const row of plan.rows) {
    row.percentOfFund =
      row.pinnedPct ??
      (weight > 0
        ? (free * (row.hasCost ? row.weight : row.weight * nonCostScale)) / weight
        : 0);
    if (row.hasCost) invested += row.percentOfFund;
  }
  plan.investedPct = invested;
}

/**
 * Build the per-section plan for one anchor: ladder weights, pins, and the initial
 * (unadjusted) percentages.
 */
function planSections(
  sections: DashboardSection[],
  asOf: string,
  pinnedPct: Map<string, number>,
  investedTargetPct: number | undefined,
): SectionPlan[] {
  const plans: SectionPlan[] = [];
  for (const section of sections) {
    const rows = section.rows.map((row, rank): RowPlan => {
      const wobble = 1 + WOBBLE * (2 * hashUnit(asOf, row.id, "rank") - 1);
      return {
        row,
        rank,
        weight: RANK_DECAY ** rank * wobble,
        hasCost: row.costBasisUsd !== undefined,
        hasPnl: row.unrealizedPnlUsd !== undefined,
        isSlack: row.costBasisUsd !== undefined && !identityHolds(row),
        pinnedPct: pinnedPct.get(row.id),
        percentOfFund: 0,
      };
    });
    const realTotal = section.rows.reduce((sum, r) => sum + r.percentOfFund, 0);
    const isFull = Math.abs(realTotal - 100) < 1e-6;
    const hasSlackRows = rows.some((r) => r.isSlack);
    // A section that does not cover the whole fund (the capital tiers) gets an
    // invented total too — pegged to the invested share, plus the slack margin when
    // it holds a slack row, so its cost rows can still carry the same total cost
    // basis every other section carries.
    const partialTotal =
      investedTargetPct === undefined
        ? FALLBACK_INVESTED_PCT
        : investedTargetPct + (hasSlackRows ? SLACK_MARGIN_PCT : 0);
    const plan: SectionPlan = {
      section,
      rows,
      total: isFull ? 100 : partialTotal,
      investedPct: 0,
      isFull,
      hasCostRows: rows.some((r) => r.hasCost),
      hasSlackRows,
    };
    assignPercentages(plan, 1);
    plans.push(plan);
  }
  return plans;
}

/**
 * The fund's invested (cost-bearing) share of NAV, in percent.
 *
 * It is PINNED by the sections that hold no slack row: every one of their cost rows
 * must satisfy `cost == usd - pnl`, so their cost basis total is fully determined by
 * their percentages, and every other section has to agree with it. Sections that DO
 * hold slack rows are pushed a margin above, so their slack lands strictly positive
 * and the identity genuinely breaks there — as it does in the real fold.
 */
function investedShareOf(plans: SectionPlan[]): number {
  const full = plans.filter((p) => p.isFull && p.hasCostRows);
  if (full.length === 0) return FALLBACK_INVESTED_PCT;
  const pinning = full.filter((p) => !p.hasSlackRows);
  if (pinning.length > 0) {
    return Math.min(...pinning.map((p) => p.investedPct));
  }
  return Math.min(...full.map((p) => p.investedPct)) - SLACK_MARGIN_PCT;
}

/** Spread `total` across `weights`, or hand back zeros when the weights cannot carry it. */
function spread(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(sum) || Math.abs(sum) < PCT_EPSILON) {
    return weights.map(() => 0);
  }
  return weights.map((w) => (total * w) / sum);
}

/**
 * Give every P&L row in a section its share of the fund's total P&L. Weighted by
 * `usdValue * gain`, with the SMALLEST row in a section of four or more flipped
 * negative: real books hold losers, and slice 5 renders a per-row delta that must
 * have a negative case in the fixture.
 */
function assignPnl(
  plan: SectionPlan,
  asOf: string,
  totalPnl: number,
): Map<string, number> {
  const pnlRows = plan.rows.filter((r) => r.hasPnl);
  const weights = pnlRows.map(
    (r) =>
      r.percentOfFund *
      (GAIN_MIN + GAIN_SPAN * hashUnit(asOf, r.row.id, "gain")),
  );
  if (pnlRows.length >= 4 && weights.length > 0) {
    const smallest = weights.reduce(
      (best, w, i) => (w < weights[best]! ? i : best),
      0,
    );
    const rest = weights.reduce((a, b) => a + b, 0) - weights[smallest]!;
    // Only flip when the remainder still dominates, so the normalising sum stays
    // positive and every other row keeps the sign the total has.
    if (weights[smallest]! * 2 < rest) weights[smallest] = -weights[smallest]!;
  }
  const shares = spread(totalPnl, weights);
  return new Map(pnlRows.map((r, i) => [r.row.id, shares[i] ?? 0]));
}

/**
 * Emit a section's rows with synthetic magnitudes, preserving key presence exactly.
 *
 * `totalCost` is the fund-wide cost basis every section must sum to. When a section
 * cannot reach it — no slack row to absorb the difference, or absorbing it would drive
 * a cost basis negative — the section falls back to per-row invented cost ratios: the
 * rows stay individually well-formed, only the cross-section total stops agreeing.
 */
function synthesizeRows(
  plan: SectionPlan,
  asOf: string,
  nav: number,
  totalPnl: number,
  totalCost: number,
): CompositionRow[] {
  const pnlById = assignPnl(plan, asOf, totalPnl);
  const usdById = new Map(
    plan.rows.map((r) => [r.row.id, (r.percentOfFund / 100) * nav]),
  );

  const costRows = plan.rows.filter((r) => r.hasCost);
  const slackRows = costRows.filter((r) => r.isSlack);
  const costUsd = costRows.reduce((sum, r) => sum + (usdById.get(r.row.id) ?? 0), 0);
  const costPnl = costRows.reduce((sum, r) => sum + (pnlById.get(r.row.id) ?? 0), 0);
  const slackTotal = costUsd - costPnl - totalCost;

  let slackById = new Map<string, number>();
  let balanced = costRows.length === 0;
  if (!balanced && Math.abs(slackTotal) < 1e-6) {
    balanced = slackRows.length === 0;
  } else if (!balanced && slackTotal > 0 && slackRows.length > 0) {
    const shares = spread(
      slackTotal,
      slackRows.map((r) => 0.5 + hashUnit(asOf, r.row.id, "slack")),
    );
    slackById = new Map(slackRows.map((r, i) => [r.row.id, shares[i] ?? 0]));
    balanced = slackRows.every(
      (r, i) =>
        (usdById.get(r.row.id) ?? 0) -
          (pnlById.get(r.row.id) ?? 0) -
          (shares[i] ?? 0) >
        0,
    );
  }

  return plan.rows.map((planned): CompositionRow => {
    const usdValue = usdById.get(planned.row.id) ?? 0;
    const next: CompositionRow = { ...planned.row, usdValue };
    next.percentOfFund = planned.percentOfFund;
    if (planned.hasPnl) next.unrealizedPnlUsd = pnlById.get(planned.row.id) ?? 0;
    if (planned.hasCost) {
      const pnl = pnlById.get(planned.row.id) ?? 0;
      next.costBasisUsd = balanced
        ? usdValue - pnl - (slackById.get(planned.row.id) ?? 0)
        : planned.isSlack
          ? usdValue *
            (FALLBACK_COST_MIN +
              FALLBACK_COST_SPAN * hashUnit(asOf, planned.row.id, "cost"))
          : usdValue - pnl;
    }
    return next;
  });
}

/** Re-point a summary highlight at the synthetic row it names. */
function refocus(
  focus: DashboardFocus | undefined,
  rows: Map<string, CompositionRow>,
): DashboardFocus | undefined {
  if (!focus) return focus;
  const row = rows.get(focus.rowId);
  if (!row) return focus;
  return { ...focus, usdValue: row.usdValue, percentOfFund: row.percentOfFund };
}

/**
 * Refuse to emit a section whose rows stopped descending. `summary.largest*` names
 * each section's top row and the reader renders sections in order, so a ladder that
 * inverted would ship a fixture that contradicts its own summary.
 */
function assertDescending(sectionId: string, rows: CompositionRow[]): void {
  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i]!.percentOfFund > rows[i - 1]!.percentOfFund + PCT_EPSILON) {
      throw new Error(
        `fixture synthesis: section ${sectionId} came out unsorted at rank ${i} ` +
          `(${rows[i - 1]!.id} ${rows[i - 1]!.percentOfFund} < ${rows[i]!.id} ` +
          `${rows[i]!.percentOfFund}). The rank ladder cannot honour this shape.`,
      );
    }
  }
}

/** Synthesize ONE anchor onto a given synthetic NAV. */
function synthesizeAnchor(
  anchor: SnapshotAnchor,
  nav: number,
  positionIds: ReadonlyMap<string, string>,
  planIds: ReadonlyMap<string, string>,
): SnapshotAnchor {
  const { dashboard, totals, glance, dca } = anchor.report;
  const asOf = anchor.asOf;

  // The one preserved percentage, taken from the summary's own Reserve reference so
  // the pin and the level test read the same row by construction.
  const pinnedPct = new Map<string, number>();
  if (dashboard.summary.reserve) {
    pinnedPct.set(
      dashboard.summary.reserve.rowId,
      dashboard.summary.reserve.percentOfFund,
    );
  }

  // Two passes: the first learns the invested share the sections can agree on, the
  // second lays the ladders down against it (the capital-tier total depends on it).
  const invested = investedShareOf(planSections(dashboard.sections, asOf, pinnedPct, undefined));
  const plans = planSections(dashboard.sections, asOf, pinnedPct, invested);
  for (const plan of plans) {
    if (!plan.hasCostRows) continue;
    const target = plan.hasSlackRows ? invested + SLACK_MARGIN_PCT : invested;
    if (Math.abs(plan.investedPct - target) < PCT_EPSILON) continue;
    if (plan.hasSlackRows && plan.investedPct > target) continue;
    const scale = solveNonCostScale(plan, target);
    if (scale !== undefined) assignPercentages(plan, scale);
  }

  const investedUsd = (invested / 100) * nav;
  const totalPnl = Math.min(PNL_RATE * nav, 0.4 * investedUsd);
  const totalCost = investedUsd - totalPnl;

  const sections = plans.map((plan): DashboardSection => {
    const rows = synthesizeRows(plan, asOf, nav, totalPnl, totalCost);
    assertDescending(plan.section.id, rows);
    return { ...plan.section, rows };
  });
  const byId = new Map(sections.flatMap((s) => s.rows.map((r) => [r.id, r])));

  // Spread first, then re-point in place: a highlight the real summary does not carry
  // must stay ABSENT, not become a key holding `undefined`. The reader distinguishes
  // the two, and the fixture's own D8 key-set assertions read the serialized keys.
  const summary = {
    ...dashboard.summary,
    fundName: SYNTHETIC_FUND_NAME,
    fundValueUsd: nav,
    totalUnrealizedPnlUsd: totalPnl,
  };
  for (const key of [
    "largestPortfolio",
    "largestTempo",
    "largestAccount",
    "largestInstrument",
    "reserve",
  ] as const) {
    const focus = refocus(dashboard.summary[key], byId);
    if (focus !== undefined) summary[key] = focus;
  }

  return {
    // NOT `anchor.fundId`: the id is a slug of the fund name, and the name just
    // assembled is fictional, so carrying the real id through would have the fixture
    // contradict itself while publishing the fund's identifier on every anchor.
    // Derived from the summary that ships, through the system's own `fundIdOf`.
    fundId: fundIdOfName(summary.fundName),
    asOf,
    report: {
      totals: { ...totals, fundValueUsd: nav },
      dashboard: { summary, sections },
      // Copied, never recomputed: `feedGap` and `suppressed` ARE the triggers slice 4
      // replays, and they carry no magnitude to sanitize (D14 already forbids dates).
      glance: structuredClone(glance),
      // States and counts verbatim, position IDS and rung LEVELS invented — see
      // `synthesizeDca`.
      dca: synthesizeDca(dca, asOf, positionIds, planIds),
    },
  };
}

/**
 * This anchor's NAV jitter, in percentage points, on `[-NAV_JITTER_PP, +NAV_JITTER_PP]`.
 *
 * Seeded from the ANCHOR'S OWN DATE through the same {@link hashUnit} every other
 * invented number in this module uses — no clock, no `Math.random`, no run id — which
 * is what makes two regenerations `cmp`-identical. A given date always draws the same
 * offset, so a re-run against an unchanged log rewrites the same bytes and a diff on
 * the committed file still means the LOG changed.
 */
function navJitterPp(asOf: string): number {
  return NAV_JITTER_PP * (2 * hashUnit(asOf, "nav-jitter") - 1);
}

/**
 * Refuse to emit a series whose jitter moved a `navMove` verdict.
 *
 * THE ONE WAY THIS SANITIZATION COULD CORRUPT THE FIXTURE. `navMove` fires on
 * `|change| >= NAV_MOVE_THRESHOLD_PCT`, so a real move sitting within the jitter band
 * of the threshold could cross it and hand slice 4 a verdict history the fund never
 * had. The real series has ample headroom, but this checks the property directly —
 * the generator holds the real change right here — rather than trusting arithmetic
 * done once in a comment.
 */
function assertThresholdSideHolds(
  asOf: string,
  realPct: number,
  jitteredPct: number,
): void {
  const firedReally = Math.abs(realPct) >= NAV_MOVE_THRESHOLD_PCT;
  const firesNow = Math.abs(jitteredPct) >= NAV_MOVE_THRESHOLD_PCT;
  if (firedReally !== firesNow) {
    throw new Error(
      `fixture synthesis: NAV jitter moved the navMove verdict on ${asOf}. The real ` +
        `change was ${realPct.toFixed(4)}% (${firedReally ? "fires" : "silent"}) and ` +
        `the jittered change is ${jitteredPct.toFixed(4)}% (${firesNow ? "fires" : "silent"}), ` +
        `across the ${NAV_MOVE_THRESHOLD_PCT}% threshold. Reduce NAV_JITTER_PP — the ` +
        `fixture must reproduce the fund's own verdict history exactly.`,
    );
  }
}

/**
 * Sanitize a whole replayed history. Pure, total, and deterministic: the same input
 * anchors always produce the same output bytes.
 *
 * Throws when the jitter would move a `navMove` verdict — a loud failure at
 * regeneration time, which is the only moment anyone can act on it.
 */
export function synthesizeAnchors(
  anchors: readonly SnapshotAnchor[],
): SnapshotAnchor[] {
  const out: SnapshotAnchor[] = [];
  // Assigned over the WHOLE series before any anchor is synthesized, so one plan
  // keeps one id across every anchor it appears on.
  const positionIds = synthesizePositionIds(anchors);
  const planIds = synthesizePlanIds(anchors);
  let nav = SYNTHETIC_START_NAV;
  for (const [index, anchor] of anchors.entries()) {
    if (index > 0) {
      const previous = anchors[index - 1]!.report.totals.fundValueUsd;
      const current = anchor.report.totals.fundValueUsd;
      if (previous > 0) {
        // The one quantity carried across anchors: the day-over-day PERCENT CHANGE,
        // jittered. Compounded from the change rather than multiplied by the raw
        // ratio, because the jitter is defined in percentage points — the unit
        // `navMove`'s threshold is stated in.
        const realPct = (current / previous - 1) * 100;
        const jitteredPct = realPct + navJitterPp(anchor.asOf);
        assertThresholdSideHolds(anchor.asOf, realPct, jitteredPct);
        nav *= 1 + jitteredPct / 100;
      } else {
        // A non-positive prior NAV has no change to carry, so the series restarts
        // rather than emitting a NaN.
        nav = SYNTHETIC_START_NAV;
      }
    }
    out.push(synthesizeAnchor(anchor, nav, positionIds, planIds));
  }
  return out;
}
