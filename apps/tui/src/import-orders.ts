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
  leavesRungUnweighed,
  mergeCollidingClaims,
  parseBitgetOpenOrdersCsv,
  pickRestingOrdersAsOf,
  type BitgetOpenOrder,
  type BitgetRowSkip,
  type ChangedClaim,
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
   * A row names a claim already on file but states a different `quantity` for it (#174)
   * — the venue amended the size, or the file and the venue disagree about it.
   *
   * Refused rather than recorded, and this is the ONE place the "proceed with the
   * arithmetic" reasoning behind the within-batch merge does not extend. Recording a
   * change needs a verb this build does not have: a second `orderPlaced` line is ignored
   * by `pickRestingOrdersAsOf` by construction (that guard is what makes re-import
   * idempotent), and an observation verb is a later design that must not be pre-empted
   * by one invented here, in an append-only file, to get past this import.
   *
   * NARROWED TO `quantity` BY #199, and the DIRECTION is the whole reason. Refusing the
   * batch never repaired the stale line — nothing is written on a refusal — so what the
   * refusal actually protects is the funding guard's reading of the OTHER rungs, which
   * it weighs off the file. A `quantity` the file states LOW leaves the guard more
   * PERMISSIVE than reality, so it could admit a batch the reserve cannot fund: #174's
   * own hazard, and it stays a total refusal. A partial the venue has since restated
   * leaves the file stating the encumbrance HIGH, which is the safe direction, and is
   * handled per rung instead — see {@link RestatedPartial}. The argument for refusing
   * here is about which way the leftover staleness points, not about the change itself.
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

/**
 * A rung the venue has filled FURTHER since its placement line was written (#199).
 *
 * The id is synthesized from the SUBMISSION stamp, so a rung that fills between two
 * exports comes back under the same id carrying a larger `filled_quantity`. That is not
 * an amendment and not a re-sighting — it is the ordinary life of a resting ladder — but
 * the placement line cannot be rewritten (`orders.jsonl` is append-only and a second
 * placement line is ignored by the selector), so the file keeps the OLDER partial until
 * the observation verb #181 designs exists.
 *
 * Carrying the stale figure is safe in a way an amended `quantity` is not, and only
 * because of the direction: the file believes MORE is still resting than actually is, so
 * the encumbrance it computes is too large. That can refuse a batch the reserve could
 * have funded; it can never admit one it cannot. So the rung is skipped and the rest of
 * the export imports normally, rather than the whole batch being refused over it.
 *
 * A partial moving DOWN is excluded deliberately — it points the other way, and it is a
 * venue contradiction besides (a fill does not un-fill). It stays a `changed-claim`.
 */
export interface RestatedPartial {
  id: string;
  /** The partial the placement line on file records. */
  known: number;
  /** The larger partial the venue's export now shows. */
  observed: number;
}

/** What an import that WROTE reports, in the two shapes it can honestly take. */
interface OrdersImportWrite {
  /** Lines actually appended. ZERO when the same export is imported twice. */
  appended: number;
  /**
   * Rungs already in the sidecar under the same synthesized id AND saying the same
   * thing about it — the id components plus `quantity` and the observed partial.
   *
   * A row that differs NEVER reaches this count, in either of the two ways it can
   * differ: a changed `quantity` refuses the whole batch as `changed-claim` (#174), and
   * a restated partial is skipped per rung and reported in `restated` (#199). Calling
   * either one "already known" is the silence #174 named — it reports "nothing to do"
   * about a rung the file now describes wrongly.
   */
  alreadyKnown: number;
  /**
   * The export rows this build could not read. EMPTY on `imported`, by construction —
   * one of the TWO invariants that status now carries, the sibling being `restated`.
   */
  skips: BitgetRowSkip[];
  /**
   * The rungs skipped because the venue has restated their partial (#199). EMPTY on
   * `imported`, by construction, exactly as `skips` is.
   *
   * A SECOND FIELD RATHER THAN A THIRD STATUS, and that is the load-bearing choice: an
   * export can carry an unreadable row AND a restated rung at once, and a sum type can
   * say only one of those, so a third member would drop one qualification silently. Two
   * fields under one qualified status say both.
   */
  restated: RestatedPartial[];
}

export type OrdersImportOutcome =
  /**
   * Every row of the export was read AND nothing was restated. The unqualified success,
   * and the only one — its invariant STRENGTHENED by #199 rather than widened, so the
   * status keeps meaning what a reader who never opens a second field assumes it means.
   */
  | ({ status: "imported" } & OrdersImportWrite)
  /**
   * Lines were written, and SOMETHING ABOUT THE EXPORT WAS QUALIFIED (`D3`, #177; #199).
   *
   * A DISTINCT MEMBER, not `imported` carrying a non-empty field. A shape that forces
   * every reader to open a second field to discover the first was qualified is a type
   * that lies to the reader who does not. It is still a SUCCESS: lines were written, and
   * the CLI exits 0 (`D3`).
   *
   * TWO qualifications reach it, with OPPOSITE money directions, each carrying its own
   * field and printing its own operator line:
   *
   * - `skips` — a row was not read, so a rung resting at the venue is `committed` that
   *   nobody counted and `available` reads HIGH.
   * - `restated` — a rung was read perfectly and its partial on file is stale, so the
   *   encumbrance is over-stated: `committed` reads HIGH and `available` reads LOW.
   *
   * That opposition is why `restated` could not reuse `skips`: `leavesRungUnweighed` is
   * a predicate over PARSER problems, and a restated rung is not unweighed — it is
   * weighed, and weighed high.
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
 * Split the claims that disagree with the file into the ones that refuse the batch and
 * the ones that cost their own rung — THE POLICY DECISION of #199, and the reason it
 * lives here rather than in `import-orders-cli.ts`.
 *
 * Deciding which class a difference falls in is admission policy, and the wiring says so
 * in its own words after #172 bit it for exactly this: "Admission is the engine's policy,
 * not this wiring's." A CLI that filtered these out would be re-deciding, from the shell,
 * something the flow is supposed to own.
 *
 * `quantity` decides whenever it is present. A claim differing in BOTH fields at once is
 * refused, not skipped: the two point opposite ways, and a claim carrying the dangerous
 * one is not made safe by also carrying the safe one.
 */
function partitionChangedClaims(changed: readonly ChangedClaim[]): {
  amended: ChangedClaim[];
  restated: RestatedPartial[];
} {
  const amended: ChangedClaim[] = [];
  const restated: RestatedPartial[] = [];

  for (const claim of changed) {
    if (claim.differences.some((difference) => difference.field === "quantity")) {
      amended.push(claim);
      continue;
    }
    const fill = claim.differences.find(
      (difference) => difference.field === "observedFilledQuantity",
    );
    // Unreachable today: `detectChangedClaims` never emits an empty `differences`, and
    // those two are its only fields. Guarded rather than asserted so that a THIRD field
    // added there — the descriptors its own KNOWN LIMIT contemplates persisting — lands
    // in the REFUSAL class by default instead of silently becoming a per-rung skip.
    if (fill === undefined || fill.observed < fill.known) {
      amended.push(claim);
      continue;
    }
    restated.push({ id: claim.id, known: fill.known, observed: fill.observed });
  }

  return { amended, restated };
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
  const { amended, restated } = partitionChangedClaims(changed);
  if (amended.length > 0) {
    const detail = amended
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
      `${csvPath} re-states a claim already on file with a different SIZE — ${detail}. An id ` +
        `identifies exactly one claim, and this build has no verb for "the claim changed": a ` +
        `second placement line would be ignored by the selector, and calling this row ALREADY ` +
        `KNOWN would leave the wrong size committed — under-stating it, so the guard would ` +
        `admit a batch the reserve cannot fund. Cancel the rung at the venue and record ` +
        `the cancellation, or re-place it at a different price so it arrives as a new claim`,
    );
  }

  // THE PER-RUNG SKIP (#199). The restated rung is dropped from THIS batch and its line
  // on file is left exactly as it was — so the guard below still weighs it, at the older
  // and LARGER remainder, which is the conservative reading. Everything after this point
  // sees `admitted`: the rung is not prompted for, not built into a record, and not
  // counted as `alreadyKnown`, because it is not a re-sighting.
  const restatedIds = new Set(restated.map((claim) => claim.id));
  const admitted = orders.filter((order) => !restatedIds.has(order.id));

  const declaration = await declareFunding(io, admitted);
  if (declaration === undefined) {
    return reject(io, "no-reserve-declared", "no funding reserve was declared for this batch");
  }

  const records = buildOrderPlacedRecords(admitted, declaration);

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
  // NOT `parsed.skips.length` (#184). `skips` is heterogeneous, and a `not-resting` row
  // was read COMPLETELY — the parser's finding about it is that nothing is still claimed.
  // The gap this line warns about is rungs we could not weigh, so both the discrimination
  // and the count below run through the engine's predicate rather than the raw total.
  // `outcome.skips` still carries every skip and stderr still reports every one of them.
  const unweighed = parsed.skips.filter((entry) => leavesRungUnweighed(entry.problem));

  const write = {
    appended: fresh.length,
    alreadyKnown: records.length - fresh.length,
    skips: parsed.skips,
    restated,
  };

  if (unweighed.length === 0 && restated.length === 0) {
    io.out(`Imported ${csvPath}: ${counts}.\n`);
    return { status: "imported", ...write };
  }

  // EVERY QUALIFICATION GETS ITS OWN LINE, EACH OPENING ON THE GAP AND NAMING ITS OWN
  // MONEY DIRECTION (`D3`, #177; #199). The counts follow all of them, once — they used
  // to be the whole line, with the qualification a suffix (`..., 1 row(s) skipped.`) in
  // exactly the position an operator skims past. An export qualified BOTH ways prints
  // BOTH lines; that case is why this is two fields and not a third status.
  //
  // Unread rows lead, because they are the qualification we know least about: a restated
  // rung was read perfectly and we can state its figures, an unread one we cannot.
  const qualifications: string[] = [];

  if (unweighed.length > 0) {
    qualifications.push(
      `INCOMPLETE — ${unweighed.length} row(s) of ${csvPath} could not be read, so that ` +
        `many rung(s) resting at the venue are NOT counted as committed and available reads ` +
        `HIGH by whatever they encumber. Re-export and re-import to pick the missing ` +
        `rung(s) up; the reasons are on the error channel above.`,
    );
  }

  if (restated.length > 0) {
    const detail = restated
      .map((claim) => `${claim.id} (filled ${claim.known} → ${claim.observed})`)
      .join("; ");
    qualifications.push(
      `RESTATED — ${restated.length} rung(s) of ${csvPath} have filled FURTHER at the ` +
        `venue since this file recorded them — ${detail} — and were SKIPPED; every other ` +
        `rung imported normally. Their lines on file still read the OLDER partial, so they ` +
        `encumber MORE than the venue actually holds: committed reads HIGH and available ` +
        `reads LOW. That is the safe direction — it can refuse a batch you could fund, ` +
        `never fund one you cannot — but it is not free, and recording the restatement ` +
        `needs an observation verb this build does not have. This line REPRINTS on every ` +
        `import until the rung fills out or is cancelled at the venue.`,
    );
  }

  io.out(`${qualifications.join("\n")}\nImported ${csvPath}: ${counts}.\n`);

  return { status: "imported-partial", ...write };
}
