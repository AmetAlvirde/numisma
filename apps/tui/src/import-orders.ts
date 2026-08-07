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
 * changed claims → record the restated rungs → prompt → check coverage → append. The
 * coverage check is the LAST thing before the only write, and every refusal before it
 * returns having written nothing at all. `orders.jsonl` is append-only, so a
 * wrong claim written here is not edited away later — it costs a compensating line
 * forever, and that asymmetry is why the refusals are loud and total rather than
 * warnings the operator can walk past.
 */
import {
  buildOrderFillObserved,
  buildOrderPlacedRecords,
  checkFundingCoverage,
  detectChangedClaims,
  formatObservedAt,
  leavesRungUnweighed,
  mergeCollidingClaims,
  parseBitgetOpenOrdersCsv,
  pickRestingOrdersAsOf,
  type BitgetOpenOrder,
  type BitgetRowSkip,
  type OrderFillObservedRecord,
  type OrderPlacedRecord,
  type OrderRecord,
  type FundReviewData,
} from "@numisma/engine";
import type { OrdersLoad } from "@numisma/preferences";
import { appendKey, currentClaimKeys } from "./import-orders-append-filter.js";
import { partitionChangedClaims, weighRemainders } from "./import-orders-changed-claims.js";
import { declareFunding } from "./import-orders-funding-declaration.js";
import { describeMerge } from "./import-orders-merge-notice.js";
import {
  reportOrdersImport,
  type OrdersImportRecorded,
  type RecordedObservation,
} from "./import-orders-report.js";
import { renderUnattributedRefusal } from "./import-orders-unattributed-refusal.js";
import { plural } from "./plural.js";
import { renderSkipMessage } from "./skip-message.js";

/** Everything this flow touches that is not a pure function, in one injectable bag. */
export interface OrdersImportIo {
  /** Read the venue's export. Rejects (throws) if it is unreadable; we catch it. */
  readExport: (path: string) => Promise<string>;
  /**
   * THE CLOCK, injected (#181, `D3`). An observation line is stamped with the IMPORT
   * MOMENT — the instant this look at the venue happened — and never with the export row's
   * own `timestamp` column. That column is the SUBMISSION stamp and an id component
   * (`bitget.ts`), so a line stamped from it would sort to the placement's own instant,
   * where `pickRestingOrdersAsOf` has no tie-break and would replay the two in an order
   * nothing decides.
   *
   * ONE EXPORT IS ONE LOOK, so every observation of a batch shares one stamp, and the
   * stamp is second-granular because {@link isObservedAtStamp} is the shape the whole
   * repo string-compares. Two imports inside one second therefore carry the SAME stamp,
   * and nothing downstream may depend on the stamp to tell them apart — see `appendKey` in
   * `./import-orders-append-filter.js`, which keys an observation on what it ASSERTS.
   */
  now: () => Date;
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
   * A row names a claim already on file and DISAGREES with it in a way that would leave
   * the file claiming LESS than the venue still holds (#174).
   *
   * NOT "a different `quantity`", which is what this said until the #200 review: that is
   * the commonest member, not the definition. Two disagreements land here:
   *
   *   - a different `quantity`, the venue having amended the size (or the two simply
   *     disagreeing about it);
   *   - a restated partial the file's OWN fill lines have already overtaken, so what the
   *     file still counts as resting is smaller than the remainder the venue shows —
   *     `latest observation <= export figure < consumed`.
   *
   * A PARTIAL THAT MOVED DOWN NO LONGER LANDS HERE (#181). It is the other half of the
   * split — see {@link OrdersImportRejection}'s `backwards-claim` — and it left because the
   * remedy this member prints is wrong for it, not because it stopped being a refusal.
   *
   * Refused rather than recorded, and this is the ONE place the "proceed with the
   * arithmetic" reasoning behind the within-batch merge does not extend. THE OBSERVATION
   * VERB EXISTS NOW (#181) and does not help here, which is the point: an
   * `orderFillObserved` line restates ONE figure — the venue's cumulative fill — and
   * neither member landing here is that. An amended `quantity` is the one figure nothing
   * may go stale on and the verb deliberately carries no copy of it; a restatement the
   * file's own fill lines have already overtaken is a contradiction between the book and
   * the venue, and recording it would write the contradiction down rather than settle it.
   * A second `orderPlaced` line remains ignored by `pickRestingOrdersAsOf` by construction
   * (that guard is what makes re-import idempotent), so there is no verb here either way.
   *
   * NARROWED BY #199, and the DIRECTION is the whole reason. Refusing the batch never
   * repaired the stale line — nothing is written on a refusal — so what the refusal
   * actually protects is the funding guard's reading of the OTHER rungs, which it weighs
   * off the file. A book that counts LESS resting than the venue holds leaves the guard
   * more PERMISSIVE than reality, so it could admit a batch the reserve cannot fund:
   * #174's own hazard, and it stays a total refusal. The direction is read off the
   * REMAINDER the guard actually weighs — `pickRestingOrdersAsOf` over the whole stream,
   * fill and cancellation lines included — not off the placement line alone, because a
   * recorded fill can flip a restatement from the safe side to this one. A restatement
   * that leaves the file claiming NO LESS than the venue holds is RECORDED per rung
   * instead — see {@link RecordedObservation}. The argument for refusing here is about
   * which way the leftover staleness points, not about the change itself.
   */
  | "changed-claim"
  /**
   * THE EXPORT'S FILLED COLUMN WENT BACKWARDS: a row names a claim already on file and
   * shows it LESS filled than the file's LATEST OBSERVATION of it (#181).
   *
   * SPLIT OUT OF `changed-claim`, and the reason is the remedy rather than the arithmetic.
   * A fill does not un-fill, so this cannot be the venue reporting the ordinary life of a
   * rung; the likeliest cause by far is the FILE the operator selected — yesterday's
   * export, or the wrong one — and the second likeliest is a venue rendering fault. Both
   * are repaired by exporting again. `changed-claim`'s remedy is to CANCEL the rung at the
   * venue or re-place it, and printing that here told an operator to destroy a live rung
   * over a wrong CSV: the refusal was right and the advice was worse than the mistake.
   *
   * DISJOINT FROM `changed-claim` BY CONSTRUCTION, not by ordering luck: `consumed` is the
   * latest observation plus every `orderFilled` booked since, so `consumed >= latest
   * observation` always holds and the two conditions partition the line at that figure.
   * The argument, with the fold citation, is on `partitionChangedClaims`.
   *
   * STILL A TOTAL REFUSAL, and nothing is written. The direction that reaches here leaves
   * the file claiming NO LESS than the venue holds — the conservative side — so the case
   * for refusing is not the funding hazard `changed-claim` names. It is that the two
   * statements cannot both be true, and this build will not record a contradiction into an
   * append-only file to get an import past.
   */
  | "backwards-claim"
  /**
   * A ROW DESCRIBES A KNOWN RUNG'S PLACEMENT DIFFERENTLY (#205): its `orderType`,
   * `timeInForce` or `triggerPrice` disagrees with what the placement line on file
   * recorded, and nothing about the rung's SIZE or PRICE does.
   *
   * ITS OWN CLASS BECAUSE THE REMEDY IS ITS OWN, which is the same argument that split
   * `backwards-claim` out of `changed-claim` (#208) and it applies here with more force.
   * `changed-claim` ends by telling the operator to CANCEL the rung at the venue or
   * re-place it — destructive advice, justified there by a funding hazard: a file claiming
   * LESS than the venue still holds leaves the guard free to admit a batch the reserve
   * cannot fund. THAT HAZARD CANNOT EXIST HERE. The encumbrance is `price * quantity` and
   * no descriptor is in it, so a descriptor difference moves no money in either direction
   * and the funding guard's reading of this book is exactly as correct as it was. Handing
   * cancel-the-rung to someone whose `trigger_price` merely differs would destroy a live
   * rung over a discrepancy that costs nothing.
   *
   * STILL A TOTAL REFUSAL, and nothing is written — for `backwards-claim`'s reason rather
   * than `changed-claim`'s: the file and the venue are saying two different things about
   * one rung, and this build will not record a contradiction into an append-only file to
   * get an import past. A second `orderPlaced` line would be ignored by the selector
   * anyway, so there is no verb here even if there were an appetite for one.
   *
   * IT WINS OVER A FILL DIFFERENCE ON THE SAME RUNG. A claim carrying both is refused
   * here, not as an amendment: this wording is accurate for it and `changed-claim`'s
   * remedy is not. What it must NOT do is ride into the permissive per-rung skip class
   * beside a safe fill, which is exactly what `partitionChangedClaims`' length guard was
   * built to prevent.
   */
  | "descriptor-changed"
  /**
   * ATTRIBUTION FAILED: at least one rung of the whole resting book cannot be placed
   * against a fundable reserve. ONE rejection may name rungs of BOTH classes the engine
   * distinguishes, and the message ENUMERATES them, section by labelled section (#179).
   *
   *   - `unfundable-reserve` — the rung declares a reserve `fundableReserves` did not
   *     ADMIT: paper execution mode, an unsupported currency, a dangling account
   *     reference (#180). The reserve is usually right there in the operator's own fund
   *     file; what it lacks is the capacity to fund a live claim, so the engine's token
   *     names FUNDABILITY and never existence.
   *   - `currency-mismatch` — the rung is quoted in a currency its declared reserve does
   *     not hold.
   *
   * WHY THE TOKEN NAMES NEITHER OF THEM. This was two members until #179, and a
   * two-member union cannot express the outcome batching created: a token naming one
   * class would have to pick a winner on a batch wrong in both ways, which is the masking
   * bug re-introduced at the boundary that reports it. So the token names the PHASE, and
   * the per-rung reasons stay where they are already modelled — the engine's
   * `UnmatchedReason`, rendered into the message below.
   *
   * Spelled identically to `FundingCoverage`'s own arm on purpose: the two unions naming
   * the same refusal must not diverge. `record-fill.ts`'s same-shaped rejection asks the
   * OTHER question — see the docstring on its own member — and the two stay distinct.
   */
  | "unattributed"
  | "over-committed"
  /**
   * The sidecar append itself failed (#177 item 5). `appendOrders` builds a full next
   * image and renames, so a failure means NOTHING landed and the flow's own refusal
   * contract is the honest report — not a bare stack out of the CLI's outer catch.
   */
  | "write-failed";

/**
 * WHAT AN IMPORT REPORTS — the two recorded shapes, plus the refusal.
 *
 * The recorded half lives in `./import-orders-report.js`, beside the rule that decides
 * between its two members, and is re-exported here so this module's public surface is
 * unchanged: `OrdersImportOutcome` and {@link RecordedObservation} are still importable
 * from `./import-orders.js`, which is the only path the CLI and the tests know.
 *
 * THE REFUSAL STAYS HERE because it is this shell's own vocabulary — every member of
 * {@link OrdersImportRejection} names a guard in this file, and nothing the reporter does
 * can reach one. The reporter is only ever called after the write.
 */
export type OrdersImportOutcome =
  | OrdersImportRecorded
  | { status: "rejected"; reason: OrdersImportRejection; message: string };

export type { RecordedObservation };

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
    // Same refusal, same reason code, same exit — one shared sentence (#181). Nothing is
    // appended over a partially-read book either way.
    return reject(io, "unreadable-sidecar-lines", renderSkipMessage(io.ordersPath, existing.skips));
  }
  const existingRecords: OrderRecord[] = existing.status === "loaded" ? existing.records : [];

  // A row that names a known claim and DISAGREES with it is refused BEFORE the prompt and
  // before the guard — the guard would read the claim's size off the file, not off this
  // row (a repeat placement is ignored by the selector), so proceeding would check
  // coverage against a book the export no longer describes.
  // THE WHOLE STREAM, not the placement lines (#181). The comparison basis is the LATEST
  // observation, so an export whose restatement is already on file agrees with it and
  // reports no difference — which is what makes a re-import idempotent one layer above the
  // append filter.
  const changed = detectChangedClaims(existingRecords, orders);
  // The SAME reading the `O1` guard takes below, over `[...existingRecords, ...records]`
  // — and for these already-known ids the two agree by construction, because a repeat
  // placement line is ignored by the selector, so this batch's own records cannot move
  // the remainder of a rung already on file. Taken here because the partition needs it
  // before anything is prompted for or built.
  const restingOnFile = pickRestingOrdersAsOf(existingRecords);
  const { amended, backwards, descriptors, restated } = partitionChangedClaims(
    changed,
    restingOnFile,
    orders,
  );
  // THREE REFUSALS, ORDERED BY HAZARD, AND `amended` STILL GOES FIRST. Per RUNG the
  // conditions cannot both hold — that is the partition's own argument — but a BATCH can
  // raise one of each over different rungs, and then something has to be printed first.
  // `amended` wins because it is the one with a funding hazard behind it: a batch carrying
  // an amended `quantity` is refused with exactly the token and the message it was refused
  // with before this split, whatever else the export also got wrong.
  //
  // `descriptors` GOES LAST for the same reasoning read the other way (#205): it is the
  // one class with NO funding hazard at all, because the encumbrance is `price * quantity`
  // and no descriptor is in it. `backwards` sits between them — no funding hazard either,
  // but it says the operator may be holding the wrong export, which casts doubt on every
  // other row of the batch in a way a differing `time_in_force` does not.
  if (amended.length > 0) {
    const detail = amended
      .map((claim) => {
        const differences = claim.differences
          .map((difference) => `${difference.field} ${difference.known} → ${difference.observed}`)
          .join(", ");
        // The remainder clause is appended ONLY when the remainder test is what refused
        // this claim, because otherwise it is not the reason and printing it would send
        // the operator after the wrong disagreement. A changed `quantity` refuses on its
        // own terms, whatever the remainders happen to say.
        const remainders = weighRemainders(claim.id, restingOnFile, orders);
        const gap =
          remainders !== undefined && remainders.onFile < remainders.atVenue
            ? `; the file would claim ${remainders.onFile} where the venue still holds ` +
              `${remainders.atVenue}`
            : "";
        return `${claim.id} (${differences}${gap})`;
      })
      .join("; ");
    return reject(
      io,
      "changed-claim",
      `${csvPath} re-states a claim already on file in a way this build cannot carry — ` +
        `${detail}. An id identifies exactly one claim, and this build has no verb for ` +
        `"the claim changed": a second placement line would be ignored by the selector, and ` +
        `calling this row ALREADY KNOWN would leave the file claiming LESS than the venue ` +
        `still holds, so the guard would admit a batch the reserve cannot fund. Cancel the ` +
        `rung at the venue and record the cancellation, or re-place it at a different price ` +
        `so it arrives as a new claim`,
    );
  }

  if (backwards.length > 0) {
    const detail = backwards
      .map((claim) => `${claim.id} (filled ${claim.known} → ${claim.observed})`)
      .join("; ");
    return reject(
      io,
      "backwards-claim",
      `${csvPath} shows ${plural(backwards.length, "rung")} LESS filled than this file has ` +
        `already observed — ${detail}. A fill does not un-fill, so these two statements ` +
        `cannot both be true and nothing was written. The likeliest cause is the export ` +
        `itself: an OLDER one, or not the one you meant. Re-export the open orders from the ` +
        `venue and import that. Nothing here needs doing at the venue — the rungs on file ` +
        `are untouched and still resting`,
    );
  }

  if (descriptors.length > 0) {
    // The SAME detail template the amendment refusal renders, over the same
    // `ClaimDifference` union — `known` and `observed` are a number pair or a string pair
    // depending on the field, and the template is well-typed over both.
    const detail = descriptors
      .map((claim) => {
        const differences = claim.differences
          .map((difference) => `${difference.field} ${difference.known} → ${difference.observed}`)
          .join(", ");
        return `${claim.id} (${differences})`;
      })
      .join("; ");
    return reject(
      io,
      "descriptor-changed",
      `${csvPath} describes ${plural(descriptors.length, "rung")} as PLACED differently ` +
        `from the placement line already on file — ${detail}. NOTHING ABOUT THE MONEY ` +
        `MOVED: what a rung encumbers is price × quantity, no descriptor is in that ` +
        `product, and neither the size nor the price of these rungs changed — so the ` +
        `funding guard's reading of this book is exactly as correct as it was, and ` +
        `nothing was written. The file and the venue are simply saying two different ` +
        `things about one rung, and this build will not record a contradiction into an ` +
        `append-only file. Reconcile the export against the venue's open-orders screen and ` +
        `import the one that matches it. Nothing here needs doing at the venue — the rungs ` +
        `on file are untouched and still resting`,
    );
  }

  // THE RESTATED RUNG LEAVES THE PLACEMENT PATH AND TAKES THE OBSERVATION PATH (#181).
  // It is already on file under this id, so it is not prompted for and not built into a
  // second placement record — the selector ignores a repeat placement line anyway. It is
  // not `alreadyKnown` either: it is not a re-sighting, it is new information, and this
  // build records it rather than skipping it.
  const restatedIds = new Set(restated.map((claim) => claim.id));
  const admitted = orders.filter((order) => !restatedIds.has(order.id));

  // ONE STAMP FOR THE WHOLE BATCH: one export is one look at the venue, so every
  // observation this import writes was observed at the same moment. Read from the
  // injected clock exactly once — a second read could straddle a second boundary and
  // scatter one look across two instants.
  const observedAt = formatObservedAt(io.now());

  // A SEPARATE ARRAY FROM `records`, and the separation is load-bearing twice over.
  // It rides INTO the funding guard — an observation only ever REDUCES a remainder, so
  // leaving it out would let the guard refuse over capital this very import is about to
  // free. It stays OUT of the attribution mark, which exists to say which rungs a
  // re-declaration cannot fix: a restated rung's `fundingReserveId` comes from its
  // original placement line and `declareFunding` never touches it, so marking it would
  // send the operator round a loop that changes nothing.
  //
  // BUILT THROUGH THE TOTAL CONSTRUCTOR, from the EXPORT ROW rather than from `restated`,
  // so the figure and the currency come off the same row the decision was made on and no
  // field needs a default. `filledQuantity` is REQUIRED on a `BitgetOpenOrder`, so there
  // is no `?? 0` here and could not be one: the parser admits a row only when
  // `quantity − filledQuantity > 0`, having read both columns.
  const observations: OrderFillObservedRecord[] = [];
  for (const order of orders) {
    if (!restatedIds.has(order.id)) {
      continue;
    }
    const built = buildOrderFillObserved({
      id: order.id,
      observedAt,
      currency: order.currency,
      observedFilledQuantity: order.filledQuantity,
    });
    if (built.status === "ok") {
      observations.push(built.record);
      continue;
    }
    // UNREACHABLE, AND HANDLED ANYWAY — that is what makes the constructor total rather
    // than decorative. A rung reaches `restated` only because its figure moved UP from
    // what the file knew, and the file's floor is 0, so the figure is positive; the stamp
    // comes from `formatObservedAt` and the currency from a parsed row. If one ever did
    // refuse, the line is NOT written and — because `reportOrdersImport` describes the lines
    // that were written — the operator is not told it was recorded. The refusal is loud rather than
    // silent, on the channel every other per-row problem in this flow uses.
    io.err(
      `${order.id} skipped — the restatement could not be recorded: ${built.message}`,
    );
  }

  // THE JOIN, NOT THE ITERATION: `reportOrdersImport` is handed this Map and the lines that
  // were WRITTEN, so a decision with no line on disk is never reached. See that module's
  // header for why the reporter takes the map rather than `restated` itself.
  const knownFigures = new Map(restated.map((claim) => [claim.id, claim.known] as const));

  // AN OBSERVATIONS-ONLY IMPORT SKIPS BOTH THE PROMPT AND THE GUARD. There is nothing to
  // attribute — every rung here is already on file under its own placement line, with a
  // `fundingReserveId` `declareFunding` would not touch — so prompting would ask a
  // question with no honest answer, and the honest answer (a blank line) used to come back
  // as `no-reserve-declared`: a refusal over an import with nothing to fund. A guard here
  // would weigh only the book already on file, raising a NEW refusal over a PRE-EXISTING
  // condition, unfixable because no declaration was prompted for.
  //
  // AND THE `nothing-to-import` SHORT-CIRCUIT THAT USED TO SIT HERE IS GONE. An export of
  // nothing but restated rungs now writes N observation lines — the most useful import
  // this flow can perform — so exiting early over it would skip the feature's best case.
  const records: OrderPlacedRecord[] = [];
  if (admitted.length > 0) {
    // `io.ask` ALONE, not the bag: that module reads the prompt channel and nothing else,
    // and its signature says so — see its header.
    const declaration = await declareFunding(io.ask, admitted);
    if (declaration === undefined) {
      return reject(io, "no-reserve-declared", "no funding reserve was declared for this batch");
    }
    records.push(...buildOrderPlacedRecords(admitted, declaration));

    // `O1`. Coverage is checked over the WHOLE resting book — what is already on file plus
    // this batch — because a reserve funds every claim against it, not one import's slice.
    // The selector dedupes by id, so a re-import does not double-count the same rung.
    //
    // THE OBSERVATIONS RIDE IN. Excluded, the guard would weigh the restated rungs at their
    // STALE remainders and could return `over-committed` over capital this very import is
    // about to free — a false refusal, in the direction of blocking legitimate work.
    const resting = pickRestingOrdersAsOf([...existingRecords, ...records, ...observations]);
    const coverage = checkFundingCoverage(resting, await io.fundReview());
    if (coverage.status === "unattributed") {
      // ONE refusal for BOTH classes. Cross-currency funding is not designed and an
      // unadmitted reserve cannot fund a live claim; either way the rung is refused here
      // and in the report, and the operator is told about every one of them at once rather
      // than paying a second full pass — declaration prompt included — to learn the second
      // class (#179).
      //
      // PLACEMENT IDS ONLY in the mark. `resting` above is the whole book, and the mark
      // says which listed rungs are NOT this batch's to re-declare. An observation carries
      // no `fundingReserveId` and the prompt never offered one for it, so marking a
      // restated rung as "this batch's" would point the operator at a declaration that
      // does not exist.
      return reject(
        io,
        "unattributed",
        renderUnattributedRefusal(
          coverage.unmatched,
          new Set(records.map((record) => record.id)),
        ),
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
  }

  // ONE `appendOrders` CALL for both kinds: one lock, one temp write, one `rename`. There
  // is no ordering reason to split them — the selector sorts by `observedAt` at READ time,
  // so the file's byte order cannot change what it means.
  // WHAT THE FILE CURRENTLY CLAIMS, AS KEYS — the rung's CURRENT claim rather than its
  // whole history (#212), built by `currentClaimKeys` in `./import-orders-append-filter.js`
  // where the argument for that scoping is recorded beside the key it scopes.
  const currentOnFile = currentClaimKeys(existingRecords);
  // ONE SET, BUILT ONCE, over both arrays in a single pass — so a second line for the same
  // rung inside ONE batch would not see the first. It cannot arise: `mergeCollidingClaims`
  // has already summed id collisions, so `orders` holds at most one row per id, and
  // `records` and `observations` are derived from it by complementary filters on
  // `restatedIds`. Re-keying per record would buy nothing and cost a quadratic pass.
  const fresh: OrderRecord[] = [...records, ...observations].filter(
    (record) => !currentOnFile.has(appendKey(record)),
  );
  try {
    await io.appendOrders(io.ordersPath, fresh);
  } catch (error) {
    // The write is a temp file plus a rename, so a failure here landed NOTHING — the
    // refusal contract's "Nothing was written" is literally true, and the operator gets
    // it instead of a stack trace from the CLI's outer catch (#177 item 5).
    const detail = error instanceof Error ? error.message : String(error);
    return reject(io, "write-failed", `could not append to ${io.ordersPath}: ${detail}`);
  }

  // THE WRITE IS THE SHELL'S, THE WORDS ARE THE RULE'S (ADR-001). `reportOrdersImport` is a
  // pure function of what landed, so it returns the message rather than printing it, and
  // this — the one `io.out` of the whole flow, reached by the one exit that gets here —
  // is where it is spoken.
  const { outcome, message } = reportOrdersImport({
    written: fresh,
    placements: records,
    knownFigures,
    skips: parsed.skips,
    csvPath,
  });
  io.out(message);
  return outcome;
}
