import type { DcaPositionView } from "./dca-card";
import type { FillPathRungView, MeasuredFigure } from "./price-drop-path-chart";

/**
 * ── THE FILL PATH'S VIEW CONTRACT, DECLARED HERE (spec #439 §4.1, S6) ────────────────
 *
 * `apps/web/src/ladder/fill-path-view.ts` keeps every line of `composeFillPathPage` and
 * imports these types back from `@numisma/components`. The consumer defines the
 * interface, which is the standard direction and also the only one that lets a cosmos
 * fixture build a `FillPathView` literal without importing `apps/web` — the crossing
 * `seam-isolation.test.ts` forbids.
 *
 * NOTHING HERE DECIDES ANYTHING. Every flag, count, coordinate and absence cause below
 * arrives already decided from the composer. What the package owns is the SHAPE, and the
 * shape is what a fixture can be authored against.
 */

/**
 * WHAT THE DECLARED LADDER WOULD ACQUIRE IF IT WERE WALKED — an INTENTION, and a
 * separate type from `MeasuredFigure` for exactly that reason.
 *
 * `MeasuredFigure` means "a figure that was measured, or the named reason it was not",
 * and its whole job is that no projection can ever stand where a measurement belongs. An
 * expectation is a third thing: nothing was measured and nothing failed to be measured,
 * because there was nothing to measure yet. Giving it its own type is what stops a
 * refactor from quietly passing these numbers to `<Figure>` and printing a projection
 * under the label `Deployed`. The word "Expected" in the UI copy is the operator-facing
 * half of that guarantee; this type is the half that survives the next edit.
 *
 * BOTH NUMBERS ARE DERIVED FROM RUNGS THE OPERATOR DECLARED, and from nothing else. No
 * order, no lot and no venue reading is involved.
 */
export interface ExpectedFigures {
  /** Σ over declared rungs of `sizeUsd / priceUsd` — units, if every rung filled. */
  units: number;
  /**
   * Total declared USD ÷ expected units.
   *
   * THIS IS A SIZE-WEIGHTED HARMONIC MEAN OF THE RUNG PRICES, NOT THE ARITHMETIC MEAN.
   * A DCA ladder is convex — the lower rungs commit more capital and buy more units per
   * dollar — so averaging the prices would overstate the entry the ladder is aiming at,
   * by more the more convex the operator made it. It is derived from the two totals here
   * precisely so no caller is tempted to average prices instead.
   */
  avgEntryUsd: number;
}

/** Whether a torn act was found, cleared, or never looked for. */
export type TornActReading =
  | { status: "outstanding"; count: number }
  | { status: "clear" }
  | { status: "unchecked" };

export interface ChartCircle {
  key: string;
  cx: number;
  cy: number;
  filled: boolean;
  next: boolean;
}

/**
 * Hand-rolled SVG geometry, and a type narrower than it looks.
 *
 * The picture is drawn by `PriceDropPathChart` off `price-drop-path.ts` (ADR-018), and
 * the only field with a live consumer is `nowX`, read as a message chain to answer "is
 * spot live". Finishing that demolition — and promoting `spotIsLive` to a named boolean
 * so the chain goes away — is **slice 3 of spec #285**, which owns this code.
 */
export interface ChartGeometry {
  width: number;
  height: number;
  /** `"x,y x,y …"`, ready for a `<polyline points>`. */
  points: string;
  circles: readonly ChartCircle[];
  /** x of the "now" line. Absent unless spot is LIVE — a last close is not now. */
  nowX?: number;
}

/**
 * WHICH OF THREE THINGS IS TRUE about the waiting capital, decided by the composer
 * rather than in JSX. `nothing-waiting` is a fully walked ladder; `all-resting` is every
 * waiting dollar encumbered at the venue; `partly-unplaced` is the split that makes
 * hidden encumbrance visible. Two arms cannot say this: an `else` on `neverPlacedUsd > 0`
 * prints "all of it is resting at the venue" for a ladder with nothing resting at all.
 */
export type WaitingSplit =
  | "nothing-waiting"
  | "all-resting"
  | "partly-unplaced";

export interface FillPathFigures {
  waitingDeclaredUsd: number;
  waitingRestingUsd: number;
  /**
   * Declared but NEVER PLACED — the whole of what the two waiting totals disagree
   * about. See `fill-path-view.ts`'s header for why it is not an unfilled-vs-open split.
   */
  neverPlacedUsd: number;
  split: WaitingSplit;
}

/** The whole page, decided. */
export interface FillPathView {
  planId: string;
  positionId: string;
  /** What the header calls this ladder. NEVER the plan id — a UUID is a join key. */
  title: string;
  /**
   * `DcaPositionRow["state"]`, READ BY NAME FROM THE ONE PLACE THIS PACKAGE SPELLS IT
   * (spec #439 §4.1). `dca-card.tsx` wrote the union out when `DcaPositionView` crossed;
   * a second copy here would be two spellings of one fact, drifting silently in exactly
   * the direction the type direction was chosen to close. `composeFillPathPage` assigning
   * `row.state` into this field is the compile-time pin that catches a fifth state, and
   * it only works against ONE name.
   */
  state: DcaPositionView["state"];
  /** Whether a reconciliation ran for this row at all — absence rule 2. */
  reconciled: boolean;
  deployed: MeasuredFigure;
  unitsAcquired: MeasuredFigure;
  avgEntry: MeasuredFigure;
  /**
   * DAY ZERO — a reconciliation RAN and found nothing filled. See `hasNotStarted`.
   *
   * This is NOT the same question as "are the three measured figures absent", even
   * though today the answer coincides: `figures` absent (absence rule 2) also leaves
   * all three absent, and that ladder has NOT been established as unstarted — it was
   * never checked. `false` here therefore covers both "something has filled" and "we
   * could not tell", which are different facts and stay different downstream.
   */
  notStarted: boolean;
  /**
   * The declared ladder's own projection — present ONLY on a `notStarted` ladder that
   * declares enough to project from (see `expectedFigures`). Absent everywhere else,
   * including on any ladder that has started: once a real fill exists, the measured
   * figures are the answer and an expectation beside them would compete with it.
   */
  expected?: ExpectedFigures;
  /**
   * ABSENT WHEN NO RECONCILIATION RAN — absence rule 2, held all the way to the render.
   * These two totals are present at zero (zero waiting capital is a real answer) but
   * only when there was something to measure them from; reading an absent `figures` as
   * `0` would print a capital figure and an all-clear off a row that could not check.
   */
  figures?: FillPathFigures;
  rungs: readonly FillPathRungView[];
  /**
   * Recorded lots no declared rung explains. Absent-at-zero ON THE WIRE (rule 5) — but
   * absent HERE means the same thing `figures` absent means, because rule 5's
   * unambiguity comes entirely from `figures` sitting beside it saying a reconciliation
   * ran. Without that neighbour, `0` would state "none unexplained" from an absence.
   */
  orphanLots?: number;
  tornActs: TornActReading;
  /** The two unrecorded-fill warnings, counted APART: their certainties differ. */
  warnings: { filledNotRecorded: number; pricePassedNoFill: number };
  /** How far down the ladder the walk has got. Present whenever a reconciliation ran. */
  progress?: { filledRungs: number; totalRungs: number; percent: number };
  chart?: ChartGeometry;
  /** The chart's accessible substitute. Absent when the ladder carries no shape. */
  caption?: string;
  /** The price the page is decorated with — live, or the last close it fell back to. */
  spotUsd?: number;
  /** True when the fetch failed. Every spot-independent fact still renders. */
  spotUnavailable: boolean;
  spotLoading: boolean;
  /**
   * THE BOUNDARY OF WHAT THIS ROW COULD HAVE KNOWN — the anchor's own `asOf`, passed
   * through verbatim. Not a clock, not a wire date (the `dca` branch carries none, and
   * three invariants depend on it staying that way), not a fill timestamp.
   */
  recordedThrough: string;
}
