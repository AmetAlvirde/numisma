/**
 * THE CHANGED-CLAIM CLASSIFIER — which of the four classes a row that DISAGREES with the
 * file falls into, and the remainder arithmetic the decision is made on.
 *
 * ONE COHESIVE RULE, and the cohesion is why {@link weighRemainders} came across with
 * {@link partitionChangedClaims} rather than staying behind: the partition decides the
 * class off `onFile < atVenue`, and the refusal message in `import-orders.ts` prints the
 * SAME pair, so the figures the operator is shown must be the ones the decision was made
 * on. That is a property of one function used twice, not of two derivations that agree.
 *
 * PURE, AND THAT IS THE DELIVERABLE. Every fact below was reachable before only through a
 * whole import — an export file, a sidecar, an injected clock, a prompt answered, a
 * funding guard satisfied — while the thing most worth asserting is a BRANCH ORDERING
 * that a comment was the only thing holding in place. See
 * `import-orders-changed-claims.test.ts`.
 *
 * THE REFUSAL WORDS STAY IN THE SHELL, AND {@link renderClaimDifferences} IS NOT ONE. Each
 * class is returned and `importBitgetOpenOrders` owns the refusal it raises over it, in the
 * order hazard demands; what came across is the FOLD OVER A DIFFERENCE LIST that two of
 * those refusals both printed (#36) — a rendering of this module's own union, beside the
 * function that classifies it, not a sentence addressed to the operator.
 */
import {
  isDescriptorDifference,
  isFilledDifference,
  type BitgetOpenOrder,
  type ChangedClaim,
  type ClaimDifference,
  type RestingOrder,
} from "@numisma/engine";
import type { RecordedObservation } from "./import-orders-report.js";

/**
 * A rung the export shows LESS filled than the file's latest observation of it (#181) —
 * the refusal `backwards-claim` is raised over.
 *
 * SPELLED SEPARATELY FROM {@link RecordedObservation} even though the two carry the same
 * three fields, because they are opposite outcomes of the same comparison: one names a
 * line this import WROTE, the other a line it REFUSED to write. Collapsing them into one
 * type would let a refusal be handed to the reporter that describes what was recorded.
 */
export interface BackwardsClaim {
  id: string;
  /** The file's latest observation — see {@link RecordedObservation.known} for the basis. */
  known: number;
  /** The SMALLER partial the export shows. */
  observed: number;
}

/** The four classes a disagreeing row can fall into — three refusals and one recording. */
export interface ChangedClaimPartition {
  amended: ChangedClaim[];
  backwards: BackwardsClaim[];
  descriptors: ChangedClaim[];
  restated: RecordedObservation[];
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
export function partitionChangedClaims(
  changed: readonly ChangedClaim[],
  resting: readonly RestingOrder[],
  observed: readonly BitgetOpenOrder[],
): ChangedClaimPartition {
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
 * The differences one claim carries, as the operator reads them — `field known → observed`,
 * comma-separated.
 *
 * ONE TEMPLATE FOR BOTH REFUSALS, and that is the whole of it (#36). `amended` and
 * `descriptors` printed this same fold at two sites in `import-orders.ts`, with a comment
 * at the second saying so, and only one of them was covered by a test: a change to how a
 * difference reads — units, the `→` in a narrow terminal, quoting a text value — had to be
 * made twice and could be verified once.
 *
 * WELL-TYPED OVER BOTH MEMBERS OF THE UNION, which is what let the two sites share it
 * rather than branch. `known` and `observed` are a number pair or a string pair depending
 * on the field, and neither is formatted here beyond interpolation — a `NumericClaimField`
 * is printed exactly as the engine derived it, so the figure the operator is shown is the
 * one the comparison was made on.
 */
export function renderClaimDifferences(differences: readonly ClaimDifference[]): string {
  return differences
    .map((difference) => `${difference.field} ${difference.known} → ${difference.observed}`)
    .join(", ");
}

/**
 * What one id still claims on each side — the file's remainder and the venue's.
 *
 * ONE function for both the partition and the refusal message, so the figures the
 * operator is shown are the same ones the decision was made on rather than a second
 * derivation that can drift from it.
 *
 * THE VENUE'S CUMULATIVE COLUMN IS READ WITHOUT A FALLBACK, deliberately (PR #218 review).
 * `BitgetOpenOrder.filledQuantity` is a required, non-nullable `number`, so a `?? 0` here
 * could never fire — and it would say, in the one place this module's arithmetic most needs
 * certainty, that the column might be absent. An honest absence would be a parse problem
 * and belongs to the parser, not to a defaulted subtraction here.
 *
 * `undefined` only when the observed row is missing, which cannot happen for a
 * `ChangedClaim` (every one of them is raised FROM an observed row) — reported rather
 * than defaulted, so a future caller that does not hold that invariant cannot get a
 * silently invented `0` out of it.
 */
export function weighRemainders(
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
    atVenue: row.quantity - row.filledQuantity,
  };
}
