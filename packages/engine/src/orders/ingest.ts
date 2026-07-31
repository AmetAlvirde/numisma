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
import type { Currency } from "../contracts.js";
import { committedByReserve, isNegativeSlack } from "./committed.js";
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
    fundingReserveId: attribution.overrides?.[order.id] ?? attribution.fundingReserveId,
  }));
}

/** A reserve's balance as the fold reports it — the value half, untouched by any order. */
export interface ReserveBalance {
  id: string;
  amount: number;
}

/** One reserve that cannot fund what has been attributed to it. */
export interface FundingShortfall {
  fundingReserveId: string;
  balance: number;
  committed: number;
  /** `balance − committed`. Negative here by construction: the impossible state. */
  slack: number;
}

export type FundingCoverage =
  | { status: "ok" }
  | { status: "over-committed"; shortfalls: FundingShortfall[] }
  | { status: "unknown-reserve"; fundingReserveIds: string[] };

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
 * Committed comes from the SHARED formula in `./committed.ts` — the same call the
 * rendered available-capital report makes. This guard and that report must never be
 * able to disagree about how much of a reserve is encumbered: a rendered `available`
 * that contradicted the check which ACCEPTED the orders would be worse than the fund's
 * present honest silence. Only BUY claims encumber a cash reserve, and that rule lives
 * there too rather than being restated here.
 */
export function checkFundingCoverage(
  resting: readonly RestingOrder[],
  balances: readonly ReserveBalance[],
): FundingCoverage {
  const balanceById = new Map(balances.map((balance) => [balance.id, balance.amount]));

  const committedById = committedByReserve(resting);

  const unknown = [...committedById.keys()].filter((id) => !balanceById.has(id));
  if (unknown.length > 0) {
    // An unknown reserve is refused rather than read as a zero balance: a typo'd id
    // would otherwise render as "everything is over-committed" or, worse, silently
    // attribute the ladder to a reserve nobody can see.
    return { status: "unknown-reserve", fundingReserveIds: unknown };
  }

  const shortfalls: FundingShortfall[] = [];
  for (const [fundingReserveId, committed] of committedById) {
    const balance = balanceById.get(fundingReserveId) ?? 0;
    const slack = balance - committed;
    if (isNegativeSlack(slack)) {
      shortfalls.push({ fundingReserveId, balance, committed, slack });
    }
  }

  return shortfalls.length > 0 ? { status: "over-committed", shortfalls } : { status: "ok" };
}
