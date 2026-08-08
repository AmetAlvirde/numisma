/**
 * The VENUE-NEUTRAL half of order ingest: synthesized identity, the one declared field,
 * and the re-ingest diff/merge over previously-claimed rungs. The `O1` funding-coverage
 * guard those records are then weighed by lives in `./coverage.ts` — it changes with
 * reserve-admission policy rather than with the venue's row shape, and it is the only
 * half that reaches into the fold.
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
import { QUANTITY_EPSILON } from "./monotonicity.js";
// The DESCRIPTOR GATES, shared with `parseOrderRecord` so the write gate and the read gate
// are one rule rather than two copies that can drift (#205).
import { isDescriptorText, isTriggerPrice } from "./records.js";
import type { OrderPlacedRecord, OrderRecord, OrderSide } from "./records.js";

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
  /**
   * THE PLACEMENT DESCRIPTORS (#205) — how the venue says the rung was placed, as opposed
   * to what it claims. All three are OPTIONAL here and optional on the record, and the
   * optionality carries the meaning: a venue that does not report one omits it, and an
   * omission says *"we never recorded this"* — never *"the order had no time-in-force"*.
   *
   * They are declared on the VENUE-NEUTRAL type rather than only on `BitgetOpenOrder`
   * because the record they feed is venue-neutral: without them here the values were
   * present at runtime and unreachable through {@link buildOrderPlacedRecords}' declared
   * parameter type. Narrowing that parameter to the Bitget row instead would have pulled
   * "what this venue's rendered table looks like" back across the seam this module's
   * header draws.
   *
   * NONE OF THEM MOVES THE ENCUMBRANCE, which is `price * quantity`. That is why a
   * difference in one is refused with its own wording rather than with the amendment
   * refusal's cancel-the-rung remedy — see `partitionChangedClaims` in the TUI.
   */
  orderType?: string;
  timeInForce?: string;
  /**
   * `null` is the venue POSITIVELY rendering "there is no trigger on this rung" (Bitget
   * draws it `-- / --`); `undefined` is this build never having been told. Both omit the
   * field from the record, because the record has no honest spelling for either and a
   * written `null` would be a third state every later reader would have to interpret.
   */
  triggerPrice?: number | null;
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
 *
 * A COMMA IS A GROUP SEPARATOR OR IT IS NOTHING (#177). Every comma used to be stripped
 * before the shape test ran, so `10,50` — a decimal comma, which is how half the world
 * writes ten and a half — canonicalized to `1050`: a silent 100x error, and one baked
 * permanently into a synthesized order id and into the committed sum computed from it.
 * The grouping must be VALID (first group 1-3 digits, every later group exactly 3, no
 * comma anywhere after the decimal point) or the token is refused, and the row carrying
 * it is skipped and reported. Guessing which spelling the operator meant is exactly the
 * guess an append-only file cannot afford.
 */
const THOUSANDS_GROUPED = /^\d{1,3}(,\d{3})+$/;

export function canonicalDecimal(token: string): string | undefined {
  const signed = token.trim().replace(/\s/g, "").replace(/^\+/, "");
  const isNegative = signed.startsWith("-");
  const unsigned = isNegative ? signed.slice(1) : signed;
  const [rawWholePart = "", rawFractionPart = "", ...surplus] = unsigned.split(".");
  if (surplus.length > 0 || rawFractionPart.includes(",")) {
    return undefined;
  }
  let wholePart = rawWholePart;
  if (wholePart.includes(",")) {
    if (!THOUSANDS_GROUPED.test(wholePart)) {
      return undefined;
    }
    wholePart = wholePart.replace(/,/g, "");
  }
  const cleaned =
    (isNegative ? "-" : "") +
    wholePart +
    (unsigned.includes(".") ? `.${rawFractionPart}` : "");
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
 * Two or more rows of ONE batch that the venue rendered under the same synthesized id,
 * summed into one claim. Reported so the operator sees the arithmetic that was applied.
 */
export interface MergedOrderClaim {
  id: string;
  price: number;
  observedAt: string;
  symbol: string;
  side: OrderSide;
  /** Every row's quantity, in the order the export rendered them. */
  quantities: number[];
  /** Their sum — what the single surviving claim encumbers. */
  mergedQuantity: number;
}

/**
 * Collapse rows of ONE batch that collide on the synthesized id into one claim each,
 * SUMMING their sizes (#174).
 *
 * The export has no total discriminator: a venue-split order's children share every
 * parsed field, so identity by content cannot be made total by widening the id (adding
 * `quantity` would be worse than useless — a claim rests until something explicitly
 * retires it, so the second sighting of a re-sized rung would become a second claim
 * resting forever). What IS certain is the arithmetic: two claims at the same price
 * against the same reserve encumber their SUM. Summing is therefore the only reading
 * that is not a guess — dropping one row would silently free capital that is committed,
 * and appending two lines under one id would leave the second unreachable to
 * `pickRestingOrdersAsOf`, which ignores a repeat placement of a known id by design.
 *
 * The merge is RETURNED, never whispered: the caller owes the operator a first-class
 * line naming both sizes and the total, because the remedy — re-place one rung a tick
 * apart so the two get distinct prices — is the operator's to apply, not ours.
 */
export function mergeCollidingClaims<T extends ObservedOpenOrder>(
  orders: readonly T[],
): { orders: T[]; merges: MergedOrderClaim[] } {
  const byId = new Map<string, { order: T; quantities: number[] }>();
  for (const order of orders) {
    const seen = byId.get(order.id);
    if (seen === undefined) {
      byId.set(order.id, { order, quantities: [order.quantity] });
      continue;
    }
    seen.quantities.push(order.quantity);
    seen.order = {
      ...seen.order,
      quantity: seen.order.quantity + order.quantity,
      // The venue's cumulative fill for each child is a fill of the merged claim too, so
      // the remainder the merged rung rests for stays honest.
      ...(seen.order.filledQuantity !== undefined || order.filledQuantity !== undefined
        ? { filledQuantity: (seen.order.filledQuantity ?? 0) + (order.filledQuantity ?? 0) }
        : {}),
    };
  }

  const merges: MergedOrderClaim[] = [];
  for (const { order, quantities } of byId.values()) {
    if (quantities.length > 1) {
      merges.push({
        id: order.id,
        price: order.price,
        observedAt: order.observedAt,
        symbol: order.symbol,
        side: order.side,
        quantities,
        mergedQuantity: order.quantity,
      });
    }
  }

  return { orders: [...byId.values()].map((entry) => entry.order), merges };
}

/**
 * The fields a difference may be reported over that carry a NUMBER on both sides.
 *
 * `triggerPrice` is here and not with the string descriptors because it is a price: the
 * refusal detail renders it as a figure, and a comparison over its rendered spelling
 * would make `1100` and `1100.00` a difference.
 */
export type NumericClaimField = "quantity" | "observedFilledQuantity" | "triggerPrice";

/** The descriptor fields that carry a STRING on both sides. */
export type TextClaimField = "orderType" | "timeInForce";

/**
 * One field of a known claim that the venue is now rendering differently.
 *
 * A DISCRIMINATED UNION OVER `field`, not one interface with `known: string | number`
 * (#205). Two of the placement descriptors are strings, and widening the single shape
 * would have made `fill.known` a `string | number` at every site that reads it
 * numerically — `partitionChangedClaims` compares it against a remainder — so the
 * comparison would have needed a cast or a non-null assertion to stay compilable, which
 * is precisely the check being given up. Narrowing by `field` keeps it a `number` at the
 * type level with no cast at all.
 *
 * BOTH MEMBERS RENDER THE SAME WAY: `` `${field} ${known} → ${observed}` `` is well-typed
 * over the union, so the refusal detail template is shared rather than branched.
 */
export interface NumericClaimDifference {
  field: NumericClaimField;
  /**
   * WHAT THE FILE SAYS, on each field's own basis (#181): for `quantity`, the FIRST
   * placement line's size; for `observedFilledQuantity`, the LATEST OBSERVATION — a later
   * `orderFillObserved` when the file carries one, else the placement line's own figure,
   * else `0`. Not "the placement line's figure", which is what this was while placements
   * were the only observation on the file. For `triggerPrice`, the placement line's own
   * value, which is the only line that carries one.
   */
  known: number;
  observed: number;
}

export interface TextClaimDifference {
  field: TextClaimField;
  known: string;
  observed: string;
}

export type ClaimDifference = NumericClaimDifference | TextClaimDifference;

/**
 * The three placement descriptors, as a runtime value derived from the union above: a
 * field added to {@link TextClaimField} with no entry here fails `pnpm typecheck`, and so
 * does an entry here that is not one of the descriptor fields.
 */
const DESCRIPTOR_FIELDS: Record<TextClaimField | "triggerPrice", true> = {
  orderType: true,
  timeInForce: true,
  triggerPrice: true,
};

/**
 * Is this difference about HOW the rung was placed rather than about WHAT it claims?
 *
 * Lives here, beside the union it reads, so the boundary that routes a difference to a
 * refusal class cannot drift from the field list — the same reason `leavesRungUnweighed`
 * sits beside `BitgetRowProblem` rather than at its consumer.
 */
export function isDescriptorDifference(difference: ClaimDifference): boolean {
  return difference.field in DESCRIPTOR_FIELDS;
}

/**
 * The restatement difference, as a TYPE PREDICATE.
 *
 * It exists because `Array.prototype.find` cannot narrow a union on its own, and the one
 * caller — `partitionChangedClaims` at the import boundary — reads `known` NUMERICALLY
 * against a remainder. A bare `find` there would hand back a `ClaimDifference` whose
 * `known` is `string | number`, and the shortest way past that is a cast or a `!`, which
 * is exactly the check the discriminated union was chosen to keep. Narrowing here states
 * the relation between the field and its value shape once, beside the union.
 */
export function isFilledDifference(
  difference: ClaimDifference,
): difference is NumericClaimDifference {
  return difference.field === "observedFilledQuantity";
}

/** A row that names a claim already on file, but does NOT say the same thing about it. */
export interface ChangedClaim {
  id: string;
  differences: ClaimDifference[];
}

/**
 * Rows of this batch that name a claim already on file while DIFFERING from it (#174).
 *
 * `alreadyKnown` means byte-identical in the fields that matter — the id components plus
 * the size and the observed partial. Anything else is a CHANGE to a known claim, and a
 * change is not a re-sighting: folding it into `alreadyKnown` reported "nothing to do"
 * about a rung whose size on file is now wrong, which is exactly the silence #174 names.
 *
 * THE INPUT IS THE WHOLE RECORD STREAM, NOT THE PLACEMENT LINES (#181). This took only
 * `orderPlaced` records while placements were the only thing on the file, and compared the
 * export against the PLACEMENT LINE's own figure. With `orderFillObserved` lines on the
 * file the placement line is merely the FIRST observation, so that basis re-reports every
 * already-recorded restatement forever — the import would say "the venue restated this"
 * about a restatement the file already carries, on every import, permanently. IDEMPOTENCY
 * LIVES HERE, one layer above the append filter: no key shape at the write can repair a
 * comparison that reports a difference where there is none, because the report is written
 * from the decision, not from the line.
 *
 * THE COMPARISON BASIS is therefore the fold's own unification applied to the comparison:
 *
 *     latest observation ?? the placement line's own observed figure ?? 0
 *
 * — the same three-way reading `pickRestingOrdersAsOf` folds into one `consumed` baseline.
 * `quantity` keeps its own basis: the FIRST placement line, because a repeat placement is
 * ignored by the selector and an observation carries no `quantity` at all (deliberately —
 * see `OrderFillObservedRecord`; a second copy of the one figure nothing may go
 * stale on is the drift the batch refusal exists to prevent).
 *
 * AN EXPORT FIGURE ABOVE THE PLACED QUANTITY GETS NO CHECK HERE, AND THAT IS THE DECISION
 * — see the partition rule in `apps/tui/src/import-orders-changed-claims.ts`, which
 * states why it cannot arrive and names both gates that make it so.
 *
 * TIES ON EQUAL STAMPS RESOLVE TO THE LAST LINE IN FILE ORDER — `>=` on the scan below,
 * over the records in the order the caller holds them. That is exactly the tie-break the
 * selector's STABLE sort gives the fold, so detection and the fold can never disagree
 * about which observation is current. Choosing `>` here would be a second, silently
 * different rule for the same question.
 *
 * THE EPSILON IS ON THE FILLED COMPARISON ONLY, and `quantity` keeps EXACT equality. Exact
 * inequality was harmless while a difference meant a SKIP; once a difference means a
 * permanent line on an append-only file, float noise below the meaningful floor would grow
 * the file on an import that observed nothing real. `quantity` is not compared to a folded
 * figure — it is one authored number against another — so there is nothing for a floor to
 * absorb there, and an exact test is the stricter and more honest one.
 *
 * THE PLACEMENT DESCRIPTORS ARE PERSISTED AND ARE COMPARED HERE (#205). `orderType`,
 * `timeInForce` and `triggerPrice` are optional fields on `OrderPlacedRecord` and members
 * of `KEY_ORDER.orderPlaced`, and a difference in one is reported like any other.
 *
 * THEY ARE COMPARED ONLY WHEN BOTH SIDES CARRY THEM, and that is a NEW convention this
 * file now holds two of — the contrast with `observedFilledQuantity` directly below is the
 * point, not an inconsistency to be tidied away. A fill figure COALESCES (`?? 0`) and so an
 * absent one DOES raise a difference, because zero is a real claim about the venue:
 * "nothing filled" is something the export can say. A descriptor has no meaningful empty
 * value, so an absent one can only mean *we never recorded this* — never *the order had no
 * time-in-force* — and coalescing it to `""` would report a difference on every line
 * written before this widening, refusing an UNCHANGED batch on every rung until a
 * migration rewrote an append-only file. Compare-when-present is what makes the widening
 * cost no migration at all: every existing line simply has nothing to compare.
 *
 * KNOWN LIMIT, in the place its predecessor stood so the next reader finds a true
 * statement where a false one used to be: a rung whose descriptor is ABSENT on file and
 * PRESENT in the export raises no difference, so a rung that later GAINS a trigger price
 * cannot be detected. That is the same gap every pre-widening line already had rather than
 * a new hole, and it closes for a rung the moment a placement line carrying the descriptor
 * exists — which is every rung imported from here on. A `triggerPrice` the venue renders
 * as its blank sentinel is `null` on the observed row and is likewise not compared: `null`
 * is the venue saying there is no trigger, and there is no honest figure to render as the
 * `observed` side of a difference.
 *
 * Accepted for the same reason the gap was acceptable before: no descriptor moves the
 * encumbrance, which is `price * quantity`, so the funding guard stays correct across
 * such a change. That is also why a descriptor difference does NOT refuse as an
 * amendment — see `partitionChangedClaims` in
 * `apps/tui/src/import-orders-changed-claims.ts`, which routes it to its own class with
 * its own wording.
 */
export function detectChangedClaims(
  known: readonly OrderRecord[],
  observed: readonly ObservedOpenOrder[],
): ChangedClaim[] {
  const placedById = new Map<string, OrderPlacedRecord>();
  // The latest observation per id, and the stamp it was made at — the stamp is kept only
  // to compare the NEXT candidate against, never returned.
  const latestObserved = new Map<string, { observedAt: string; quantity: number }>();
  for (const record of known) {
    if (record.kind === "orderPlaced") {
      // FIRST placement wins, matching `pickRestingOrdersAsOf`: a repeat placement line is
      // ignored there, so it must not be what a change is measured against here.
      if (!placedById.has(record.id)) {
        placedById.set(record.id, record);
      }
      continue;
    }
    if (record.kind === "orderFillObserved") {
      const seen = latestObserved.get(record.id);
      // `>=` — the LAST line in file order wins an equal-stamp tie, as above.
      if (seen === undefined || record.observedAt >= seen.observedAt) {
        latestObserved.set(record.id, {
          observedAt: record.observedAt,
          quantity: record.observedFilledQuantity,
        });
      }
    }
    // `orderFilled` and `orderCancelled` are deliberately not read here. This function
    // answers "does the export AGREE with what the file last OBSERVED", which is a
    // question about the venue's column; what the fund has BOOKED against the rung, and
    // whether the claim was retired, is what the caller's partition weighs next, off
    // `pickRestingOrdersAsOf`.
  }

  const changed: ChangedClaim[] = [];
  for (const order of observed) {
    const placed = placedById.get(order.id);
    if (placed === undefined) {
      continue;
    }
    const differences: ClaimDifference[] = [];
    if (placed.quantity !== order.quantity) {
      differences.push({ field: "quantity", known: placed.quantity, observed: order.quantity });
    }
    const knownFilled =
      latestObserved.get(order.id)?.quantity ?? placed.observedFilledQuantity ?? 0;
    const observedFilled = order.filledQuantity ?? 0;
    if (Math.abs(knownFilled - observedFilled) > QUANTITY_EPSILON) {
      differences.push({
        field: "observedFilledQuantity",
        known: knownFilled,
        observed: observedFilled,
      });
    }
    // COMPARE-WHEN-PRESENT, on BOTH sides — the argument is in the docstring above. An
    // absent descriptor is not a value to be defaulted; it is the absence of a recording,
    // and there is no `known → observed` pair to be made out of it.
    if (
      placed.orderType !== undefined &&
      order.orderType !== undefined &&
      placed.orderType !== order.orderType
    ) {
      differences.push({ field: "orderType", known: placed.orderType, observed: order.orderType });
    }
    if (
      placed.timeInForce !== undefined &&
      order.timeInForce !== undefined &&
      placed.timeInForce !== order.timeInForce
    ) {
      differences.push({
        field: "timeInForce",
        known: placed.timeInForce,
        observed: order.timeInForce,
      });
    }
    // `null` is the venue's own "there is no trigger here" and is treated as absent, for
    // the reason the docstring gives: it has no honest spelling as the `observed` side of
    // a difference. EXACT equality, like `quantity` and unlike the filled figure: this is
    // one authored number against another rather than a comparison with a folded figure,
    // so there is nothing for a floor to absorb.
    if (
      placed.triggerPrice !== undefined &&
      order.triggerPrice !== undefined &&
      order.triggerPrice !== null &&
      placed.triggerPrice !== order.triggerPrice
    ) {
      differences.push({
        field: "triggerPrice",
        known: placed.triggerPrice,
        observed: order.triggerPrice,
      });
    }
    if (differences.length > 0) {
      changed.push({ id: order.id, differences });
    }
  }
  return changed;
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
    // THE DESCRIPTORS, ON THE SAME CONDITIONAL-SPREAD IDIOM (#205) and on the SAME GATE
    // the reader applies on the way back in — `records.ts` refuses a blank descriptor and
    // a non-positive `triggerPrice` as malformed, so writing one would put a line on an
    // append-only file that every later load skips. Stating the rule twice is the point:
    // the write gate and the read gate must not drift, exactly as `buildOrderFillObserved`
    // argues for the observation line.
    //
    // An absent, blank or `null` value writes NO KEY. It is not `""` and not `null`: a
    // descriptor has no meaningful empty value, so absence is the only honest spelling of
    // "we were never told", and the field's own comparison is skipped rather than
    // manufacturing a difference out of it.
    ...(isDescriptorText(order.orderType) ? { orderType: order.orderType } : {}),
    ...(isDescriptorText(order.timeInForce) ? { timeInForce: order.timeInForce } : {}),
    ...(isTriggerPrice(order.triggerPrice) ? { triggerPrice: order.triggerPrice } : {}),
    fundingReserveId: attribution.overrides?.[order.id] ?? attribution.fundingReserveId,
  }));
}
