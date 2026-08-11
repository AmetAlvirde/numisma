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
// The STRICT record predicate — arrays refused, not waved through. It lives in the
// engine's kernel beside its loose sibling `isRecord` so the contrast between them is
// stated once, in one place, rather than rediscovered here.
import { isRecordObject } from "../internal.js";
import { isIsoCalendarDate } from "../plans.js";

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
   * THE PLACEMENT DESCRIPTORS (#205) — how the venue says the rung was PLACED, beside the
   * `price`/`quantity` pair that says what it CLAIMS.
   *
   * ALL THREE ARE OPTIONAL AND THAT IS THE WHOLE DESIGN. Every line written before this
   * widening carries none of them, and the detector compares a descriptor only when the
   * line it is comparing against actually has one — so no existing line reads as a
   * difference, no re-import of an unchanged export refuses, and the append-only file
   * needs no migration. An absent field is never read as `""` or as `0`: absence means
   * *"we were never told"*, and a descriptor has no meaningful empty value to be defaulted
   * to. `serializeOrderRecord` drops an `undefined`, so a rung with no descriptors
   * serializes to exactly the bytes it always did.
   *
   * NONE OF THEM MOVES THE ENCUMBRANCE, which is `price * quantity`. That is why they are
   * safe to widen into and why a difference in one is not the funding hazard the amendment
   * refusal exists for.
   *
   * DELIBERATELY NOT ON `OrderFillObservedRecord` (#181 `D7`), and not "until #205 lands":
   * an observation restates ONE fact — the venue's cumulative fill — and a copy of a
   * descriptor there would be a second place for it to go stale.
   */
  orderType?: string;
  timeInForce?: string;
  /**
   * ABSENT, never `null`. The venue renders "no trigger" as a sentinel, the parser turns
   * that into `null` on the observed row, and the writer omits the key rather than putting
   * a third state on disk that every later reader would have to interpret.
   */
  triggerPrice?: number;
  /**
   * The FIRST DECLARED field at placement (`Q9`): which reserve the claim encumbers. The
   * venue has never heard of a Reserve, so this cannot be observed. Still notably absent:
   * a target `positionId` — the Position cannot exist until the first fill, so naming it
   * here would be a dangling forward reference, and that refusal is unchanged.
   *
   * THE LADDER JOIN IS NO LONGER PARKED (#286). This docstring said it was "parked on a
   * fills header nobody has"; {@link OrderPlacedRecord.planId} and
   * {@link OrderPlacedRecord.rungId} below are that join, declared here beside this
   * field. A plan id names a DECLARATION the operator has already authored, which is
   * exactly what a target `positionId` is not.
   */
  fundingReserveId: string;
  /**
   * THE DECLARED JOIN (#286) — which ladder, and which rung of it, this claim was placed
   * for. The second and third declared fields at placement, and neither is observable:
   * the venue has never heard of a plan.
   *
   * `planId` is the ladder's own `id` off `plans.jsonl`, carried through from the loaded
   * plan — a UUID, and a key rather than a label. `rungId` is unique only WITHIN one
   * plan, which is precisely why it cannot travel alone.
   *
   * **OPTIONAL, AND THAT IS THE WHOLE DESIGN** — the same rule the #205 descriptors ship
   * under. The lines written before this widening carry neither, load exactly as they do
   * today, and are never migrated; `serializeOrderRecord` drops an `undefined`, so an
   * order with no picks serializes to exactly the bytes it always did. Because they are
   * optional forever, the PRICE-MATCH fallback is permanent too — a reader that has
   * neither field joins by price and says so, rather than pretending the join was
   * declared.
   *
   * ABSENCE MEANS *"WE WERE NEVER TOLD"*, never `""`. A blank is refused at both gates,
   * for the reason a blank descriptor is: it serializes cleanly and only reads back as
   * `malformed` on every later load of an append-only file.
   *
   * THE OPERATOR NEVER TYPES ONE. `orders:import` presents ladders and rungs by their
   * meaningful content — position, effective date, rung price and size — and writes the
   * id it carried through. A prompt that asked for the id would make the UUID an
   * operator-facing string, which is exactly what it is not.
   */
  planId?: string;
  rungId?: string;
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
const OBSERVED_AT = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})$/;

/**
 * THE stamp rule, as a predicate, so no producer has to restate the regex.
 *
 * `parseOrderRecord` below is the last line of defence and would reject a bad stamp on
 * the way back IN — but by then the line is already on disk in an append-only file. A
 * producer that wants to refuse BEFORE it writes (`orders:cancel` takes its stamp from
 * argv) asks here, and asks the same question the reader will.
 *
 * SHAPE IS NOT ENOUGH, and this predicate used to be shape alone. ADR-004's second
 * amendment states the general rule underneath both sidecars — *a field that is
 * SELECTED ON must sort as a string in the same order it sorts in time* — and exempts
 * `observedAt` from the class's `YYYY-MM-DD` requirement. That exemption is about
 * GRANULARITY and it stands: a fixed-width, zero-padded second-granular stamp sorts as
 * a string exactly as it sorts in time, which is the rule satisfied rather than waived.
 *
 * What the exemption never covered is the ROUND TRIP. `"2026-02-30T00:00:00"` matches
 * the shape, sorts as February, and means March 2 — the identical defect the amendment
 * describes for `effectiveAt`, wearing a time suffix. `observedAt` IS selected on
 * (`pickRestingOrdersAsOf` compares these strings), so the rule reaches it. The date half
 * therefore round-trips through the same `isIsoCalendarDate` the rest of the class
 * uses, and the time half is range-checked, because `\d{2}:\d{2}:\d{2}` alone accepts
 * `99:99:99` — which likewise sorts after every real time of that day.
 */
export function isObservedAtStamp(value: string): boolean {
  const match = OBSERVED_AT.exec(value);
  if (match === null) {
    return false;
  }
  const [, date, hours, minutes, seconds] = match;
  return (
    isIsoCalendarDate(date) &&
    Number(hours) <= 23 &&
    Number(minutes) <= 59 &&
    // 59, not 60: a leap second has never appeared in a venue export, and admitting one
    // would mean admitting the typo that produces the same string far more often.
    Number(seconds) <= 59
  );
}

/**
 * THE ONE PLACE THE STAMP RULE IS PUT INTO WORDS, beside the predicate that enforces it —
 * the same one-shared-sentence move `renderSkipMessage` makes for skipped lines (#181).
 *
 * {@link isObservedAtStamp} was narrowed from shape alone to shape PLUS a round-tripped
 * calendar date and a range-checked time. Four messages described the rule, the reader's
 * was the only one updated, and the other three went on quoting the operator a string that
 * satisfies the shape they name — a refusal whose stated reason the input does not violate.
 * A wrong diagnosis on an append-only file is expensive: it sends the operator to retype a
 * stamp that was already the right shape, and never names the impossible date.
 *
 * So it is a PHRASE, not a finished sentence. The reader says `observedAt must be …`, the
 * producer says the same, the two TUI shells quote the value back and the prompt states the
 * rule in advance — four grammars, one clause, and no way for them to drift apart again.
 */
export const OBSERVED_AT_RULE = "YYYY-MM-DDTHH:MM:SS, a real calendar date and time";

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
 * THE WHITELIST IS THE WRITE (#205), SO THE TYPE HOLDS IT (audit finding 12).
 *
 * `serializeOrderRecord` copies ONLY the keys named below, and the failure that makes
 * these four tables worth their shape is asymmetric and permanent: a field added to a
 * record interface and forgotten here is DROPPED at write, `orders.jsonl` is append-only,
 * and every line written before the omission is discovered is missing it with no
 * migration path. #205 walked exactly that path once.
 *
 * So each table is a `Record<keyof …Record, true>` — the same union-derived idiom
 * {@link KNOWN_KINDS} uses one screen up. A key missing from a table fails `pnpm
 * typecheck`; so does a key that is not on the record. An OPTIONAL field is caught too:
 * `keyof` erases optionality, so `orderType` is a REQUIRED entry here even though the
 * field itself is optional — which is the case that actually bit, since a widening adds
 * optional fields.
 *
 * ORDER IS SEMANTICS, AND THE TYPE DOES NOT CHECK IT. `Object.keys` returns these keys in
 * the table's own INSERTION order (all of them are non-numeric strings, so no
 * integer-index reshuffle applies), and that sequence is the byte layout of every line
 * written from here on. Reordering a table rewrites the file's shape while typechecking
 * clean, so the emitted sequence is pinned by test in `./records.test.ts`.
 */
const ORDER_PLACED_KEYS: Record<keyof OrderPlacedRecord, true> = {
  id: true,
  observedAt: true,
  kind: true,
  currency: true,
  symbol: true,
  side: true,
  price: true,
  quantity: true,
  orderType: true,
  timeInForce: true,
  triggerPrice: true,
  // Absent when nothing had filled: `JSON.stringify` drops an `undefined` value, so a
  // rung with no partial serializes to exactly the bytes it always did — which is
  // equally true of the three descriptors above.
  observedFilledQuantity: true,
  fundingReserveId: true,
  // THE DECLARED JOIN (#286), appended AFTER the declaration already here so the three
  // fields nobody could observe read together at the end of the line. Appending rather
  // than inserting also keeps every line written before this widening comparable to the
  // ones written after it, key for key, up to where the old shape ended.
  planId: true,
  rungId: true,
};

const ORDER_CANCELLED_KEYS: Record<keyof OrderCancelledRecord, true> = {
  id: true,
  observedAt: true,
  kind: true,
  currency: true,
};

const ORDER_FILLED_KEYS: Record<keyof OrderFilledRecord, true> = {
  id: true,
  observedAt: true,
  kind: true,
  currency: true,
  filledQuantity: true,
};

/**
 * FIVE KEYS. No `quantity`, no `symbol`, no `price` — an observation restates ONE fact
 * and joins to its placement line by id for the rest.
 *
 * The witness is EXCLUDED, not forgotten: {@link OBSERVED_THROUGH_CONSTRUCTOR} is a
 * compile-time-only key that never exists on a real object, so listing it would put a
 * key on disk that nothing can write and every reader would have to ignore.
 */
const ORDER_FILL_OBSERVED_KEYS: Record<
  Exclude<keyof OrderFillObservedRecord, typeof OBSERVED_THROUGH_CONSTRUCTOR>,
  true
> = {
  id: true,
  observedAt: true,
  kind: true,
  currency: true,
  observedFilledQuantity: true,
};

/**
 * CANONICAL key order, one per record kind. Serialization goes through this rather than
 * through the caller's object so a round-trip (write → load → re-serialize) is
 * BYTE-EQUAL by construction, not by the caller's luck in field ordering.
 */
const KEY_ORDER: Record<OrderKind, readonly string[]> = {
  orderPlaced: Object.keys(ORDER_PLACED_KEYS),
  orderCancelled: Object.keys(ORDER_CANCELLED_KEYS),
  orderFilled: Object.keys(ORDER_FILLED_KEYS),
  orderFillObserved: Object.keys(ORDER_FILL_OBSERVED_KEYS),
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * THE DESCRIPTOR GATES (#205), exported so the WRITER asks exactly the question this
 * reader will ask on the way back in.
 *
 * The asymmetry that makes this worth a shared function rather than a comment is the one
 * {@link buildOrderFillObserved} names: a blank `orderType` or a zero `triggerPrice`
 * SERIALIZES CLEANLY and only reads back as `malformed` on every subsequent load, at which
 * point the whole line — the rung's placement, its size, its funding reserve — is skipped
 * by every reader of an append-only file that cannot take it back.
 *
 * A BLANK IS NOT A DESCRIPTOR. The venue renders these cells for a human, so an empty one
 * says nothing was rendered, and the record's own convention is that an unrecorded
 * descriptor is ABSENT rather than empty (see `ObservedOpenOrder` in `./ingest.ts`). A
 * `triggerPrice` of zero is the same fact in numeric clothing: no rung triggers at zero,
 * so the figure is a rendering artifact, not a price.
 */
export function isDescriptorText(value: unknown): value is string {
  return isNonEmptyString(value);
}

export function isTriggerPrice(value: unknown): value is number {
  return isFinitePositive(value);
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
    return { status: "refused", message: `observedAt must be ${OBSERVED_AT_RULE}` };
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
  if (typeof value.observedAt !== "string" || !isObservedAtStamp(value.observedAt)) {
    return {
      status: "skip",
      problem: "malformed",
      message: `observedAt must be ${OBSERVED_AT_RULE}`,
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
      // THE DESCRIPTORS (#205) — optional, and checked ONLY when present, on the same
      // gates the writer passed. A line from an OLDER build carries none of them and reads
      // back exactly as it always did; a line from a NEWER build carrying a fourth
      // descriptor this reader has never heard of still parses, because an unknown key is
      // ignored here and that graceful degradation is deliberate.
      if (value.orderType !== undefined && !isDescriptorText(value.orderType)) {
        return {
          status: "skip",
          problem: "malformed",
          message: "orderType must be a non-empty string when present",
        };
      }
      if (value.timeInForce !== undefined && !isDescriptorText(value.timeInForce)) {
        return {
          status: "skip",
          problem: "malformed",
          message: "timeInForce must be a non-empty string when present",
        };
      }
      if (value.triggerPrice !== undefined && !isTriggerPrice(value.triggerPrice)) {
        return {
          status: "skip",
          problem: "malformed",
          message: "triggerPrice must be a positive number when present",
        };
      }
      // THE DECLARED JOIN (#286) — optional, checked ONLY when present, on the same gate
      // the writer passed. Each is checked on its own: they are two facts, and a line
      // carrying one without the other is degraded rather than corrupt.
      if (value.planId !== undefined && !isNonEmptyString(value.planId)) {
        return {
          status: "skip",
          problem: "malformed",
          message: "planId must be a non-empty string when present",
        };
      }
      if (value.rungId !== undefined && !isNonEmptyString(value.rungId)) {
        return {
          status: "skip",
          problem: "malformed",
          message: "rungId must be a non-empty string when present",
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
          ...(isDescriptorText(value.orderType) ? { orderType: value.orderType } : {}),
          ...(isDescriptorText(value.timeInForce) ? { timeInForce: value.timeInForce } : {}),
          ...(isTriggerPrice(value.triggerPrice) ? { triggerPrice: value.triggerPrice } : {}),
          ...(value.observedFilledQuantity !== undefined && value.observedFilledQuantity > 0
            ? { observedFilledQuantity: value.observedFilledQuantity }
            : {}),
          fundingReserveId: value.fundingReserveId,
          ...(isNonEmptyString(value.planId) ? { planId: value.planId } : {}),
          ...(isNonEmptyString(value.rungId) ? { rungId: value.rungId } : {}),
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
