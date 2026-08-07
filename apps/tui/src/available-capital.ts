/**
 * The IO SHELL that joins `orders.jsonl` to the fold at read time, so a surface can
 * render committed and available. The ADR-001 split again: every decision about what
 * the numbers MEAN is pure and lives in `@numisma/engine` (`pickRestingOrdersAsOf`,
 * `composeAvailableCapital`); this file only reads the sidecar and decides what to do
 * when it cannot.
 *
 * THE REFUSAL IS THE INTERESTING PART. `loadOrders` distinguishes ABSENT from
 * UNREADABLE, and that distinction is the whole reason this is not three lines. "There
 * are no orders" and "I could not read the orders" are OPPOSITE facts about committed
 * capital: collapsing them would let a permissions error or a half-mounted data
 * directory render as a fully unencumbered balance — which is exactly the defect this
 * increment exists to remove, re-introduced through the back door. So an unreadable
 * sidecar REFUSES to render a committed figure and says so, rather than rendering a
 * reassuring one.
 *
 * A skipped LINE is weaker than an unreadable file but still refuses, for the same
 * reason: a committed figure computed over a partially-read book understates
 * encumbrance, and understating encumbrance is the error direction that costs money.
 */
import {
  composeAvailableCapital,
  pickRestingOrdersAsOf,
  type AvailableCapitalReport,
  type FundReviewData,
} from "@numisma/engine";
import type { OrdersLoad } from "@numisma/preferences";
import { renderSkipMessage } from "./skip-message.js";

/** Everything not pure, in one injectable bag — so the whole flow is testable. */
export interface AvailableCapitalIo {
  ordersPath: string;
  loadOrders: (path: string) => Promise<OrdersLoad>;
}

/**
 * Composed, or refused with a reason the operator reads. There is deliberately no
 * "empty" case that looks like "nothing is committed": an absent sidecar composes
 * normally over an empty book, which is honest, while a failure refuses.
 */
export type AvailableCapitalSection =
  | { status: "composed"; report: AvailableCapitalReport }
  | { status: "refused"; message: string };

/**
 * Read the sidecar and compose the three numbers against the folded fund.
 *
 * `asOf` is passed straight through to the pure selector, so a surface rendered
 * `--as-of` a prior date shows the book AS IT WAS RESTING then — the question adherence
 * is made of, answerable only because the sidecar is a lifecycle stream.
 */
export async function loadAvailableCapital(
  data: FundReviewData,
  io: AvailableCapitalIo,
  asOf?: string,
): Promise<AvailableCapitalSection> {
  let load: OrdersLoad;
  try {
    load = await io.loadOrders(io.ordersPath);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      status: "refused",
      message: `could not read ${io.ordersPath}: ${detail}`,
    };
  }

  if (load.status === "unreadable") {
    return {
      status: "refused",
      message: `could not read ${io.ordersPath}: ${load.message}`,
    };
  }

  const records = load.status === "absent" ? [] : load.records;
  const skips = load.status === "loaded" ? load.skips : [];
  if (skips.length > 0) {
    // Still refuses on ANY skip; only the sentence changed (#181). The wording is the
    // shared renderer's, so a `malformed` line and a line from a newer build no longer
    // read as the same problem here or at the other three shells.
    return { status: "refused", message: renderSkipMessage(io.ordersPath, skips) };
  }

  return {
    status: "composed",
    report: composeAvailableCapital(data, pickRestingOrdersAsOf(records, asOf)),
  };
}
