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
 * THE ORDERING IS THE CONTRACT: parse → merge id collisions → load the sidecar → refuse
 * changed claims → prompt → check coverage → append. The coverage check is the LAST thing before the only write, and every refusal
 * before it returns having written nothing at all. `orders.jsonl` is append-only, so a
 * wrong claim written here is not edited away later — it costs a compensating line
 * forever, and that asymmetry is why the refusals are loud and total rather than
 * warnings the operator can walk past.
 */
import {
  buildOrderPlacedRecords,
  checkFundingCoverage,
  detectChangedClaims,
  mergeCollidingClaims,
  parseBitgetOpenOrdersCsv,
  pickRestingOrdersAsOf,
  type BitgetOpenOrder,
  type BitgetRowSkip,
  type MergedOrderClaim,
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
  /**
   * A row names a claim already on file but says something DIFFERENT about it (#174).
   *
   * Refused rather than recorded, and this is the ONE place the "proceed with the
   * arithmetic" reasoning behind the within-batch merge does not extend. Recording a
   * change needs a verb this build does not have: a second `orderPlaced` line is ignored
   * by `pickRestingOrdersAsOf` by construction (that guard is what makes re-import
   * idempotent), and an observation verb is a later design that must not be pre-empted
   * by one invented here, in an append-only file, to get past this import.
   */
  | "changed-claim"
  | "unknown-reserve"
  | "currency-mismatch"
  | "over-committed"
  /**
   * The sidecar append itself failed (#177 item 5). `appendOrders` builds a full next
   * image and renames, so a failure means NOTHING landed and the flow's own refusal
   * contract is the honest report — not a bare stack out of the CLI's outer catch.
   */
  | "write-failed";

/** What an import that WROTE reports, in the two shapes it can honestly take. */
interface OrdersImportWrite {
  /** Lines actually appended. ZERO when the same export is imported twice. */
  appended: number;
  /**
   * Rungs already in the sidecar under the same synthesized id AND saying the same
   * thing about it — the id components plus `quantity` and the observed partial. A
   * row that differs never reaches this count; it refuses the batch as
   * `changed-claim` (#174).
   */
  alreadyKnown: number;
  /** The export rows this build could not read. EMPTY on `imported`, by construction. */
  skips: BitgetRowSkip[];
}

export type OrdersImportOutcome =
  /** Every row of the export was read. The unqualified success, and the only one. */
  | ({ status: "imported" } & OrdersImportWrite)
  /**
   * The readable rungs were written and at least one row was NOT read (`D3`, #177).
   *
   * A DISTINCT MEMBER, not `imported` carrying a non-empty `skips`. The risk is real —
   * an unread rung is `committed` that nobody counted, so `available` reads HIGH, the
   * direction that costs money — and a shape that forces every reader to open a second
   * field to discover the first was qualified is a type that lies to the reader who does
   * not. It is still a SUCCESS: lines were written, and the CLI exits 0 (`D3`).
   */
  | ({ status: "imported-partial" } & OrdersImportWrite)
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

/**
 * The operator-facing line for one merged claim — FIRST-CLASS output, not an aside.
 *
 * Two rows the venue rendered under one id have been summed, and the operator is owed
 * the whole arithmetic: which rung, at what second, both sizes, the total that will be
 * written, and the remedy if the two were meant to stay distinct claims.
 */
function describeMerge(merge: MergedOrderClaim): string {
  return (
    `MERGED — ${merge.symbol} ${merge.side} at ${merge.price}, submitted ${merge.observedAt}: ` +
    `${merge.quantities.length} rows sharing one id (${merge.quantities.join(" + ")}) were ` +
    `summed into ONE claim of ${merge.mergedQuantity}. The venue's export carries no order ` +
    `id, and these rows agree on every field identity is built from, so the sum is the only ` +
    `reading that neither invents a second claim nor frees committed capital. To keep two ` +
    `rungs distinct, re-place one a tick apart so their prices differ.`
  );
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

  // ONE ID, ONE CLAIM (#174). Rows of this batch colliding on the synthesized id are
  // SUMMED before anything else sees them, so the guard below weighs the whole claim and
  // the append writes one line for it. Told to the operator on the normal channel: this
  // is arithmetic that was applied, not a warning about something skipped.
  const { orders, merges } = mergeCollidingClaims(parsed.orders);
  for (const merge of merges) {
    io.out(`${describeMerge(merge)}\n`);
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

  // A row that names a known claim and DISAGREES with it is refused BEFORE the prompt and
  // before the guard — the guard would read the claim's size off the file, not off this
  // row (a repeat placement is ignored by the selector), so proceeding would check
  // coverage against a book the export no longer describes.
  const changed = detectChangedClaims(
    existingRecords.filter(
      (record): record is OrderPlacedRecord => record.kind === "orderPlaced",
    ),
    orders,
  );
  if (changed.length > 0) {
    const detail = changed
      .map(
        (claim) =>
          `${claim.id} (` +
          claim.differences
            .map((difference) => `${difference.field} ${difference.known} → ${difference.observed}`)
            .join(", ") +
          `)`,
      )
      .join("; ");
    return reject(
      io,
      "changed-claim",
      `${csvPath} re-states a claim already on file with different terms — ${detail}. An id ` +
        `identifies exactly one claim, and this build has no verb for "the claim changed": a ` +
        `second placement line would be ignored by the selector, and calling this row ALREADY ` +
        `KNOWN would leave the wrong size committed. Cancel the rung at the venue and record ` +
        `the cancellation, or re-place it at a different price so it arrives as a new claim`,
    );
  }

  const declaration = await declareFunding(io, orders);
  if (declaration === undefined) {
    return reject(io, "no-reserve-declared", "no funding reserve was declared for this batch");
  }

  const records = buildOrderPlacedRecords(orders, declaration);

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
  try {
    await io.appendOrders(io.ordersPath, fresh);
  } catch (error) {
    // The write is a temp file plus a rename, so a failure here landed NOTHING — the
    // refusal contract's "Nothing was written" is literally true, and the operator gets
    // it instead of a stack trace from the CLI's outer catch (#177 item 5).
    const detail = error instanceof Error ? error.message : String(error);
    return reject(io, "write-failed", `could not append to ${io.ordersPath}: ${detail}`);
  }

  const counts =
    `${fresh.length} order(s) appended, ${records.length - fresh.length} already known`;
  if (parsed.skips.length === 0) {
    io.out(`Imported ${csvPath}: ${counts}.\n`);
    return {
      status: "imported",
      appended: fresh.length,
      alreadyKnown: records.length - fresh.length,
      skips: parsed.skips,
    };
  }

  // THE GAP OPENS THE LINE, AND IN MONEY TERMS (`D3`, #177). It used to be a suffix after
  // two success numbers — `..., 1 row(s) skipped.` — in exactly the position an operator
  // skims past. An unread row is a rung resting at the venue that no committed sum
  // includes, so the figure this import feeds reads HIGH; naming that direction is what
  // makes it a risk rather than a statistic.
  io.out(
    `INCOMPLETE — ${parsed.skips.length} row(s) of ${csvPath} could not be read, so that ` +
      `many rung(s) resting at the venue are NOT counted as committed and available reads ` +
      `HIGH by whatever they encumber. Imported ${csvPath}: ${counts}. Re-export and ` +
      `re-import to pick the missing rung(s) up; the reasons are on the error channel above.\n`,
  );

  return {
    status: "imported-partial",
    appended: fresh.length,
    alreadyKnown: records.length - fresh.length,
    skips: parsed.skips,
  };
}
