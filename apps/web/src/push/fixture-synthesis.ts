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
 * Everything slice 4's 28-anchor replay reads. These are COUNTS, RATIOS and SHAPES,
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
 *    (06-28's −1.72%, whatever fires on 07-14) has to reproduce;
 *  - the full STRUCTURAL shape: section ids/titles/order, row ids/kinds/labels/order,
 *    row counts, which rows carry `costBasisUsd`/`unrealizedPnlUsd` and which
 *    genuinely lack them (spec open question 3 — slice 5's per-row cost-basis
 *    rendering depends on the absences being real), `dataSafety`, schema version.
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
 *    signal, at a glance, that nothing in this file is a real position.
 *
 * ── THE NAV SERIES, AND WHY IT IS JITTERED ──────────────────────────────────────
 * Preserving every day-over-day NAV change EXACTLY would be mathematically the same
 * as publishing the real NAV series up to a single unknown factor — and issues
 * #146/#149 publish three real NAVs, so that factor is recoverable by division and
 * the whole 28-day series unscales. Composition, cost basis and P&L are SYNTHESIZED
 * HERE FROM INVENTED PARAMETERS rather than scaled, so recovering the factor recovers
 * nothing about them (a uniform scale of the whole payload — the cheap alternative —
 * would have handed all of it back). The NAV series was the last thing it still
 * bought, and {@link NAV_JITTER_PP} closes it: every day-over-day percent change
 * carries a deterministic offset of up to ±0.05 percentage points, so no division
 * recovers the real series.
 *
 * WHAT THE JITTER MUST NOT DO is move a verdict. `navMove` is a THRESHOLD test at
 * {@link NAV_MOVE_THRESHOLD_PCT}, and slice 4's replay asserts a measured 6 *yes* /
 * 22 *no* across the 28 anchors. The headroom is sufficient by construction — the
 * firing moves are −1.72%, +1.59% and +1.85%, the largest non-firing move is −1.42%,
 * and ±0.05pp cannot reach across either gap — but sufficiency is ASSERTED, not
 * trusted: {@link assertThresholdSideHolds} runs on every regeneration, has the real
 * series in hand, and throws rather than emit a fixture whose verdict history
 * differs from the fund's by one day.
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
  CompositionRow,
  DashboardFocus,
  DashboardSection,
} from "@numisma/engine";
import type { SnapshotAnchor } from "../projection/contract.ts";

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
 * trigger; it holds the number so it can PROVE the jitter never carries a move
 * across it.
 */
export const NAV_MOVE_THRESHOLD_PCT = 1.5;

/**
 * The fund name every synthetic anchor carries. Deliberately the same posture as the
 * sibling `composition-report.fixture.json`'s "Sanitized Exploratory Fund": a reader
 * who opens the file must not have to reason about whether it is real.
 */
export const SYNTHETIC_FUND_NAME = "Sanitized Exploratory Fund";

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
 */
function hashUnit(...parts: string[]): number {
  let hash = 0x811c9dc5;
  for (const part of parts.join(" ")) {
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
function synthesizeAnchor(anchor: SnapshotAnchor, nav: number): SnapshotAnchor {
  const { dashboard, totals, glance } = anchor.report;
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
    fundId: anchor.fundId,
    asOf,
    report: {
      totals: { ...totals, fundValueUsd: nav },
      dashboard: { summary, sections },
      // Copied, never recomputed: `feedGap` and `suppressed` ARE the triggers slice 4
      // replays, and they carry no magnitude to sanitize (D14 already forbids dates).
      glance: structuredClone(glance),
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
    out.push(synthesizeAnchor(anchor, nav));
  }
  return out;
}
