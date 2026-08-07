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
  isDescriptorDifference,
  isFilledDifference,
  leavesRungUnweighed,
  mergeCollidingClaims,
  parseBitgetOpenOrdersCsv,
  pickRestingOrdersAsOf,
  type BitgetOpenOrder,
  type BitgetRowSkip,
  type ChangedClaim,
  type MergedOrderClaim,
  type OrderFillObservedRecord,
  type OrderPlacedRecord,
  type OrderRecord,
  type FundReviewData,
  type RestingOrder,
  type UnmatchedRung,
} from "@numisma/engine";
import type { OrdersLoad } from "@numisma/preferences";
import { appendKey, currentClaimKeys } from "./import-orders-append-filter.js";
import {
  reportOrdersImport,
  type OrdersImportRecorded,
  type RecordedObservation,
} from "./import-orders-report.js";
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
 * A rung the export shows LESS filled than the file's latest observation of it (#181) —
 * the refusal `backwards-claim` is raised over.
 *
 * SPELLED SEPARATELY FROM {@link RecordedObservation} even though the two carry the same
 * three fields, because they are opposite outcomes of the same comparison: one names a
 * line this import WROTE, the other a line it REFUSED to write. Collapsing them into one
 * type would let a refusal be handed to the reporter that describes what was recorded.
 */
interface BackwardsClaim {
  id: string;
  /** The file's latest observation — see {@link RecordedObservation.known} for the basis. */
  known: number;
  /** The SMALLER partial the export shows. */
  observed: number;
}

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
 * THE WHOLE ATTRIBUTION REFUSAL, IN ONE PASS — every rung the engine could not place,
 * grouped by the class whose remedy it shares (#179).
 *
 * Reading order inside a section is LABEL → ADVICE → RUNGS, and the ordering is load
 * bearing rather than cosmetic. Advice last orphans it: with two unfundable reserves it
 * sits directly under the second reserve's rungs and reads as advice about that reserve
 * alone, which is what the prototype exposed and the grill's one-reserve example could
 * not. Advice under the label plainly governs everything beneath it.
 *
 * GRANULARITY IS THE ENGINE'S, NOT A RENDERING TASTE, and the two classes differ because
 * their remedies do. `unfundable-reserve` dedups to RESERVE IDS with its rungs listed
 * beneath — one declaration fix clears every rung against that reserve. `currency-mismatch`
 * stays PER RUNG — the fix is per rung. That is the same split the guard used to make in
 * the engine, moved to where it belongs: the engine now forwards every rung of both
 * classes and narrows nothing (see `FundingCoverage`).
 *
 * EACH SECTION IS ABSENT WHEN ITS CLASS IS, so a homogeneous batch renders one section.
 * `over-committed` cannot join them, because an unplaceable rung has no balance to weigh —
 * which is exactly what the closing line says, and why that line is not droppable.
 * Batching creates the expectation *"I have now been told everything"*, and without that
 * sentence the expectation is false.
 *
 * WHICH IS ALSO WHY THE PARTITION IS A SWITCH AND NOT TWO FILTERS. The header counts off
 * `unmatched.length` while the body lists only what the partition matched, so under two
 * `.filter` calls a third {@link UnmatchedReason} was COUNTED AND NEVER NAMED — and with a
 * homogeneous batch of it, `sections` was empty and the refusal named ZERO rungs while
 * claiming one could not be placed. That is #179's masking defect rebuilt at the render
 * boundary, and splitting `unfundable-reserve` into its three causes — paper mode,
 * unsupported currency, dangling account — is a change `UnmatchedReason` needs no new
 * shape for, so the premise is a live one.
 *
 * TWO LAYERS NOW STOP IT, AND ONLY ONE OF THEM IS THE FIX. The `never` assignment makes a
 * new member a `pnpm typecheck` failure AT THIS SITE — that is the fix, and it is the only
 * thing that catches the omission before an operator does. The fallback section is what
 * the output degrades to if one ever arrives here unhandled anyway: named under its raw
 * token rather than swallowed, so the count and the listing still agree.
 */
function renderUnattributedRefusal(
  unmatched: readonly UnmatchedRung[],
  batchIds: ReadonlySet<string>,
): string {
  const unfundable: UnmatchedRung[] = [];
  const mismatched: UnmatchedRung[] = [];
  // Raw reason token → the rungs carrying it. Empty in every reachable state.
  const unclassified = new Map<string, string[]>();
  for (const entry of unmatched) {
    switch (entry.reason) {
      case "unfundable-reserve":
        unfundable.push(entry);
        break;
      case "currency-mismatch":
        mismatched.push(entry);
        break;
      default: {
        const _never: never = entry.reason;
        // It does NOT throw, unlike `foldEvents`'s latch. The message IS the deliverable
        // here, and `import-orders-cli.ts` would collapse a throw into one bare error
        // line — losing every rung the operator was owed, to protect them from a
        // rendering gap. Degrade the section, never the refusal.
        const token: string = _never;
        const existing = unclassified.get(token);
        if (existing) existing.push(entry.rung.orderId);
        else unclassified.set(token, [entry.rung.orderId]);
      }
    }
  }

  // PROVENANCE, PER RUNG (#202 review). `O1` weighs the WHOLE resting book — the sidecar's
  // existing records plus this batch — so a listed rung need not appear anywhere in the
  // export the operator just read. Unmarked, the count invited a reconciliation against
  // that export which could not come out even. The marker is short because these lines
  // already carry a synthesized id and would wrap; the header spells out what it means.
  // It marks the LINE, not the id: a marker wedged between an id and the clause that
  // follows it reads as part of that clause rather than as a note about the rung. Keeping
  // the marker at end-of-line is why the currency-mismatch section puts the id alone on
  // its line and indents the mismatch beneath it — end-of-line and inside 80 columns are
  // both wanted, and the id plus the clause plus the marker do not fit one line.
  const mark = (line: string, orderId: string): string =>
    batchIds.has(orderId) ? line : `${line} — on file`;
  const anyOnFile = unmatched.some((entry) => !batchIds.has(entry.rung.orderId));

  const sections: string[] = [];

  if (unfundable.length > 0) {
    // First-appearance order, so the rungs' own order survives inside each reserve and
    // across the reserves — the grouping is stable, and nothing is sorted.
    const byReserve = new Map<string, string[]>();
    for (const entry of unfundable) {
      const existing = byReserve.get(entry.rung.fundingReserveId);
      if (existing) existing.push(entry.rung.orderId);
      else byReserve.set(entry.rung.fundingReserveId, [entry.rung.orderId]);
    }
    const many = byReserve.size !== 1;
    const advice = many
      ? `    The fold excluded these reserves: paper execution mode, an unsupported\n` +
        `    currency, or a dangling account reference. They cannot fund a live order,\n` +
        `    and the available-capital report would not be able to place them either.`
      : `    The fold excluded this reserve: paper execution mode, an unsupported\n` +
        `    currency, or a dangling account reference. It cannot fund a live order,\n` +
        `    and the available-capital report would not be able to place it either.`;
    const listing = [...byReserve].map(
      ([reserveId, orderIds]) =>
        `      ${reserveId}\n` +
        `${orderIds.map((orderId) => mark(`        ${orderId}`, orderId)).join("\n")}`,
    );
    sections.push(
      `  unfundable reserve — ${plural(byReserve.size, "reserve")}, ` +
        `${plural(unfundable.length, "rung")}\n${advice}\n${listing.join("\n")}`,
    );
  }

  if (mismatched.length > 0) {
    // Id on its own line, its mismatch indented beneath — the shape the unfundable section
    // already uses for a grouping and its rungs, rather than a third layout for this one.
    const listing = mismatched.map(
      (entry) =>
        `${mark(`      ${entry.rung.orderId}`, entry.rung.orderId)}\n` +
        `        quoted in ${entry.rung.currency}, declared against ` +
        `${entry.rung.fundingReserveId}`,
    );
    sections.push(
      `  currency mismatch — ${plural(mismatched.length, "rung")}\n` +
        `    Cross-currency funding is not supported; fix the declaration.\n` +
        `${listing.join("\n")}`,
    );
  }

  for (const [token, orderIds] of unclassified) {
    // No advice line: nothing here knows the remedy for a reason it does not know. The
    // token and the rungs are what can be said honestly, and they are enough to report.
    sections.push(
      `  ${token} — ${plural(orderIds.length, "rung")}\n` +
        `    This refusal has no section for that reason; it is named as the engine\n` +
        `    gave it, so no rung counted above goes unlisted.\n` +
        `${orderIds.map((orderId) => mark(`      ${orderId}`, orderId)).join("\n")}`,
    );
  }

  return (
    `${plural(unmatched.length, "rung")} cannot be placed against a fundable reserve.\n` +
    // Only when there is something to explain: a batch whose every unplaceable rung came
    // out of the export just read owes the operator no marker and no legend for one.
    (anyOnFile
      ? `Coverage weighs the WHOLE resting book, so rungs marked "on file" below were\n` +
        `already in the sidecar before this import, not in the export just read.\n`
      : ``) +
    `\n` +
    `${sections.join("\n\n")}\n\n` +
    // Wrapped at 72/71/19 rather than 80/83 (#202 review). Every other line this renderer
    // emits sits inside 76, and these two were the only ones that did not — so on an
    // 80-column terminal the one paragraph that admits what the operator has NOT been told
    // was also the one paragraph that wrapped, which is the worst place to spend the
    // reader's attention.
    `Reserve balances were NOT weighed: an unplaceable rung has no balance to\n` +
    `compare against, so a coverage refusal may still follow once every rung\n` +
    `above is placeable.\n`
    // That trailing newline is the blank line before `reject()`'s "Nothing was written to
    // …" tail. Without it the tail reads as a continuation of the balances sentence —
    // invisible when the body was one paragraph, plainly wrong now that it is several.
  );
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
 * THE SKIP CLASS IS DECIDED BY THE REMAINDER THE GUARD ACTUALLY WEIGHS, which is why
 * `resting` is a parameter rather than something this could work out from `changed`
 * (#200 review). A difference is a statement about the venue's column; the guard weighs
 * `pickRestingOrdersAsOf`, which replays `orderFilled` and `orderCancelled` too, so a fill
 * already recorded against the rung can shrink the file's remainder BELOW the venue's
 * while the partials still read as "moved up". The traced case: file holds placed 10 /
 * filled 6, the operator runs the fill flow and accepts the default remainder of 4,
 * retiring the rung — the file now counts ZERO resting — and the venue's next export shows
 * filled 8, i.e. 2 units still resting. Skipping that would make `available` read HIGH,
 * which is #174's own hazard.
 *
 * Three things must hold for a per-rung skip, and anything else refuses the batch:
 *
 *  1. NO `quantity` DIFFERENCE — unchanged policy, and not merely because of today's
 *     encumbrance. `placed.quantity` is the ORIGINAL size a cumulative venue reading is
 *     compared against (#176), so a stale one corrupts every future comparison of this
 *     rung, not just this guard's sum. It is the one figure nothing may go stale on. It
 *     refuses the WHOLE BATCH, and it refuses it whichever way the partial points.
 *  2. EVERY REMAINING difference is `observedFilledQuantity`. The third, fourth and fifth
 *     fields ARRIVED (#205) — the placement descriptors — and they are taken by their own
 *     branch above this one rather than by this guard. The guard stays exactly as it was,
 *     for the sixth: an unknown difference must land in a REFUSAL class by default instead
 *     of silently riding in beside a safe fill as a per-rung skip.
 *  3. `fileRemaining >= venueRemaining`. The `<=` on the left is where later fill lines
 *     live; they only make it stricter.
 *
 * THE REFUSAL SPLITS TWO WAYS, AND THE TWO CANNOT OVERLAP (#181). One refusal used to
 * serve two conditions that are not the same animal, and the wrong one is actively
 * harmful: an operator who imports YESTERDAY's export against a file holding an observed 6
 * was refused correctly and then told to cancel the rung at the venue or re-place it —
 * advice that destroys a live rung in response to someone picking the wrong CSV.
 *
 *   - `backwards` — the export figure is BELOW the latest observation. A fill does not
 *     un-fill, so the column went backwards and the likeliest cause is the file, not the
 *     book: an older export, or not the export the operator meant. It gets its own wording
 *     and NEVER tells anyone to touch the rung at the venue.
 *   - `amended` — `latest observation <= export figure < consumed`. The fund has BOOKED
 *     beyond what the venue shows, so calling the row already known would leave the file
 *     claiming LESS than the venue still holds. Today's wording, today's exit.
 *
 * THE ORDER OF THE TWO TESTS IS LOAD-BEARING, NOT PRESENTATIONAL, and the two outcome
 * classes are disjoint only BECAUSE `backwards` is taken first. `consumed >= latest
 * observation` ALWAYS holds — the fold SETs `consumed` to the latest observation and
 * `orderFilled` only ever ADDS to it, so `consumed` is that observation plus a non-negative
 * sum of bookings made since — and that is exactly what makes the two PREDICATES a superset
 * relation rather than a partition. `backwards` fires on `export figure < latest
 * observation`. `amended`'s remainder test reduces to `export figure < consumed`, because
 * the `quantity` branch further down has already taken every claim whose placed size
 * differs, so `quantity` is equal on both sides and cancels out of
 * `onFile < atVenue`. `[0, consumed)` therefore CONTAINS `[0, latestObserved)`: THE
 * PREDICATES OVERLAP, and only the `continue` after the `backwards` push separates them.
 * Placed 10, the file's latest observation 6, the export showing 4: both tests are true,
 * and the order alone decides which one the operator is told.
 *
 * The intervals the two OUTCOMES occupy — `[0, latestObserved)` and
 * `[latestObserved, consumed)`, adjacent and disjoint — describe the classes AFTER that
 * ordering; they are not a property of the predicates and must not be read as one.
 * Reordering the tests is therefore not a rearrangement of the same answer: every backwards
 * claim would fall into `amended` and be handed the cancel-the-rung-at-the-venue advice
 * #208 exists to keep it away from — the exact harm the split above was made to remove.
 *
 * THE CLOSED END OF THE SECOND INTERVAL IS NOT REACHED FROM HERE, and that is unchanged by
 * the split rather than a hole it opens. An export exactly AT the latest observation is not
 * a DIFFERENCE, so no `ChangedClaim` is raised for it and this function never sees it —
 * whatever the fund booked afterwards. That is the same reading a re-import of an unchanged
 * export has always had, and widening this to every observed row would turn an ordinary
 * re-import into a batch refusal.
 *
 * AN EXPORT FIGURE ABOVE THE PLACED QUANTITY GETS NO CHECK, AND THAT IS THE DECISION. It
 * is unreachable, by two gates upstream of this line:
 *
 *   - the VENUE's own export cannot render `filled_quantity > quantity` on the same row —
 *     the two columns come from one order and a venue that filled more than it placed
 *     would be contradicting itself, not reporting; and
 *   - `parseBitgetOpenOrdersCsv`'s own admission gate drops any row whose remainder is not
 *     POSITIVE — `quantity − filled_quantity <= 0` is a `not-resting` SKIP — so a
 *     hand-edited CSV never reaches this partition as a claim at all. `mergeCollidingClaims`
 *     preserves that, summing both columns of a collision and so both sides of the same
 *     inequality.
 *
 * If such a line ever did reach the file anyway, the fold degrades correctly rather than
 * lying: `remaining = quantity − consumed` goes negative, `pickRestingOrdersAsOf` drops
 * the rung (`remaining > 0` is its resting test), and the fill-admission ceiling
 * `min(remainingQuantity, quantity − bookedFills(id))` cannot authorize anything. Adding a
 * runtime check here would put a third opinion about the same impossibility in the one
 * place least able to explain it; RECORDING WHY IT CANNOT ARRIVE is the deliverable.
 *
 * An id ABSENT from `resting` reads as `0`, not as a missing case: absent means the
 * stream already retired the claim — its fills exhausted it, or a cancellation took it —
 * and zero is the honest statement of what the file now counts against that rung.
 *
 * A FOURTH CLASS, AND THE ROUTING IS BY HAZARD (#205). The placement descriptors —
 * `orderType`, `timeInForce`, `triggerPrice` — are compared now, and a difference in one
 * must not be handed `amended`'s cancel-the-rung remedy, which is justified by a funding
 * hazard that cannot arise from a field the encumbrance does not contain. The three tests
 * run in this order and the order is the argument:
 *
 *  1. ANY `quantity` DIFFERENCE → `amended`, exactly as before. A funding hazard outranks
 *     everything, so a rung whose size changed is refused with today's token and today's
 *     message whatever else it also disagrees about.
 *  2. OTHERWISE ANY DESCRIPTOR DIFFERENCE → `descriptors`, EVEN IF a fill difference rides
 *     along on the same claim. Two things follow from taking it here. The wording the
 *     operator gets is accurate for that claim, where `amended`'s is not; and a mixed
 *     claim still cannot reach the permissive per-rung skip below, which is what the
 *     length guard in test 2 of the skip rule exists to protect.
 *  3. OTHERWISE the fill logic, untouched.
 */
function partitionChangedClaims(
  changed: readonly ChangedClaim[],
  resting: readonly RestingOrder[],
  observed: readonly BitgetOpenOrder[],
): {
  amended: ChangedClaim[];
  backwards: BackwardsClaim[];
  descriptors: ChangedClaim[];
  restated: RecordedObservation[];
} {
  const amended: ChangedClaim[] = [];
  const backwards: BackwardsClaim[] = [];
  const descriptors: ChangedClaim[] = [];
  const restated: RecordedObservation[] = [];

  for (const claim of changed) {
    if (claim.differences.some((difference) => difference.field === "quantity")) {
      amended.push(claim);
      continue;
    }
    // The predicate is the ENGINE's, beside the field union it reads, so this boundary
    // cannot fall out of step with the list of fields a descriptor difference can name.
    if (claim.differences.some(isDescriptorDifference)) {
      descriptors.push(claim);
      continue;
    }
    const fill = claim.differences.find(isFilledDifference);
    const remainders = weighRemainders(claim.id, resting, observed);
    // The restatement must be the ONLY difference left, not merely one of them. The
    // `quantity` branch above already took the field that exists today, so this length
    // test is about the THIRD field a later `ClaimDifference` may carry: without it, an
    // unknown difference would ride into the skip class alongside a safe fill — silently,
    // and in the permissive direction — which is the whole point of guarding here.
    if (fill === undefined || claim.differences.length !== 1 || remainders === undefined) {
      amended.push(claim);
      continue;
    }
    // `fill.known` IS the latest observation (see `ClaimDifference`), so this is the
    // backwards test exactly as the argument above states it — and the difference exists
    // at all only because the two figures are further apart than `QUANTITY_EPSILON`.
    if (fill.observed < fill.known) {
      backwards.push({ id: claim.id, known: fill.known, observed: fill.observed });
      continue;
    }
    if (remainders.onFile < remainders.atVenue) {
      amended.push(claim);
      continue;
    }
    // THE REMAINDERS ARE WEIGHED AND NOT CARRIED (#181). They still DECIDE the class —
    // `remainders.onFile < remainders.atVenue` is the test directly above — but they were
    // carried onto the outcome to let an operator audit a SKIP's safety claim, and this
    // build writes the observation instead of skipping. Once the line lands, the file's
    // remainder IS the venue's, so the pair would print two equal numbers and invite an
    // audit of nothing.
    restated.push({ id: claim.id, known: fill.known, observed: fill.observed });
  }

  return { amended, backwards, descriptors, restated };
}

/**
 * What one id still claims on each side — the file's remainder and the venue's.
 *
 * ONE function for both the partition and the refusal message, so the figures the
 * operator is shown are the same ones the decision was made on rather than a second
 * derivation that can drift from it.
 *
 * `undefined` only when the observed row is missing, which cannot happen for a
 * `ChangedClaim` (every one of them is raised FROM an observed row) — reported rather
 * than defaulted, so a future caller that does not hold that invariant cannot get a
 * silently invented `0` out of it.
 */
function weighRemainders(
  id: string,
  resting: readonly RestingOrder[],
  observed: readonly BitgetOpenOrder[],
): { onFile: number; atVenue: number } | undefined {
  const row = observed.find((order) => order.id === id);
  if (row === undefined) {
    return undefined;
  }
  const open = resting.find((order) => order.placed.id === id);
  return {
    onFile: open?.remainingQuantity ?? 0,
    atVenue: row.quantity - (row.filledQuantity ?? 0),
  };
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
    const declaration = await declareFunding(io, admitted);
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
