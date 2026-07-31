/**
 * The VENUE-NEUTRAL half of order ingest: synthesized identity, the one declared field,
 * and the funding-coverage check `O1` rejects on.
 *
 * PURE (ADR-001). Nothing here reads a file or prompts anyone — a venue parser hands it
 * observed rows, the IO shell in the TUI hands it the operator's declaration, and it
 * hands back records the sidecar writer can append.
 *
 * The split from `./bitget.js` is the seam between "what this venue's rendered table
 * happens to look like" and "what an observed open order IS". A second venue owes a
 * second parser and nothing here.
 */
import type { Currency, FundReviewData } from "../contracts.js";
import { attributeRungs } from "./attribution.js";
import { isNegativeSlack, type CommittedRung } from "./committed.js";
import type { OrderPlacedRecord, OrderSide } from "./records.js";
import type { RestingOrder } from "./select.js";

/**
 * The observed half of one open order, after a venue parser has normalized it. The
 * DECLARED half (`fundingReserveId`) is deliberately absent: the venue has never heard
 * of a Reserve, and this type is exactly what the venue can tell us.
 */
export interface ObservedOpenOrder {
  /** Synthesized by `synthesizeOrderId` — the venue's export carries no order id. */
  id: string;
  observedAt: string;
  currency: Currency;
  symbol: string;
  side: OrderSide;
  price: number;
  quantity: number;
  /**
   * The venue's CUMULATIVE filled quantity for this row, `0` or absent when untouched. A
   * venue that does not report one may omit it; a venue that does must not have it
   * dropped, which is exactly what #173 was.
   */
  filledQuantity?: number;
}

/**
 * The components identity is synthesized FROM: venue, pair, side, price, submitted-at.
 *
 * `price` is a STRING and that is the load-bearing detail. The venue renders the same
 * rung as `1000`, `1000.00` or `"1,000.00"` on different days, and an id built from a
 * re-formatted number would make the same resting rung a NEW order on the next import —
 * which is precisely the duplicate the deterministic-id requirement exists to prevent.
 * The caller passes the CANONICAL decimal string (see `canonicalDecimal`), derived by
 * text, so no float ever round-trips through the id.
 */
export interface OrderIdentity {
  venue: string;
  symbol: string;
  side: OrderSide;
  price: string;
  observedAt: string;
}

/**
 * Canonicalize a rendered numeric token to a single decimal spelling, by TEXT.
 *
 * `1000`, `1000.00`, `1,000.00`, ` +1000 ` and `01000` all canonicalize to `1000`;
 * anything that is not a plain decimal returns `undefined`. Doing this textually rather
 * than through `Number(...).toString()` keeps the id exact for sizes the venue quotes
 * well past float's comfortable range, and keeps a rounding change in the runtime from
 * silently re-identifying every resting order in the file.
 */
export function canonicalDecimal(token: string): string | undefined {
  const cleaned = token.trim().replace(/[\s,]/g, "").replace(/^\+/, "");
  if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(cleaned)) {
    return undefined;
  }
  const negative = cleaned.startsWith("-");
  const magnitude = negative ? cleaned.slice(1) : cleaned;
  const [rawWhole = "", rawFraction = ""] = magnitude.split(".");
  const whole = rawWhole.replace(/^0+(?=\d)/, "") || "0";
  const fraction = rawFraction.replace(/0+$/, "");
  const body = fraction ? `${whole}.${fraction}` : whole;
  return negative && body !== "0" ? `-${body}` : body;
}

/**
 * The deterministic order id. Readable rather than hashed, on purpose: an operator
 * eyeballing `orders.jsonl` against the venue can see WHICH rung a line is, and the
 * substantiation the rung list owes is legible in the file itself.
 *
 * A re-priced rung needs no rule and gets no branch: `price` is INSIDE the id, so a
 * re-price yields a different id — the old one stops being observed and the new one
 * appears. Cancel-and-place, structurally.
 */
export function synthesizeOrderId(identity: OrderIdentity): string {
  return [
    identity.venue,
    identity.symbol,
    identity.side,
    identity.price,
    identity.observedAt,
  ].join(":");
}

/**
 * The operator's declaration for one import batch: ONE field, prompted once.
 *
 * A ladder is homogeneous by construction, so eight rungs is one decision copied eight
 * times — and eight chances to disagree with yourself. `overrides` is the escape hatch
 * for the rung that genuinely disagrees, keyed by the synthesized id.
 */
export interface OrderAttribution {
  fundingReserveId: string;
  overrides?: Record<string, string>;
}

/**
 * Join the observed half to the declared one.
 *
 * Deliberately NOT recorded: a target `positionId` (the Position cannot exist until its
 * first fill, so naming one here would be the repo's first unresolvable id) and a
 * ladder/batch id (that join is parked on a fills header nobody has, and designing a key
 * for it blind, into an append-only file, is the more expensive mistake).
 *
 * The venue's `filled_quantity` IS carried, onto the placement line's
 * `observedFilledQuantity` and only when it is positive — #173. It used to be parsed,
 * validated and then dropped here, which made every imported rung rest at its full
 * quantity forever and put `CommittedRung.remainingQuantity` beyond the reach of its own
 * definition. The mechanism (a field, never a synthesized `orderFilled` line) is argued in
 * full on the field itself in `./records.ts`.
 */
export function buildOrderPlacedRecords(
  orders: readonly ObservedOpenOrder[],
  attribution: OrderAttribution,
): OrderPlacedRecord[] {
  return orders.map((order) => ({
    id: order.id,
    observedAt: order.observedAt,
    kind: "orderPlaced" as const,
    currency: order.currency,
    symbol: order.symbol,
    side: order.side,
    price: order.price,
    quantity: order.quantity,
    // Omitted rather than written as `0`, so an untouched rung serializes to exactly the
    // bytes it always did and no existing line in the append-only file is re-shaped.
    ...(order.filledQuantity !== undefined && order.filledQuantity > 0
      ? { observedFilledQuantity: order.filledQuantity }
      : {}),
    fundingReserveId: attribution.overrides?.[order.id] ?? attribution.fundingReserveId,
  }));
}

/**
 * `ReserveBalance` USED TO LIVE HERE — `{ id, amount }`, built by the caller. It is gone
 * on purpose (#172). It carried no currency, so this guard summed a quote-denominated
 * `committed` into a native balance; and because the CALLER built it, the import CLI
 * handed over `data.reserves` straight off the fold, including reserves the report
 * refuses to place. The successor is `FundableReserve` in `./attribution.js`, which
 * carries `currency` and which only `fundableReserves(data)` can produce. This guard
 * takes the FUND now, so there is no list left to hand it wrongly.
 */

/** One reserve that cannot fund what has been attributed to it. */
export interface FundingShortfall {
  fundingReserveId: string;
  balance: number;
  committed: number;
  /** `balance − committed`. Negative here by construction: the impossible state. */
  slack: number;
}

/**
 * The two REFUSAL arms are, deliberately, the two `UnmatchedReason`s the report already
 * uses — same names, same meanings. A rung the report would list as `unknown-reserve`
 * refuses the import as `unknown-reserve`; likewise `currency-mismatch`. The parity is
 * legible in the type rather than asserted in prose.
 */
export type FundingCoverage =
  | { status: "ok" }
  | { status: "over-committed"; shortfalls: FundingShortfall[] }
  | { status: "unknown-reserve"; fundingReserveIds: string[] }
  | { status: "currency-mismatch"; rungs: CommittedRung[] };

/**
 * `O1` — no order may encumber a reserve that cannot fund it.
 *
 * The invariant is `slack = reserve.amount − committed ≥ 0`, and the direction carries
 * the meaning: `slack < 0` is an IMPOSSIBLE state, not a warning. The venue would not
 * have accepted orders the account could not fund, so a negative slack means the
 * ATTRIBUTION is wrong — and writing it would put a wrong claim into an append-only
 * file, where correcting it costs a compensating line forever.
 *
 * The caller passes the orders STILL RESTING (`pickRestingOrdersAsOf` over the sidecar's
 * existing records plus the incoming batch), so the check covers the whole book against
 * the reserve rather than one import's slice of it, and a partially-filled rung
 * encumbers only its remainder. Re-importing an unchanged export changes nothing here:
 * the ids are deterministic, so the selector counts each rung once.
 *
 * Committed comes from the SHARED formula in `./committed.ts`, and its ARGUMENTS — which
 * reserves may fund anything, and which rung belongs to which — from the SHARED
 * attribution in `./attribution.js`. Both are the same calls the rendered
 * available-capital report makes. Sharing only the formula was not enough and is the
 * defect this signature exists to close (#172): the guard took a reserve list from its
 * CALLER, and the caller handed it reserves the report refuses to place, plus no
 * currency to check against. It takes the FUND now. There is no list to get wrong.
 *
 * A rendered `available` that contradicted the check which ACCEPTED the orders would be
 * worse than the fund's present honest silence. Only BUY claims encumber a cash reserve,
 * and that rule lives in `./committed.ts` rather than being restated here.
 */
export function checkFundingCoverage(
  resting: readonly RestingOrder[],
  data: FundReviewData,
): FundingCoverage {
  const { reserves, rungsByReserve, unmatched } = attributeRungs(data, resting);

  // Refuse before summing anything. An unplaceable rung has no honest balance to be
  // compared against — reading it as a zero balance would render the ladder as
  // "over-committed" on a typo, and summing it into a foreign-denominated balance would
  // produce the confidently wrong slack that #172 was about.
  const unknown = unmatched.filter((entry) => entry.reason === "unknown-reserve");
  if (unknown.length > 0) {
    return {
      status: "unknown-reserve",
      fundingReserveIds: [...new Set(unknown.map((entry) => entry.rung.fundingReserveId))],
    };
  }
  const mismatched = unmatched.filter((entry) => entry.reason === "currency-mismatch");
  if (mismatched.length > 0) {
    return { status: "currency-mismatch", rungs: mismatched.map((entry) => entry.rung) };
  }

  const balanceById = new Map(reserves.map((reserve) => [reserve.reserveId, reserve.balance]));
  const shortfalls: FundingShortfall[] = [];
  for (const [fundingReserveId, rungs] of rungsByReserve) {
    // Summed from the same rung rows the report lists, so the figure in the refusal
    // message and the figure the operator reads afterwards are one arithmetic.
    const committed = rungs.reduce((total, rung) => total + rung.committed, 0);
    const balance = balanceById.get(fundingReserveId) ?? 0;
    const slack = balance - committed;
    if (isNegativeSlack(slack)) {
      shortfalls.push({ fundingReserveId, balance, committed, slack });
    }
  }

  return shortfalls.length > 0 ? { status: "over-committed", shortfalls } : { status: "ok" };
}
