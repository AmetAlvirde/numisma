/**
 * The `orders.jsonl` RECORD CONTRACT — the pure half of ADR-013's sidecar.
 *
 * An `Order` is "a claim on capital that has not yet become a transaction". It is
 * recorded BESIDE the append-only event log, never in it (ADR-013): a line here is
 * not a `PortfolioEvent`, `parseEvent` never sees it, `foldEvents` never reads it,
 * and nothing it says can reach `fundValueUsd`.
 *
 * The skeleton is deliberately the same as the event envelope and the two words that
 * differ are the two carrying that claim:
 *
 *   events.jsonl   {"id":"…","asOf":"YYYY-MM-DD","type":"PositionAddedTo",…}
 *   orders.jsonl   {"id":"…","observedAt":"YYYY-MM-DDTHH:MM:SS","kind":"orderPlaced",…}
 *
 * `kind` not `type`; `observedAt` not `asOf`. `observedAt` also earns its keep
 * independently: `parseEvent` gates the envelope's `asOf` to a bare `YYYY-MM-DD`
 * (`events/parse.ts`), while the venue's timestamps are SECOND-GRANULAR — several
 * rungs of one ladder are submitted within the same minute and a date-only stamp
 * cannot order them. Matching the log's word would mean losing information.
 *
 * This module is PURE (ADR-001): the record types, the canonical serializer, and the
 * validating reader for ONE untrusted value. All file IO lives in
 * `@numisma/preferences`; the as-of selector lives in `./select.ts`.
 */
import type { Currency } from "../contracts.js";

/**
 * The lifecycle verbs of the sidecar (`S2`): one line per order placed, one further
 * line per state change. Deliberately NOT `PortfolioEventType` — these are things the
 * VENUE SHOWS, not things the fund DID, and the two vocabularies must never converge.
 *
 * `orderFilled` is declared here because the selector must know a filled rung stops
 * resting; WRITING one is the atomic two-file fill act, which is a later slice.
 */
export type OrderKind = "orderPlaced" | "orderCancelled" | "orderFilled";

/** Which side of the book the claim rests on. Resting sells are named, not designed. */
export type OrderSide = "buy" | "sell";

interface OrderRecordBase {
  /**
   * The order's identity. The venue's export carries NO order id (it is a rendered
   * table), so downstream ingest synthesizes one; this module only requires that the
   * lifecycle lines of one order share it.
   */
  id: string;
  /**
   * Second-granular local stamp, `YYYY-MM-DDTHH:MM:SS`, no timezone — exactly what the
   * venue's export carries and precisely what the event envelope's `asOf` could not
   * express.
   */
  observedAt: string;
  kind: OrderKind;
  /**
   * The currency `price` is denominated in, carried EXPLICITLY on EVERY record —
   * including the state-change lines, so no line needs a join back to its `orderPlaced`
   * to be read. The hosted posture is single-tenant, so this is redundant today; it is
   * cheap now and awkward to retrofit onto an append-only file later, and it holds this
   * file to the same rule the eventual DCA plan sidecar is held to: list-shaped, keyed
   * by id, carrying its own currency, no fund-specific constants.
   */
  currency: Currency;
}

/** The claim is placed: the observed half of the venue's row plus ONE declared field. */
export interface OrderPlacedRecord extends OrderRecordBase {
  kind: "orderPlaced";
  symbol: string;
  side: OrderSide;
  price: number;
  /**
   * The AUTHORITATIVE size. Sizing in quote currency and truncating to the venue's lot
   * precision makes the export's order-value column drift; never reconcile on that.
   */
  quantity: number;
  /**
   * The one DECLARED field at placement (`Q9`): which reserve the claim encumbers. The
   * venue has never heard of a Reserve, so this cannot be observed. Notably absent: a
   * target `positionId` (the Position cannot exist until the first fill, so naming it
   * here would be a dangling forward reference) and a ladder id (that join is parked on
   * a fills header nobody has).
   */
  fundingReserveId: string;
}

/** The claim left the book by cancellation — an OBSERVED cancellation, never inferred. */
export interface OrderCancelledRecord extends OrderRecordBase {
  kind: "orderCancelled";
}

/**
 * The claim was filled, in whole or in part. `filledQuantity` is the honest test — a
 * partial fill leaves the remainder resting, and only exhausting the quantity retires
 * the claim.
 */
export interface OrderFilledRecord extends OrderRecordBase {
  kind: "orderFilled";
  filledQuantity: number;
}

export type OrderRecord = OrderPlacedRecord | OrderCancelledRecord | OrderFilledRecord;

/**
 * Every `OrderKind` the union knows, as a runtime value derived from the union itself:
 * a kind added to `OrderKind` with no entry here fails `pnpm typecheck`, and an entry
 * here that is not a kind fails too. The loader treats anything else as an UNKNOWN kind
 * to be skipped and reported, never as a fatal error.
 */
const KNOWN_KINDS: Record<OrderKind, true> = {
  orderPlaced: true,
  orderCancelled: true,
  orderFilled: true,
};

const CURRENCIES: Record<Currency, true> = { USD: true, MXN: true };

/**
 * Second-granular local timestamp with NO timezone — the venue's own precision. The
 * as-of selector compares `observedAt` by STRING, so the format must be
 * lexicographically sortable-as-chronological; a `Date.parse`-able but non-ISO stamp
 * would sort wrong and silently answer "what was resting on date X" with the wrong set.
 */
const OBSERVED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

/**
 * CANONICAL key order, one per record kind. Serialization goes through this rather than
 * through the caller's object so a round-trip (write → load → re-serialize) is
 * BYTE-EQUAL by construction, not by the caller's luck in field ordering.
 */
const KEY_ORDER: Record<OrderKind, readonly string[]> = {
  orderPlaced: [
    "id",
    "observedAt",
    "kind",
    "currency",
    "symbol",
    "side",
    "price",
    "quantity",
    "fundingReserveId",
  ],
  orderCancelled: ["id", "observedAt", "kind", "currency"],
  orderFilled: ["id", "observedAt", "kind", "currency", "filledQuantity"],
};

/** Serialize ONE record to its canonical JSON line (no trailing newline). */
export function serializeOrderRecord(record: OrderRecord): string {
  const source = record as unknown as Record<string, unknown>;
  const ordered: Record<string, unknown> = {};
  for (const key of KEY_ORDER[record.kind]) {
    ordered[key] = source[key];
  }
  return JSON.stringify(ordered);
}

/** Why a line did not become a record. Returned to the caller, never swallowed. */
export type OrderRecordProblem = "unknown-kind" | "malformed";

export type OrderRecordParse =
  | { status: "ok"; record: OrderRecord }
  | { status: "skip"; problem: OrderRecordProblem; message: string };

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Validate ONE untrusted value into an `OrderRecord`, or say why it could not be.
 *
 * The `unknown-kind` outcome is separated from `malformed` on purpose: kinds are
 * expected to be ADDED over time, and a reader from an older build meeting a newer kind
 * is a forward-compatibility problem, not corruption. It skips, says so, and reads on.
 */
export function parseOrderRecord(value: unknown): OrderRecordParse {
  if (!isRecordObject(value)) {
    return { status: "skip", problem: "malformed", message: "record must be a JSON object" };
  }
  if (!isNonEmptyString(value.id)) {
    return { status: "skip", problem: "malformed", message: "id must be a non-empty string" };
  }
  if (typeof value.observedAt !== "string" || !OBSERVED_AT.test(value.observedAt)) {
    return {
      status: "skip",
      problem: "malformed",
      message: "observedAt must be YYYY-MM-DDTHH:MM:SS",
    };
  }
  if (typeof value.kind !== "string" || !(value.kind in KNOWN_KINDS)) {
    return {
      status: "skip",
      problem: "unknown-kind",
      message: `unknown kind ${JSON.stringify(value.kind)}`,
    };
  }
  if (typeof value.currency !== "string" || !(value.currency in CURRENCIES)) {
    return { status: "skip", problem: "malformed", message: "currency must be a known currency" };
  }

  const base = {
    id: value.id,
    observedAt: value.observedAt,
    currency: value.currency as Currency,
  };

  switch (value.kind as OrderKind) {
    case "orderPlaced": {
      if (!isNonEmptyString(value.symbol)) {
        return { status: "skip", problem: "malformed", message: "symbol must be a non-empty string" };
      }
      if (value.side !== "buy" && value.side !== "sell") {
        return { status: "skip", problem: "malformed", message: "side must be buy or sell" };
      }
      if (!isFinitePositive(value.price)) {
        return { status: "skip", problem: "malformed", message: "price must be a positive number" };
      }
      if (!isFinitePositive(value.quantity)) {
        return {
          status: "skip",
          problem: "malformed",
          message: "quantity must be a positive number",
        };
      }
      if (!isNonEmptyString(value.fundingReserveId)) {
        return {
          status: "skip",
          problem: "malformed",
          message: "fundingReserveId must be a non-empty string",
        };
      }
      return {
        status: "ok",
        record: {
          ...base,
          kind: "orderPlaced",
          symbol: value.symbol,
          side: value.side,
          price: value.price,
          quantity: value.quantity,
          fundingReserveId: value.fundingReserveId,
        },
      };
    }
    case "orderCancelled":
      return { status: "ok", record: { ...base, kind: "orderCancelled" } };
    case "orderFilled": {
      if (!isFinitePositive(value.filledQuantity)) {
        return {
          status: "skip",
          problem: "malformed",
          message: "filledQuantity must be a positive number",
        };
      }
      return {
        status: "ok",
        record: { ...base, kind: "orderFilled", filledQuantity: value.filledQuantity },
      };
    }
  }
}
