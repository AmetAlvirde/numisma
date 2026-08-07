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
export type OrderKind = "orderPlaced" | "orderCancelled" | "orderFilled" | "orderFillObserved";

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
   * The venue's `filled_quantity` for this rung AS OF `observedAt` — CUMULATIVE since the
   * rung was placed, and ABSENT rather than `0` when nothing had filled (#173).
   *
   * WHY IT IS A FIELD ON THE PLACEMENT LINE AND NOT A SYNTHESIZED `orderFilled`. The
   * append-only file makes this shape permanent, so the reasoning is recorded here:
   *
   *   - AN `orderFilled` LINE IS HALF OF A FILL ACT. `reconcileFillActs` pairs every one
   *     of them with a `PositionOpened`/`PositionAddedTo` in `events.jsonl` by a derived
   *     id. A line synthesized at import has no lot answering for it, so it would read as
   *     a permanent `fill-without-lot` TORN ACT — and `recordFill` refuses to record
   *     anything while one is outstanding. Importing any partial would brick the fill flow.
   *   - IDEMPOTENCY COMES FREE HERE AND NOWHERE ELSE. Both the import's append filter and
   *     `pickRestingOrdersAsOf` dedupe by ORDER ID, so a re-import of the same export
   *     lands nothing twice. `orderFilled` lines are SUBTRACTED unconditionally
   *     (`./select.ts`), so two identical ones would double-count the partial — and a
   *     dedupe rule for them would be indistinguishable from a genuine second real
   *     partial at the same second.
   *   - THE TWO FACTS ARE DIFFERENT. `orderFilled` is something the FUND did, with a lot
   *     and a cash leg behind it. This is something the venue SHOWED about the row at the
   *     moment it was observed. Collapsing them into one verb would lose that.
   *
   * THIS FIELD IS THE FIRST OBSERVATION, NOT THE ONLY ONE (#181). The id is synthesized
   * from the venue's SUBMISSION stamp, so a later export showing the same rung further
   * filled arrives under the SAME id — the ordinary life of a ladder, not an amendment.
   * The file is append-only and a second placement line is ignored by the selector, so
   * this value is never rewritten. It does not need to be: an
   * {@link OrderFillObservedRecord} states the venue's later figure on its own line, and
   * `./select.ts` folds this field and every observation since into ONE `consumed`
   * baseline on the same cumulative basis. The value here is the partial as of the first
   * import that saw the rung; the SELECTOR's answer is as of the latest line.
   *
   * The handling of a restatement moved three times, and the history is kept because the
   * append-only file makes the shape permanent. It was originally SKIPPED AS ALREADY
   * KNOWN, silently. #174 made it a `changed-claim` refusal — loud, with nothing written —
   * which fixed the silence and created a worse problem: the refusal was batch-wide, so
   * one further-filled rung blocked every unrelated new rung in every later export from
   * that venue, indefinitely. #199 narrowed that to a PER-RUNG skip reported as
   * `restated`, which stopped the collateral damage and still left this field holding a
   * figure the venue had moved past. #181 records the restatement instead.
   */
  observedFilledQuantity?: number;
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

/**
 * A type-only witness that a record came through {@link buildOrderFillObserved}.
 *
 * It exists at COMPILE TIME ONLY — `declare const` emits nothing, the key never appears
 * on a real object, and `serializeOrderRecord` writes `KEY_ORDER` rather than the
 * caller's keys, so no line on disk carries a trace of it. What it buys is that
 * "constructed only through the constructor" is checked by `pnpm typecheck` instead of
 * asserted by a comment: an object literal of the right shape is NOT assignable to
 * {@link OrderFillObservedRecord}, so the `?? 0`-over-a-literal defect this slice exists
 * to close cannot be written at all.
 */
declare const OBSERVED_THROUGH_CONSTRUCTOR: unique symbol;

/**
 * THE VENUE SHOWED THIS ROW FURTHER FILLED (#181) — the observation verb.
 *
 * WHY A NEW KIND, AND NOT ONE OF THE THREE ALREADY HERE. Not a synthesized `orderFilled`:
 * that line is HALF OF A FILL ACT, paired by `reconcileFillActs` with a lot in
 * `events.jsonl`, so one written at import would read as a permanent `fill-without-lot`
 * torn act and brick the fill flow (`./fill.ts` excludes this kind deliberately, and says
 * so). Not a repeat `orderPlaced` either: `./select.ts` ignores a second placement line
 * for a known id BY DESIGN — that is what makes a re-import idempotent — so a restatement
 * carried that way would be unreachable.
 *
 * `observedFilledQuantity` REUSES THE PLACEMENT LINE'S FIELD NAME because it asserts the
 * SAME FACT at a later moment: cumulative since the rung was placed, one basis (#176).
 * A second name would make that illegible in the one artifact where it matters — the
 * file itself. `./select.ts` folds both into one `consumed` baseline.
 *
 * NO COPY OF `quantity`. Quantity is the one figure nothing may go stale on, and a second
 * copy of it manufactures exactly the drift the import's batch refusal exists to prevent.
 * A reader that needs the placed size joins to the `orderPlaced` line by id.
 */
export interface OrderFillObservedRecord extends OrderRecordBase {
  kind: "orderFillObserved";
  /**
   * The venue's CUMULATIVE filled quantity for this rung as of `observedAt` — REQUIRED
   * and POSITIVE. A line is only ever written because the figure moved UP, so absent and
   * zero are both unreachable and both mean the writer failed to say what it observed.
   */
  observedFilledQuantity: number;
  /** Compile-time only; see {@link OBSERVED_THROUGH_CONSTRUCTOR}. Never on disk. */
  readonly [OBSERVED_THROUGH_CONSTRUCTOR]: never;
}

export type OrderRecord =
  | OrderPlacedRecord
  | OrderCancelledRecord
  | OrderFilledRecord
  | OrderFillObservedRecord;

/** What the writer asserts. Every field is required — there is no absent figure to fall back over. */
export interface ObservedFillClaim {
  id: string;
  observedAt: string;
  currency: Currency;
  observedFilledQuantity: number;
}

/**
 * The outcome of building an observation line. A REFUSAL IS A VALUE the caller must
 * handle, which is what makes the constructor total: it is defined on every input, it
 * never throws, and there is no path on which it returns a record it could not justify.
 */
export type OrderFillObservedBuild =
  | { status: "ok"; record: OrderFillObservedRecord }
  | { status: "refused"; message: string };

/** Built below, beside the validators it shares with {@link parseOrderRecord}. */

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
  orderFillObserved: true,
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
 * THE stamp rule, as a predicate, so no producer has to restate the regex.
 *
 * `parseOrderRecord` below is the last line of defence and would reject a bad stamp on
 * the way back IN — but by then the line is already on disk in an append-only file. A
 * producer that wants to refuse BEFORE it writes (`orders:cancel` takes its stamp from
 * argv) asks here, and asks the same question the reader will.
 */
export function isObservedAtStamp(value: string): boolean {
  return OBSERVED_AT.test(value);
}

/**
 * Format an instant into THE stamp shape: `YYYY-MM-DDTHH:MM:SS`, LOCAL, no timezone.
 *
 * Local rather than UTC on purpose: every other stamp in this file came from a venue
 * export rendered in the operator's own wall clock, and mixing a UTC "now" into a file
 * whose selector compares stamps as STRINGS would order the book wrong by exactly the
 * UTC offset. Pure — the caller supplies the instant, so this stays clock-free.
 */
export function formatObservedAt(instant: Date): string {
  const pad = (value: number, width = 2): string => String(value).padStart(width, "0");
  return (
    `${pad(instant.getFullYear(), 4)}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}` +
    `T${pad(instant.getHours())}:${pad(instant.getMinutes())}:${pad(instant.getSeconds())}`
  );
}

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
    // Absent when nothing had filled: `JSON.stringify` drops an `undefined` value, so a
    // rung with no partial serializes to exactly the bytes it always did.
    "observedFilledQuantity",
    "fundingReserveId",
  ],
  orderCancelled: ["id", "observedAt", "kind", "currency"],
  orderFilled: ["id", "observedAt", "kind", "currency", "filledQuantity"],
  // FIVE KEYS. No `quantity`, no `symbol`, no `price` — an observation restates ONE fact
  // and joins to its placement line by id for the rest.
  orderFillObserved: ["id", "observedAt", "kind", "currency", "observedFilledQuantity"],
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
 * THE ONLY WAY TO BUILD AN OBSERVATION LINE (#181). Total: every input gets an answer.
 *
 * WHAT THIS REPLACES, AND WHY IT IS A FUNCTION RATHER THAN A COMMENT. The shape this
 * supersedes was an object literal with a `?? 0` fallback annotated "positive by
 * construction". The annotation was false — the fallback was a LIVE BRANCH — and the
 * failure mode is asymmetric: a zero SERIALIZES CLEANLY and only reads back as
 * `malformed` on every subsequent load, at which point the four TUI shells refuse to
 * render a committed figure at all. One bad line poisons the readability of the whole
 * book, and an append-only file has no way to take it back.
 *
 * So the figure is checked HERE, before the line can exist, on the same rule
 * {@link parseOrderRecord} applies on the way back in — it lives beside that reader and
 * shares its validators, so the write gate and the read gate cannot drift. The stamp and
 * the id are checked for the same reason {@link isObservedAtStamp} exists at all: the
 * reader is the last line of defence, but by the time it runs the line is on disk.
 */
export function buildOrderFillObserved(claim: ObservedFillClaim): OrderFillObservedBuild {
  if (!isNonEmptyString(claim.id)) {
    return { status: "refused", message: "id must be a non-empty string" };
  }
  if (!isObservedAtStamp(claim.observedAt)) {
    return { status: "refused", message: "observedAt must be YYYY-MM-DDTHH:MM:SS" };
  }
  if (!(claim.currency in CURRENCIES)) {
    return { status: "refused", message: "currency must be a known currency" };
  }
  if (!isFinitePositive(claim.observedFilledQuantity)) {
    return {
      status: "refused",
      message: "observedFilledQuantity must be a finite positive number",
    };
  }
  return {
    status: "ok",
    // The one cast in the module, and the reason the witness works: it is unforgeable
    // outside these lines, so every `OrderFillObservedRecord` anywhere passed the checks
    // directly above.
    record: {
      id: claim.id,
      observedAt: claim.observedAt,
      kind: "orderFillObserved",
      currency: claim.currency,
      observedFilledQuantity: claim.observedFilledQuantity,
    } as OrderFillObservedRecord,
  };
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
      // Optional and NON-NEGATIVE. Absent is the common case and reads as nothing filled;
      // a value at or above `quantity` would leave nothing resting, and the selector — not
      // this reader — is where "nothing still claimed stops resting" is decided.
      if (
        value.observedFilledQuantity !== undefined &&
        !(
          typeof value.observedFilledQuantity === "number" &&
          Number.isFinite(value.observedFilledQuantity) &&
          value.observedFilledQuantity >= 0
        )
      ) {
        return {
          status: "skip",
          problem: "malformed",
          message: "observedFilledQuantity must be a non-negative number when present",
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
          ...(value.observedFilledQuantity !== undefined && value.observedFilledQuantity > 0
            ? { observedFilledQuantity: value.observedFilledQuantity }
            : {}),
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
    case "orderFillObserved": {
      // THE SAME GATE THE WRITER PASSED, and not a second copy of it: the reader routes
      // through the constructor, so "required and finite-positive" is stated once. A
      // refusal here is `malformed` — a line that fails to say what it observed is
      // corruption, not a forward-compatibility problem, and it is NEVER read as zero.
      const built = buildOrderFillObserved({
        id: base.id,
        observedAt: base.observedAt,
        currency: base.currency,
        // `as number` is the untrusted value going INTO the gate, not past it: the
        // constructor's own check is what decides, on exactly this value.
        observedFilledQuantity: value.observedFilledQuantity as number,
      });
      if (built.status !== "ok") {
        return { status: "skip", problem: "malformed", message: built.message };
      }
      return { status: "ok", record: built.record };
    }
  }
}
