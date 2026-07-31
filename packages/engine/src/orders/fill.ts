/**
 * `S8` — THE FILL ACT: the pure half.
 *
 * When a rung fills, ONE act writes both halves of the truth:
 *
 *   - the `orderFilled` line into `orders.jsonl` — the claim left the book, and
 *   - the `PositionOpened` (first fill on the ladder) or `PositionAddedTo` (every fill
 *     after) with its funding leg into `events.jsonl` — the fund actually bought something.
 *
 * AN `orderFilled` LINE WITH NO LOT — OR A LOT WITH THE ORDER STILL RESTING — IS THIS
 * INCREMENT'S OWN SILENT-DRIFT HAZARD. The first understates encumbrance (available
 * reads HIGH, the direction that costs money); the second double-counts it. Neither may
 * exist, so the act must fail loud with NEITHER written rather than half-land.
 *
 * This module holds everything about that act which is a DECISION rather than a write:
 * the id convention that makes the two halves findable from each other, the torn-act
 * detector built on it, the ladder→Position resolution behind "one Position per ladder",
 * the funding tier read (never re-decided), and the builder that produces the two records
 * together so they cannot be authored apart. The writes themselves — and the sequencing
 * and rollback that make them one act — live in the TUI shell (ADR-001 bars IO here).
 *
 * NO ELEVENTH VERB. A fill is a `PositionOpened` or a `PositionAddedTo`; the verb count
 * stays TEN and `EVENT_SCHEMA_VERSION` stays `2`. `T9`'s prohibition on Close+Open as a
 * custody move is untouched and nothing here approaches it.
 */
import type {
  CapitalTier,
  Currency,
  Direction,
  ExecutionMode,
  Lot,
  PositionRecord,
} from "../contracts.js";
import type {
  PortfolioEvent,
  PositionAddedToEvent,
  PositionDecision,
  PositionOpenedEvent,
} from "../events/types.js";
import type { CommittedRung } from "./committed.js";
import type { OrderFilledRecord, OrderRecord } from "./records.js";

/**
 * The event id a fill act writes, derived from the rung and the fill's own stamp.
 *
 * THIS IS THE JOIN, AND IT COSTS NO FIELD ON EITHER RECORD. `orders.jsonl` is
 * append-only and the rung→lot join key was deliberately PARKED on a fills header nobody
 * has, so adding a column for it here would be designing that join blind. Deriving the
 * event id instead means the two files can each find the other's half of an act with
 * nothing stored — which is exactly what makes the residual crash window DETECTABLE (see
 * {@link reconcileFillActs}).
 *
 * `(orderId, observedAt)` is the right key because a rung may fill in several partials:
 * the order id alone would collide across them, and each partial is its own act.
 */
export function fillEventId(orderId: string, observedAt: string): string {
  return `fill:${orderId}@${observedAt}`;
}

const FILL_EVENT_ID = /^fill:(.+)@(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})$/;

/** Recover the rung and stamp from a fill event id, or `undefined` if it is not one. */
export function parseFillEventId(
  eventId: string,
): { orderId: string; observedAt: string } | undefined {
  const match = FILL_EVENT_ID.exec(eventId);
  if (!match) {
    return undefined;
  }
  const [, orderId, observedAt] = match;
  if (orderId === undefined || observedAt === undefined) {
    return undefined;
  }
  return { orderId, observedAt };
}

/** Half of a fill act found on disk without its other half. */
export interface TornFillAct {
  /** The log carries the lot but `orders.jsonl` never got its `orderFilled` line. */
  kind: "lot-without-fill" | "fill-without-lot";
  orderId: string;
  observedAt: string;
  eventId: string;
}

/**
 * THE TORN-ACT DETECTOR — the honest answer to "two files cannot be renamed atomically".
 *
 * The act writes the log first and the sidecar second, so a hard kill BETWEEN the two
 * renames leaves the lot on the log with the rung still resting. That window is real and
 * it is named rather than claimed away. What makes it survivable is that the resulting
 * state is DETECTABLE without either file storing anything extra: every act's two halves
 * share a derived id, so a mismatch between the sets is arithmetic.
 *
 * Run over (log, sidecar) this returns every act missing a half, in both directions. The
 * fill flow runs it BEFORE anything else and refuses to proceed while one is outstanding,
 * so a torn act can never be compounded by a second one landing on top of it.
 */
export function reconcileFillActs(
  events: readonly PortfolioEvent[],
  records: readonly OrderRecord[],
): TornFillAct[] {
  const fillsOnFile = new Set(
    records
      .filter((record): record is OrderFilledRecord => record.kind === "orderFilled")
      .map((record) => fillEventId(record.id, record.observedAt)),
  );
  const lotsOnLog = new Map<string, { orderId: string; observedAt: string }>();
  for (const event of events) {
    const parsed = parseFillEventId(event.id);
    if (parsed) {
      lotsOnLog.set(event.id, parsed);
    }
  }

  const torn: TornFillAct[] = [];
  for (const [eventId, { orderId, observedAt }] of lotsOnLog) {
    if (!fillsOnFile.has(eventId)) {
      torn.push({ kind: "lot-without-fill", orderId, observedAt, eventId });
    }
  }
  for (const eventId of fillsOnFile) {
    if (!lotsOnLog.has(eventId)) {
      const parsed = parseFillEventId(eventId);
      if (parsed) {
        torn.push({ kind: "fill-without-lot", ...parsed, eventId });
      }
    }
  }
  return torn;
}

/**
 * `T1`/`T7` — ONE POSITION PER LADDER, because "a Position is one decision".
 *
 * The first fill OPENS the ladder's Position; every fill after APPENDS a lot to that same
 * Position with its own funding leg. The distinction is therefore not a flag anyone sets
 * — it is whether the ladder's Position already exists, resolved here from the folded
 * book by the two facts the venue's own row supplies: which account the rung rests in and
 * which instrument it buys.
 *
 * AMBIGUITY IS REFUSED, NOT RESOLVED. Two open Positions on the same instrument in the
 * same account already contradict "one Position per ladder", and silently appending to
 * whichever sorted first would put the lot in the wrong decision — a wrong number in an
 * append-only log, correctable only by a compensating entry forever.
 */
export type LadderPosition =
  | { status: "none" }
  | { status: "one"; positionId: string }
  | { status: "ambiguous"; positionIds: string[] };

export function resolveLadderPosition(
  positions: readonly PositionRecord[],
  ladder: { accountId: string; instrumentId: string },
): LadderPosition {
  const matches = positions.filter(
    (position) =>
      position.accountId === ladder.accountId && position.instrumentId === ladder.instrumentId,
  );
  if (matches.length === 0) {
    return { status: "none" };
  }
  const [only] = matches;
  if (matches.length === 1 && only) {
    return { status: "one", positionId: only.id };
  }
  return { status: "ambiguous", positionIds: matches.map((position) => position.id) };
}

/**
 * WHICH TIER THE LOT IS BORN INTO — READ, NEVER RE-DECIDED (`T4`).
 *
 * The tier ordering was applied ONCE, at Transfer time, and `checkDebit` enforces it per
 * tier thereafter. So a fill does not get to pick: it reads the tier out of the funding
 * reserve's own attribution.
 *
 *   - `derived` — the reserve holds exactly one tier. There is nothing to decide.
 *   - `ambiguous` — the reserve holds several. Choosing here WOULD be re-deciding the
 *     ordering, so the caller must refuse rather than prompt.
 *   - `untiered` — the reserve carries no tier attribution at all, so there is no prior
 *     ordering to honor and none to violate. The caller may ask; it is naming a tier for
 *     the first time, not overriding one.
 */
export type FundingTier =
  | { status: "derived"; tier: CapitalTier }
  | { status: "ambiguous"; tiers: CapitalTier[] }
  | { status: "untiered" };

export function deriveFundingTier(reserve: { lots?: Lot[] }): FundingTier {
  const held = (reserve.lots ?? []).filter((lot) => lot.quantity > 0);
  if (held.length === 0) {
    return { status: "untiered" };
  }
  const tiers = [...new Set(held.map((lot) => lot.tier))];
  const [only] = tiers;
  if (tiers.length === 1 && only) {
    return { status: "derived", tier: only };
  }
  return { status: "ambiguous", tiers };
}

/** Everything the ladder's Position needs when this fill is the one that OPENS it. */
export interface OpenLadderTarget {
  mode: "open";
  position: {
    id: string;
    portfolioId: string;
    /**
     * AUTHORED, not observed. The venue has never heard of a Tempo, so no parse and no
     * default can supply this — `D6`'s "enrich interactively on import" is why the
     * interactive path is PERMANENT rather than scaffolding (`T6`).
     */
    tempo: string;
    executionMode: ExecutionMode;
    accountId: string;
    instrumentId: string;
    direction: Direction;
    currency: Currency;
  };
  /**
   * The FIVE authored decision fields. They are the reason the `orderFilled` line is
   * honest: a human is already in the loop at this moment, authoring a decision, so the
   * fill is not something the machine inferred and then recorded as fact.
   */
  decision: PositionDecision;
}

/** Every fill after the first: the lot joins the Position the ladder already opened. */
export interface AddLadderTarget {
  mode: "add";
  positionId: string;
}

export type LadderTarget = OpenLadderTarget | AddLadderTarget;

export interface FillActInput {
  /** The resting rung, from the ONE committed formula — never re-derived by a caller. */
  rung: CommittedRung;
  filledQuantity: number;
  /** Second-granular venue stamp of the FILL, in `observedAt`'s format. */
  observedAt: string;
  /** The cash actually debited by this fill. Also the lot's cost basis. */
  fundingAmount: number;
  tier: CapitalTier;
  target: LadderTarget;
}

/**
 * The two records of one act, built TOGETHER.
 *
 * Built by one function taking one input on purpose: a caller cannot author half an act,
 * cannot give the two halves disagreeing quantities, and cannot stamp them at different
 * moments. Everything shared between them — the quantity, the cash, the date — is
 * computed once here from one source.
 */
export interface FillAct {
  order: OrderFilledRecord;
  event: PositionOpenedEvent | PositionAddedToEvent;
}

/**
 * Build both halves of the fill act.
 *
 * The event's `asOf` is the DATE of `observedAt` and is not a separate parameter: the
 * envelope gates `asOf` to a bare `YYYY-MM-DD` (`events/parse.ts`) while the venue's
 * stamp is second-granular, and two independently-supplied stamps are two chances for the
 * log and the sidecar to disagree about when the same fill happened.
 *
 * The event's `id` is derived (`fillEventId`), which is what lets a later load find a
 * lot's missing `orderFilled` line or the reverse. Nothing here validates: the caller
 * runs `parseEvent` and `crossReferenceEvent` over the result BEFORE either write, so a
 * rejected fill costs nothing on disk.
 */
export function buildFillAct(input: FillActInput): FillAct {
  const { rung, filledQuantity, observedAt, fundingAmount, tier, target } = input;
  const asOf = observedAt.slice(0, 10);

  const order: OrderFilledRecord = {
    id: rung.orderId,
    observedAt,
    kind: "orderFilled",
    currency: rung.currency,
    filledQuantity,
  };

  // `PositionLot.cost` is PER UNIT (`weightedAverageCost` sums `quantity × cost`), so the
  // cash actually debited is divided down rather than carried across whole. Deriving it
  // from `fundingAmount` rather than from the rung's LIMIT price is what keeps the lot's
  // cost basis equal to the money that really left the reserve — a lot priced at the limit
  // while the cash leg said something else would put a fabricated P&L into the fold on
  // day one.
  const lot = { quantity: filledQuantity, cost: fundingAmount / filledQuantity, tier };
  const funding = { reserveId: rung.fundingReserveId, amount: fundingAmount };
  const id = fillEventId(rung.orderId, observedAt);

  const event: PositionOpenedEvent | PositionAddedToEvent =
    target.mode === "open"
      ? {
          id,
          asOf,
          type: "PositionOpened",
          position: { ...target.position, lots: [lot] },
          decision: target.decision,
          funding,
        }
      : { id, asOf, type: "PositionAddedTo", positionId: target.positionId, lot, funding };

  return { order, event };
}
