/**
 * The IO SHELL for importing a Bitget open-orders export into the `orders.jsonl`
 * sidecar — the runtime half of the ADR-001 split. Every decision about what the export
 * MEANS is pure and lives in `@numisma/engine` (`parseBitgetOpenOrdersCsv`,
 * `buildOrderPlacedRecords`, `checkFundingCoverage`); this file only reads the file,
 * asks the operator the one question, and writes through `@numisma/preferences`.
 *
 * Every IO dependency is injected, so the whole flow — including the prompt and the
 * `O1` reject — is testable without a terminal, a real export or the real data dir.
 *
 * THE ORDERING IS THE CONTRACT: parse → load the sidecar → prompt → check coverage →
 * append. The coverage check is the LAST thing before the only write, and every refusal
 * before it returns having written nothing at all. `orders.jsonl` is append-only, so a
 * wrong claim written here is not edited away later — it costs a compensating line
 * forever, and that asymmetry is why the refusals are loud and total rather than
 * warnings the operator can walk past.
 */
import {
  buildOrderPlacedRecords,
  checkFundingCoverage,
  parseBitgetOpenOrdersCsv,
  pickRestingOrdersAsOf,
  type BitgetOpenOrder,
  type BitgetRowSkip,
  type OrderPlacedRecord,
  type OrderRecord,
  type FundReviewData,
} from "@numisma/engine";
import type { OrdersLoad } from "@numisma/preferences";

/** Everything this flow touches that is not a pure function, in one injectable bag. */
export interface OrdersImportIo {
  /** Read the venue's export. Rejects (throws) if it is unreadable; we catch it. */
  readExport: (path: string) => Promise<string>;
  /** The sidecar's resolved path — resolved by the caller, never by this flow. */
  ordersPath: string;
  loadOrders: (path: string) => Promise<OrdersLoad>;
  appendOrders: (path: string, records: OrderRecord[]) => Promise<void>;
  /**
   * The FOLDED fund review — the whole thing, not a reserve list derived from it.
   *
   * This used to be `reserveBalances: () => Promise<ReserveBalance[]>`, and the CLI
   * satisfied it with `data.reserves.map(...)` — every reserve the fold emitted, with no
   * currency. That mapping was the bug (#172): it handed the guard reserves the rendered
   * report refuses to place, so a ladder could be FUNDABLE at import and UNPLACEABLE in
   * the report. The admission policy belongs to the engine, so the fund goes over
   * whole and this shell derives nothing.
   */
  fundReview: () => Promise<FundReviewData>;
  /** Ask the operator one question; the answer is returned trimmed by the caller. */
  ask: (question: string) => Promise<string>;
  out: (message: string) => void;
  err: (message: string) => void;
}

export type OrdersImportRejection =
  | "unreadable-export"
  | "unrecognized-header"
  | "no-orders"
  | "unreadable-sidecar"
  | "unreadable-sidecar-lines"
  | "no-reserve-declared"
  | "unknown-reserve"
  | "currency-mismatch"
  | "over-committed";

export type OrdersImportOutcome =
  | {
      status: "imported";
      /** Lines actually appended. ZERO when the same export is imported twice. */
      appended: number;
      /** Rungs already in the sidecar under the same synthesized id. */
      alreadyKnown: number;
      skips: BitgetRowSkip[];
    }
  | { status: "rejected"; reason: OrdersImportRejection; message: string };

export interface OrdersImportOptions {
  csvPath: string;
  io: OrdersImportIo;
}

function reject(
  io: OrdersImportIo,
  reason: OrdersImportRejection,
  message: string,
): OrdersImportOutcome {
  // LOUD, and on the error channel: nothing has been written, and the operator must not
  // be able to mistake a refusal for a quiet no-op.
  io.err(`REFUSED — ${message}\nNothing was written to ${io.ordersPath}.`);
  return { status: "rejected", reason, message };
}

/** How one rung is shown when the operator asks to override it. */
function describe(order: BitgetOpenOrder): string {
  return `${order.symbol} ${order.side} ${order.quantity} @ ${order.price} (${order.observedAt})`;
}

function isAffirmative(answer: string): boolean {
  const normalized = answer.trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
}

/**
 * Prompt for the ONE declared field.
 *
 * Once per BATCH, then overridable per order — the granularity is the venue's own
 * argument: a ladder is homogeneous by construction, so eight rungs is one decision
 * copied eight times, and asking eight times is eight chances to disagree with yourself.
 * The per-order pass is opt-in and defaults to the batch answer on a blank line, so the
 * homogeneous case costs exactly one keystroke and the dissenting rung is still
 * expressible.
 */
async function declareFunding(
  io: OrdersImportIo,
  orders: readonly BitgetOpenOrder[],
): Promise<{ fundingReserveId: string; overrides: Record<string, string> } | undefined> {
  const batch = (await io.ask("Funding reserve for this batch: ")).trim();
  if (batch === "") {
    return undefined;
  }

  const overrides: Record<string, string> = {};
  const wantsOverrides = isAffirmative(
    await io.ask(`Override the funding reserve for any individual order? [y/N] `),
  );
  if (!wantsOverrides) {
    return { fundingReserveId: batch, overrides };
  }

  for (const order of orders) {
    const answer = (await io.ask(`  ${describe(order)} [${batch}]: `)).trim();
    if (answer !== "" && answer !== batch) {
      overrides[order.id] = answer;
    }
  }
  return { fundingReserveId: batch, overrides };
}

/**
 * Import one open-orders export into the sidecar, or refuse and write nothing.
 *
 * Idempotent by construction, not by a special case: order ids are synthesized from
 * `(pair, side, price, submittedAt)`, so re-importing an unchanged export produces the
 * ids already on file and appends ZERO lines. By the same mechanism a RE-PRICED rung
 * needs no rule — its id differs, so it arrives as a new claim while the old one simply
 * stops being observed. There is no re-price branch anywhere in this flow, and if one
 * ever appears the identity is wrong.
 */
export async function importBitgetOpenOrders(
  options: OrdersImportOptions,
): Promise<OrdersImportOutcome> {
  const { csvPath, io } = options;

  let csv: string;
  try {
    csv = await io.readExport(csvPath);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return reject(io, "unreadable-export", `could not read ${csvPath}: ${detail}`);
  }

  const parsed = parseBitgetOpenOrdersCsv(csv);
  if (parsed.status !== "ok") {
    // Refusing the whole file is the point: a header we do not know means the operator
    // is holding some OTHER export (a fills or holdings CSV), and half-reading it as an
    // order book would attribute capital against columns that do not mean what we think.
    return reject(io, "unrecognized-header", `${csvPath} is not an open-orders export — ${parsed.message}`);
  }

  for (const skip of parsed.skips) {
    io.err(`${csvPath}:${skip.line} skipped — ${skip.message}`);
  }
  if (parsed.orders.length === 0) {
    return reject(io, "no-orders", `${csvPath} contains no resting orders this build can read`);
  }

  const existing = await io.loadOrders(io.ordersPath);
  if (existing.status === "unreadable") {
    // "There are no orders" and "I could not read the orders" are opposite facts about
    // committed capital. Appending over the second would compute coverage against a
    // book we cannot see.
    return reject(io, "unreadable-sidecar", `could not read ${io.ordersPath}: ${existing.message}`);
  }
  if (existing.status === "loaded" && existing.skips.length > 0) {
    return reject(
      io,
      "unreadable-sidecar-lines",
      `${io.ordersPath} has ${existing.skips.length} line(s) this build cannot read, so the ` +
        `committed sum would be computed over a partially-read book`,
    );
  }
  const existingRecords: OrderRecord[] = existing.status === "loaded" ? existing.records : [];

  const declaration = await declareFunding(io, parsed.orders);
  if (declaration === undefined) {
    return reject(io, "no-reserve-declared", "no funding reserve was declared for this batch");
  }

  const records = buildOrderPlacedRecords(parsed.orders, declaration);

  // `O1`. Coverage is checked over the WHOLE resting book — what is already on file plus
  // this batch — because a reserve funds every claim against it, not one import's slice.
  // The selector dedupes by id, so a re-import does not double-count the same rung.
  const resting = pickRestingOrdersAsOf([...existingRecords, ...records]);
  const coverage = checkFundingCoverage(resting, await io.fundReview());
  if (coverage.status === "unknown-reserve") {
    return reject(
      io,
      "unknown-reserve",
      `no such fundable reserve: ${coverage.fundingReserveIds.join(", ")}. A reserve the ` +
        `fold excluded — paper execution mode, an unsupported currency, a dangling ` +
        `account reference — cannot fund a live order either, and the available-capital ` +
        `report would not be able to place it`,
    );
  }
  if (coverage.status === "currency-mismatch") {
    // Cross-currency funding is not designed; it is refused, here and in the report.
    // Accepting it would sum a quote-denominated committed into a native balance and
    // report free capital that does not exist.
    const detail = coverage.rungs
      .map((rung) => `${rung.orderId} (${rung.currency}) against ${rung.fundingReserveId}`)
      .join("; ");
    return reject(
      io,
      "currency-mismatch",
      `these rungs are quoted in a currency their declared reserve does not hold — ` +
        `${detail}. Cross-currency funding is not supported; fix the declaration`,
    );
  }
  if (coverage.status === "over-committed") {
    const detail = coverage.shortfalls
      .map(
        (shortfall) =>
          `${shortfall.fundingReserveId}: committed ${shortfall.committed} against a balance ` +
          `of ${shortfall.balance} (slack ${shortfall.slack})`,
      )
      .join("; ");
    return reject(
      io,
      "over-committed",
      `the declared reserve cannot fund this book — ${detail}. The venue would not have ` +
        `accepted these orders against that balance, so the ATTRIBUTION is wrong; fix the ` +
        `declaration rather than the file`,
    );
  }

  const known = new Set(existingRecords.map((record) => record.id));
  const fresh: OrderPlacedRecord[] = records.filter((record) => !known.has(record.id));
  await io.appendOrders(io.ordersPath, fresh);

  io.out(
    `Imported ${csvPath}: ${fresh.length} order(s) appended, ` +
      `${records.length - fresh.length} already known` +
      (parsed.skips.length > 0 ? `, ${parsed.skips.length} row(s) skipped` : "") +
      `.\n`,
  );

  return {
    status: "imported",
    appended: fresh.length,
    alreadyKnown: records.length - fresh.length,
    skips: parsed.skips,
  };
}
