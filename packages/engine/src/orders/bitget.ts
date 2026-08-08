/**
 * PURE parser for Bitget's open-orders export (ADR-001 bars IO from this package; the
 * file reading and the operator prompt live in the TUI).
 *
 * WHAT THIS FILE IS PARSING MATTERS: the export is a rendered TABLE, not an API dump.
 * The last column is `action`, whose every value is the label of a button — `Cancel`.
 * Two consequences run through everything below:
 *
 *   - **There is no order id.** Identity is SYNTHESIZED from `(pair, side, price,
 *     submittedAt)` and nothing else (`./ingest.js`).
 *   - **Some columns are rendered, not recorded.** `trigger_price` renders as `-- / --`
 *     when there is none, and that sentinel must become `null`, never the string it is
 *     drawn as.
 *
 * Two columns are read and DELIBERATELY DROPPED rather than carried:
 *
 *   - `order_value` — a rung sized in quote currency and truncated to the venue's lot
 *     precision leaves this column off by cents. `quantity` is AUTHORITATIVE and this
 *     column drifts, so reconciling on it is wrong; dropping it means there is nothing
 *     to reconcile on by accident.
 *   - `filled_percent` — derived from the quantity columns and rounded for display.
 *
 * The fills export is NOT parsed here and is not stubbed. There is no fills header to
 * write against yet, and a parser written against a guessed one is expected to be wrong
 * and rewritten. A positions/holdings export is not parsed either, ever: a `PositionLot`
 * requires a `cost`, and a holdings row carries a quantity and nothing else.
 */
import type { Currency } from "../contracts.js";
import type { OrderSide } from "./records.js";
import { canonicalDecimal, synthesizeOrderId, type ObservedOpenOrder } from "./ingest.js";

/**
 * The 14 columns, in the order the venue writes them — read first-hand from a real
 * export. This is also the guard that keeps a DIFFERENT export (a fills or holdings CSV)
 * from being parsed as an order book: a header that is not this one is refused whole.
 */
export const BITGET_OPEN_ORDERS_HEADER = [
  "timestamp",
  "pair",
  "time_in_force",
  "order_type",
  "side",
  "price",
  "quantity",
  "trigger_price",
  "order_value",
  "filled_quantity",
  "total_quantity",
  "filled_percent",
  "status",
  "action",
] as const;

/**
 * The status value observed on an UNTOUCHED resting row. OPEN AT THE WIRE, CLOSED AT THE
 * READER: a word outside the vocabulary below is still skipped and reported rather than
 * assumed to be resting, because an unknown word would be a guess — and guessing here
 * means a claim on capital the venue never confirmed.
 *
 * IT IS NO LONGER THE ADMISSION GATE (#173). It used to be, and the defect ran both ways:
 * a row printed `unfilled` was admitted with its partial dropped (committed OVERSTATED),
 * while a row printed as partially filled was skipped whole — the rung vanished from the
 * book and the capital it encumbers was reported FREE, which is the direction that costs
 * money. The REMAINDER decides now; the word only has to be one this reader knows.
 *
 * AND THE REMAINDER IS COMPUTED FIRST. The vocabulary check sits BELOW the remainder gate
 * in `parseBitgetOpenOrdersCsv`, so a row with nothing left is `not-resting` whatever the
 * venue printed. Asking the word first left the rule true only on paper: a rung that
 * filled between export and import prints a terminal word (`Filled`, `Cancelled`, …) that
 * is not in this vocabulary, so it landed in `unknown-status` and fired the #184
 * money-direction alarm about a row we can weigh, and weigh at zero. The word is still
 * only consulted for rows the quantities CANNOT answer — one with a remainder open.
 */
export const BITGET_RESTING_STATUS = "unfilled";

/**
 * The spellings that mean PARTIALLY FILLED. Separators and case are normalized away, so
 * `Partially Filled`, `partially_filled` and `PartiallyFilled` are one word.
 *
 * THE SPELLING IS UNVERIFIED and named as such: no real export has yet shown a partial, so
 * this list is what a rendered table plausibly prints. It costs little if it is wrong — an
 * unrecognized word still lands in `unknown-status` where the operator can see it, which
 * is the same place it landed before. What is NOT a guess is the rule underneath: a row
 * with a remainder open is resting, and `filled_quantity` is what says so.
 */
export const BITGET_PARTIAL_STATUSES = ["partiallyfilled", "partialfilled", "partial"] as const;

/** Case- and separator-insensitive, because a rendered cell is styled for a human. */
function normalizeStatus(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_\-/]/g, "");
}

/** The venue's identifier, and the first component of every id synthesized from it. */
const VENUE = "bitget";

/**
 * Quote token → the currency the fund denominates it in. Derived from the PAIR, never
 * from a fund-specific constant: an order in a pair the fund does not price is skipped
 * and reported, not silently stamped with the fund's own currency.
 */
const QUOTE_CURRENCIES: Record<string, Currency> = {
  USDT: "USD",
  USDC: "USD",
  USD: "USD",
  MXN: "MXN",
};

/** Longest first, so `USDT` is never mistaken for `USD` with a stray `T` on the base. */
const QUOTE_TOKENS = Object.keys(QUOTE_CURRENCIES).sort((a, b) => b.length - a.length);

/**
 * Second-granular, no timezone — the venue's own precision, and the reason `observedAt`
 * exists rather than the event envelope's date-only `asOf`. Both separator styles are
 * accepted because a rendered table is formatted for a human, not for us.
 */
const TIMESTAMP = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})$/;

/**
 * A field the venue rendered as BLANK. `-- / --` is the observed spelling; a bare `--`,
 * an empty cell or any other run of dashes and slashes is the same fact drawn slightly
 * differently. All of them mean "there is no value here" and become `null`.
 */
function isBlankCell(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === "" || /^[-\s/]+$/.test(trimmed);
}

/**
 * Split one CSV line, honoring double quotes so a quoted thousands separator does not
 * shear a field in two. Multi-line quoted fields are NOT supported and do not occur in
 * this export; a torn quote yields the wrong field count and is refused as malformed
 * rather than silently mis-columned.
 */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

function normalizeTimestamp(value: string): string | undefined {
  const match = TIMESTAMP.exec(value.trim());
  if (!match) {
    return undefined;
  }
  const [, year = "", month = "", day = "", hour = "", minute = "", second = ""] = match;
  const pad = (part: string) => part.padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${minute}:${second}`;
}

/**
 * Normalize the pair to a separator-free upper-case symbol and split off its quote.
 * `XYZ/USDT`, `XYZ-USDT` and `XYZUSDT` are ONE symbol — the separator is styling, and an
 * id that changed with it would re-identify the whole book the day the venue restyled.
 */
function readPair(value: string): { symbol: string; currency: Currency } | undefined {
  const symbol = value.trim().toUpperCase().replace(/[/\-_\s]/g, "");
  const quote = QUOTE_TOKENS.find((token) => symbol.endsWith(token) && symbol.length > token.length);
  const currency = quote ? QUOTE_CURRENCIES[quote] : undefined;
  return currency ? { symbol, currency } : undefined;
}

function readSide(value: string): OrderSide | undefined {
  const side = value.trim().toLowerCase();
  return side === "buy" || side === "sell" ? side : undefined;
}

/** One open order as the venue showed it, plus the identity synthesized for it. */
export interface BitgetOpenOrder extends ObservedOpenOrder {
  timeInForce: string;
  orderType: string;
  /** `null` when the venue rendered the `-- / --` sentinel — never that string. */
  triggerPrice: number | null;
  /**
   * The venue's CUMULATIVE filled quantity for this row; may be `0`. This — not a status
   * word — is what decides whether the row still claims anything: a row is admitted when
   * `quantity − filledQuantity > 0` and skipped as `not-resting` when it is not. It is
   * carried onto the placement record's `observedFilledQuantity` (`./ingest.js`), so the
   * rung rests for its REMAINDER rather than for its full size (#173).
   */
  filledQuantity: number;
  totalQuantity: number;
}

export type BitgetRowProblem =
  | "malformed"
  | "unknown-status"
  /** The venue shows nothing still claimed — correctly out of the resting book (#173). */
  | "not-resting"
  | "unknown-quote-currency";

/**
 * Does this problem leave a rung UNWEIGHED — a row that might still be claiming capital
 * where we cannot say how much? That is the whole rule, and it lives here beside the
 * taxonomy it reads rather than at the consumer, so a fifth `BitgetRowProblem` cannot be
 * added without deciding which side of the alarm it falls on (#184).
 *
 * `unknown-status` and `unknown-quote-currency` fail the test on the SAFE side: we do not
 * know those rows are not resting, so they count. `not-resting` is excluded because it is
 * the one class where we DO know — the parser reached a positive finding about the row's
 * encumbrance, and the finding is zero. Nothing is left claimed, so no committed sum is
 * missing it and no `available` figure reads high because of it. Counting it would fire a
 * money-direction alarm on the ordinary event of a rung filling between the operator's
 * export and their import.
 *
 * The switch is EXHAUSTIVE with no `default` on purpose: a new member must fail
 * `pnpm typecheck` rather than silently default into or out of the alarm.
 */
export function leavesRungUnweighed(problem: BitgetRowProblem): boolean {
  switch (problem) {
    case "malformed":
    case "unknown-status":
    case "unknown-quote-currency":
      return true;
    case "not-resting":
      return false;
  }
}

/** One row that did not become an order, reported rather than swallowed. */
export interface BitgetRowSkip {
  /** 1-based line number in the file, so the operator can go look at it. */
  line: number;
  problem: BitgetRowProblem;
  message: string;
}

export type BitgetOpenOrdersParse =
  | { status: "ok"; orders: BitgetOpenOrder[]; skips: BitgetRowSkip[] }
  | { status: "unrecognized-header"; message: string };

function skip(line: number, problem: BitgetRowProblem, message: string): BitgetRowSkip {
  return { line, problem, message };
}

/**
 * Parse a Bitget open-orders export into observed orders with deterministic ids.
 *
 * TOTAL: it never throws. A header that is not the known 14 columns refuses the whole
 * file — the caller is holding some other export, and half-reading it would be worse
 * than reading none of it. Past the header, a bad ROW is skipped and reported while the
 * rest parse, because one unreadable rung must not cost the operator the other seven.
 */
export function parseBitgetOpenOrdersCsv(csv: string): BitgetOpenOrdersParse {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/);
  const headerLine = lines.find((line) => line.trim() !== "");
  if (headerLine === undefined) {
    return { status: "unrecognized-header", message: "the file is empty" };
  }

  const header = splitCsvLine(headerLine).map((column) => column.trim().toLowerCase());
  const expected = [...BITGET_OPEN_ORDERS_HEADER];
  if (header.length !== expected.length || header.some((column, index) => column !== expected[index])) {
    return {
      status: "unrecognized-header",
      message:
        `expected the ${expected.length}-column open-orders header ` +
        `[${expected.join(", ")}], got [${header.join(", ")}]`,
    };
  }

  const column = (fields: string[], name: (typeof BITGET_OPEN_ORDERS_HEADER)[number]): string =>
    fields[expected.indexOf(name)] ?? "";

  const orders: BitgetOpenOrder[] = [];
  const skips: BitgetRowSkip[] = [];
  const headerIndex = lines.indexOf(headerLine);

  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const raw = lines[index] ?? "";
    if (raw.trim() === "") {
      continue;
    }
    const lineNumber = index + 1;
    const fields = splitCsvLine(raw);
    if (fields.length !== expected.length) {
      skips.push(
        skip(lineNumber, "malformed", `expected ${expected.length} columns, got ${fields.length}`),
      );
      continue;
    }

    // THE ADMISSION GATE (#173), AND IT RUNS FIRST. A row still claims capital exactly
    // when something is left unfilled, and the two quantity columns say so without help
    // from the status word — so they are read BEFORE the vocabulary is consulted. Asking
    // the word first made the rule a lie for the one ordinary event #184 exists for: a
    // rung that fills between the operator's export and their import prints a terminal
    // word this reader does not know, and refusing it there raised a money-direction
    // alarm about a row we can in fact weigh, and weigh at zero.
    //
    // AUTHORITATIVE. `order_value` is read past and dropped: it drifts by cents against
    // this column and must never be the thing anything reconciles on.
    const quantity = canonicalDecimal(column(fields, "quantity"));
    if (quantity === undefined || Number(quantity) <= 0) {
      skips.push(skip(lineNumber, "malformed", "quantity must be a positive decimal"));
      continue;
    }

    const filledQuantity = canonicalDecimal(column(fields, "filled_quantity"));
    if (filledQuantity === undefined || Number(filledQuantity) < 0) {
      skips.push(skip(lineNumber, "malformed", "filled_quantity must be a non-negative decimal"));
      continue;
    }

    // Nothing left is not a claim: it is correctly out of the resting book, whatever the
    // venue printed, and reported so it is not silent.
    const remainder = Number(quantity) - Number(filledQuantity);
    if (remainder <= 0) {
      skips.push(
        skip(
          lineNumber,
          "not-resting",
          `the venue shows ${filledQuantity} of ${quantity} filled, so nothing is still ` +
            `claimed; this row is not a resting order`,
        ),
      );
      continue;
    }

    // VOCABULARY CHECK, NOT AN ADMISSION GATE. Reached only by a row that still has a
    // remainder open — which is exactly the row whose status we cannot infer from the
    // quantities. A word this reader does not know is refused HERE, because a remainder
    // under an unrecognized word could be resting or could be dead, and guessing means a
    // claim on capital the venue never confirmed. The vocabulary is deliberately NOT
    // widened to absorb terminal words: the remainder above already answers those.
    const status = normalizeStatus(column(fields, "status"));
    const known =
      status === BITGET_RESTING_STATUS ||
      (BITGET_PARTIAL_STATUSES as readonly string[]).includes(status);
    if (!known) {
      skips.push(
        skip(
          lineNumber,
          "unknown-status",
          `status ${JSON.stringify(column(fields, "status").trim())} is outside the observed ` +
            `vocabulary; ${JSON.stringify(BITGET_RESTING_STATUS)} and ` +
            `[${BITGET_PARTIAL_STATUSES.join(", ")}] are the words known to mean a row that ` +
            `may still be resting`,
        ),
      );
      continue;
    }

    const observedAt = normalizeTimestamp(column(fields, "timestamp"));
    if (observedAt === undefined) {
      skips.push(skip(lineNumber, "malformed", "timestamp must be a second-granular local stamp"));
      continue;
    }

    const pair = readPair(column(fields, "pair"));
    if (pair === undefined) {
      skips.push(
        skip(
          lineNumber,
          "unknown-quote-currency",
          `pair ${JSON.stringify(column(fields, "pair").trim())} does not end in a quote ` +
            `currency this build prices`,
        ),
      );
      continue;
    }

    const side = readSide(column(fields, "side"));
    if (side === undefined) {
      skips.push(skip(lineNumber, "malformed", "side must be Buy or Sell"));
      continue;
    }

    const price = canonicalDecimal(column(fields, "price"));
    if (price === undefined || Number(price) <= 0) {
      skips.push(skip(lineNumber, "malformed", "price must be a positive decimal"));
      continue;
    }

    const totalQuantity = canonicalDecimal(column(fields, "total_quantity"));
    if (totalQuantity === undefined || Number(totalQuantity) <= 0) {
      skips.push(skip(lineNumber, "malformed", "total_quantity must be a positive decimal"));
      continue;
    }

    const triggerCell = column(fields, "trigger_price");
    let triggerPrice: number | null = null;
    if (!isBlankCell(triggerCell)) {
      const trigger = canonicalDecimal(triggerCell);
      if (trigger === undefined) {
        skips.push(
          skip(lineNumber, "malformed", "trigger_price must be a decimal or the blank sentinel"),
        );
        continue;
      }
      triggerPrice = Number(trigger);
    }

    orders.push({
      id: synthesizeOrderId({ venue: VENUE, symbol: pair.symbol, side, price, observedAt }),
      observedAt,
      currency: pair.currency,
      symbol: pair.symbol,
      side,
      price: Number(price),
      quantity: Number(quantity),
      timeInForce: column(fields, "time_in_force").trim(),
      orderType: column(fields, "order_type").trim(),
      triggerPrice,
      filledQuantity: Number(filledQuantity),
      totalQuantity: Number(totalQuantity),
    });
  }

  return { status: "ok", orders, skips };
}
