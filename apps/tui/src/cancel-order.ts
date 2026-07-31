/**
 * The IO SHELL for retiring ONE resting rung — the missing PRODUCER of `orderCancelled`.
 *
 * Everything downstream of this file already existed: the record shape, its required
 * fields, its validation, and the selector branch that retires the claim. The only thing
 * missing was something that WRITES one outside the fill flow. Without it, a rung the
 * operator re-priced or cancelled at the venue rests here forever — the next import
 * appends a NEW `orderPlaced` and the old claim is never retired — so committed capital
 * grows monotonically across imports until `O1` refuses a CORRECT export, and until then
 * available is understated by the whole stale stack. The repair, today, is hand-editing
 * an append-only file.
 *
 * DIRECTION OF RISK, and why the refusals below are total rather than warnings.
 * Cancelling FREES encumbrance, so it moves `available` UP. That is the money-costing
 * direction: acting on an available figure inflated by a cancellation that did not really
 * happen puts capital to work that is already spoken for. The reverse — a stale claim
 * nobody retired — merely UNDERSTATES available, and is self-correcting the moment the
 * operator cancels it for real. The venue told us nothing here; the operator's assertion
 * is the only evidence, exactly as it is when they declare the funding reserve at import.
 * So this refuses on anything it cannot substantiate, and every refusal writes NOTHING.
 *
 * ARGV, NOT A PROMPT. A cancellation asserts one fact about one rung — there is no book
 * to interrogate, so there is nothing to ask. (`orders:import` builds its readline before
 * its async load, which makes it TTY-only and unscriptable; this deliberately does not
 * inherit that.)
 *
 * SCOPE. One line, one kind, one file. No record kind is added, `EVENT_SCHEMA_VERSION` is
 * untouched, the event log is not opened, and no committed/available formula moves.
 * ADR-013's `D12` — absence infers nothing — is precisely why this is an EXPLICIT
 * operator act rather than something read off a rung's disappearance from an export.
 */
import {
  committedRungs,
  formatObservedAt,
  isObservedAtStamp,
  pickRestingOrdersAsOf,
  type OrderCancelledRecord,
  type OrderRecord,
} from "@numisma/engine";
import type { OrdersLoad } from "@numisma/preferences";

/** Everything this act touches that is not a pure function, in one injectable bag. */
export interface OrderCancelIo {
  /** The sidecar's resolved path — resolved by the caller, never by this flow. */
  ordersPath: string;
  loadOrders: (path: string) => Promise<OrdersLoad>;
  appendOrders: (path: string, records: OrderRecord[]) => Promise<void>;
  /** Injectable clock, so "stamp it now" is testable without freezing global time. */
  now: () => Date;
  out: (message: string) => void;
  err: (message: string) => void;
}

export type OrderCancelRejection =
  | "no-order-id"
  | "bad-timestamp"
  | "unreadable-sidecar"
  | "unreadable-sidecar-lines"
  | "unknown-order"
  | "not-resting"
  | "before-placement";

export type OrderCancelOutcome =
  | {
      status: "cancelled";
      record: OrderCancelledRecord;
      /** The encumbrance this retirement RELEASES, in the rung's own currency. */
      freed: number;
      fundingReserveId: string;
    }
  | { status: "rejected"; reason: OrderCancelRejection; message: string };

export interface OrderCancelOptions {
  orderId: string;
  /** The operator's stamp. Omitted, blank or absent from argv means "now". */
  observedAt?: string | undefined;
  io: OrderCancelIo;
}

function reject(
  io: OrderCancelIo,
  reason: OrderCancelRejection,
  message: string,
): OrderCancelOutcome {
  // LOUD, and on the error channel: nothing has been written, and the operator must not
  // be able to mistake a refusal for a quiet no-op.
  io.err(`REFUSED — ${message}\nNothing was written to ${io.ordersPath}.`);
  return { status: "rejected", reason, message };
}

/**
 * Retire one resting rung, or refuse and write nothing.
 *
 * The ordering is the contract: validate the assertion → load the sidecar → resolve the
 * resting book → append. The only write is the last statement, and every path before it
 * returns having touched nothing. `orders.jsonl` is append-only, so a wrong line here is
 * not edited away later — it costs a compensating line forever.
 */
export async function cancelOrder(options: OrderCancelOptions): Promise<OrderCancelOutcome> {
  const { io } = options;
  const orderId = options.orderId.trim();
  if (orderId === "") {
    return reject(io, "no-order-id", "no order id was given");
  }

  const supplied = options.observedAt?.trim() ?? "";
  if (supplied !== "" && !isObservedAtStamp(supplied)) {
    // Asked BEFORE the write, against the same rule the reader will apply. Letting a bad
    // stamp through would put a line in the file that this build's own loader then skips
    // as malformed — a claim that reads as retired to the operator and as resting to
    // every consumer.
    return reject(io, "bad-timestamp", `'${supplied}' is not a YYYY-MM-DDTHH:MM:SS stamp`);
  }
  const observedAt = supplied === "" ? formatObservedAt(io.now()) : supplied;

  const existing = await io.loadOrders(io.ordersPath);
  if (existing.status === "unreadable") {
    // "There are no orders" and "I could not read the orders" are opposite facts about
    // committed capital. Cancelling against the second would free an encumbrance we
    // cannot see the other side of.
    return reject(io, "unreadable-sidecar", `could not read ${io.ordersPath}: ${existing.message}`);
  }
  if (existing.status === "loaded" && existing.skips.length > 0) {
    // The same refusal the import makes, for the same reason: a partially-read book
    // cannot tell us whether this rung is resting, and a cancellation decided over one
    // would free capital on a guess.
    return reject(
      io,
      "unreadable-sidecar-lines",
      `${io.ordersPath} has ${existing.skips.length} line(s) this build cannot read, so the ` +
        `resting book would be resolved over a partially-read file`,
    );
  }
  const records: OrderRecord[] = existing.status === "loaded" ? existing.records : [];

  if (!records.some((record) => record.id === orderId)) {
    // Separated from `not-resting` deliberately: "I have never heard of this rung" is a
    // typo or the wrong file, while "it is no longer resting" is a book that already
    // agrees with the operator. The two want different next moves.
    return reject(
      io,
      "unknown-order",
      `no order '${orderId}' in ${io.ordersPath} — check the id against the file`,
    );
  }

  const resting = pickRestingOrdersAsOf(records);
  const target = resting.find((order) => order.placed.id === orderId);
  if (!target) {
    return reject(
      io,
      "not-resting",
      `order '${orderId}' is not currently resting — it was already cancelled or fully ` +
        `filled, so there is no claim left to retire`,
    );
  }

  if (observedAt < target.placed.observedAt) {
    // A stamp before placement would be INERT rather than wrong: the selector replays in
    // `observedAt` order, so the cancellation would be consumed before the placement it
    // retires and the rung would keep resting. Refusing beats writing a permanent line
    // that asserts nothing.
    return reject(
      io,
      "before-placement",
      `the cancellation is stamped ${observedAt}, before the rung was placed ` +
        `(${target.placed.observedAt})`,
    );
  }

  const record: OrderCancelledRecord = {
    id: orderId,
    observedAt,
    kind: "orderCancelled",
    // Carried from the rung's OWN `orderPlaced`, never defaulted: every line in this file
    // carries its currency explicitly so no line needs a join back to be read, and the
    // record's required-field list enforces it.
    currency: target.placed.currency,
  };

  // Through the SHARED committed formula, so the figure reported as freed is the same
  // arithmetic the available report and the `O1` guard use. A resting SELL encumbers the
  // asset rather than the cash reserve, so it frees nothing here and says so.
  const freed = committedRungs([target]).reduce((total, rung) => total + rung.committed, 0);

  await io.appendOrders(io.ordersPath, [record]);

  io.out(
    `Cancelled ${orderId} — ${target.placed.symbol} ${target.placed.side} ` +
      `${target.remainingQuantity} @ ${target.placed.price} ${target.placed.currency}, ` +
      `placed ${target.placed.observedAt}, retired ${observedAt}.\n` +
      `${freed} ${target.placed.currency} is no longer encumbered on ` +
      `${target.placed.fundingReserveId}; available rises by exactly that.\n` +
      `Value did not move: a resting order encumbers AVAILABILITY, never VALUE.\n`,
  );

  return { status: "cancelled", record, freed, fundingReserveId: target.placed.fundingReserveId };
}
