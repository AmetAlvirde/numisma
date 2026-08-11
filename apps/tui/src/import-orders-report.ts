/**
 * THE REPORT, FED THE LINES THAT WERE ACTUALLY WRITTEN (#181).
 *
 * It used to be handed two bare numbers from ABOVE the write and then reach past its own
 * parameter list into the DECISION array for the rest — so it described what the flow
 * DECIDED while the file held what the append filter LET THROUGH. One defect with three
 * faces, and the visible one was a dropped line surfacing as a confident `RECORDED`.
 *
 * Every count and every operator line is derived HERE, from `written`. `placements` is
 * passed as an ARRAY rather than as a count for the same reason: `alreadyKnown` is "what
 * this batch proposed, less what landed", and both halves of that subtraction must be
 * counted by one rule in one place. The only thing read out of the decision is the `known`
 * figure joined per line, because the line itself cannot remember it.
 *
 * ONE MESSAGE, CONSTRUCTED AT ONE EXIT, so the `OBSERVED —` detail is built once BY
 * CONSTRUCTION rather than by discipline. It was written out verbatim at two exits before,
 * eight lines under a comment stating the very invariant that duplication breaks.
 *
 * THE WRITE ITSELF IS THE CALLER'S (ADR-001), and that is the one thing this module changed
 * on the way out of `import-orders.ts`. The rule used to end at "one `io.out`, reached by
 * every exit"; the function now returns the message beside the outcome and
 * `importBitgetOpenOrders` performs the single `io.out`. The invariant is unweakened —
 * there is still exactly one message and exactly one write — and it buys the thing the
 * closure could not have: the counting rule is a pure function of its arguments, so every
 * fact below is assertable without an export file, a sidecar or a stubbed IO bag.
 */
import {
  leavesRungUnweighed,
  type BitgetRowSkip,
  type OrderPlacedRecord,
  type OrderRecord,
} from "@numisma/engine";

/**
 * A rung the venue has filled FURTHER since the file last observed it, RECORDED (#181).
 *
 * The id is synthesized from the SUBMISSION stamp, so a rung that fills between two
 * exports comes back under the same id carrying a larger `filled_quantity`. That is not
 * an amendment and not a re-sighting — it is the ordinary life of a resting ladder — and
 * it now gets its own durable line: an `orderFillObserved`, stamped with the IMPORT
 * moment, which `pickRestingOrdersAsOf` folds as a new `consumed` baseline.
 *
 * IT REPLACES `RestatedPartial` RATHER THAN REPURPOSING IT (#199 → #181). That type
 * carried BOTH remainders because the pair WAS the safety argument for a per-rung SKIP:
 * printing them let an operator check that the stale line still encumbered no less than
 * the venue held. There is no skip left to justify, and after the observation lands the
 * pair is redundant by construction — the file's remainder becomes `quantity − observed`,
 * which is exactly the venue's. What an operator still wants is the one thing this
 * carries: what the file knew, and what it now records.
 *
 * IT IS NOT A QUALIFICATION. A restatement qualified the status while it was a DEFERRAL —
 * a rung read perfectly and then not written down — and this build writes it down. See
 * {@link OrdersImportRecorded}'s `imported` member for what that does to the union.
 *
 * THE DIRECTION IS STILL READ OFF THE REMAINDER, not off the two figures (#200 review).
 * A restatement the file's OWN fill lines have already overtaken is not a restatement at
 * all — the fund has BOOKED units the venue does not corroborate — and those rungs stay a
 * batch-wide `changed-claim` refusal. The algebra is on `partitionChangedClaims`.
 */
export interface RecordedObservation {
  id: string;
  /**
   * The file's LATEST OBSERVATION of this rung's partial — a later `orderFillObserved`
   * line when one exists, else the placement line's own figure, else `0` (#181). Was "the
   * partial the placement line records", which stopped being the same number the moment a
   * restatement could be written down.
   */
  known: number;
  /** The larger cumulative partial the venue's export now shows, and what was written. */
  observed: number;
}

/**
 * A PICK WHOSE DECLARED RUNG PRICE DIFFERS FROM THE ORDER'S OWN (#286).
 *
 * ACCEPTED, NEVER REFUSED: the operator is allowed to know something the price match does
 * not — a rung re-placed a tick away, a size re-entered at the venue — and refusing here
 * would make the declared join weaker than the inference it replaces. What it owes the
 * operator is VISIBILITY, so the difference is stated in the report with both figures and
 * the direction readable off them.
 *
 * IT QUALIFIES NOTHING. The status stays `imported`: nothing was deferred, nothing was
 * unread, and the line on disk says exactly what the operator declared.
 */
export interface PickedPriceDifference {
  /** What the picked rung declares. */
  declared: number;
  /** What the order was actually placed at. */
  order: number;
}

/**
 * What an import that REFUSED NOTHING reports, in the two shapes it can honestly take.
 *
 * Not "an import that WROTE" (#200 review): an export whose every readable rung was
 * already on file saying the same thing writes no line at all and still reports here,
 * because the flow reached its end with nothing refused. Writing is what these outcomes
 * usually DO; not refusing is what they all MEAN.
 */
interface OrdersImportWrite {
  /**
   * ORDERS appended — placement lines, and never a line count (#181). The two were the
   * same number until an import could write a second kind, and the moment it could, a
   * pure-observation import reported `1 order(s) appended` about ZERO orders.
   *
   * `appended` KEEPS MEANING ORDERS because that is the question the number is read for:
   * *how many claims on my capital did this import create?* An observation creates none —
   * it only ever REDUCES what a rung still claims — so counting it here would answer that
   * question wrongly in the direction that matters. Observations are counted by
   * {@link observations}, whose length IS the count.
   *
   * ZERO in three different ways now, and the other fields tell them apart: every rung was
   * already known (`alreadyKnown` carries them), every readable rung was restated
   * (`observations` carries them), or the export named nothing this build admitted.
   */
  appended: number;
  /**
   * Rungs already in the sidecar under the same synthesized id AND saying the same
   * thing about it — the id components plus `quantity` and the observed partial.
   *
   * A row that differs NEVER reaches this count, whichever way it goes: it either
   * refuses the whole batch as `changed-claim` / `backwards-claim` (#174, #181) or is
   * recorded as an observation and reported in {@link observations} (#181). Calling
   * either one "already known" is the silence #174 named — it reports "nothing to do"
   * about a rung the file now describes wrongly.
   */
  alreadyKnown: number;
  /**
   * The export rows this build could not read — NOT empty on `imported`, and the
   * asymmetry with {@link observations} is deliberate rather than an oversight. A
   * `not-resting` row was read COMPLETELY and the parser's finding about it is that
   * nothing is still claimed, so it rides here and qualifies nothing (#184). What
   * `imported` promises about this field is that none of its entries left a rung
   * UNWEIGHED — that is `leavesRungUnweighed`'s question, not this array's length.
   */
  skips: BitgetRowSkip[];
  /**
   * The restatements this import RECORDED — exactly one `orderFillObserved` line each
   * (#181), and never a superset of what was written.
   *
   * DERIVED FROM THE LINES THAT WERE WRITTEN, not from the decision that proposed them,
   * and that is the whole shape of {@link reportOrdersImport}. A decision the append
   * filter did not let through is ABSENT here, so the operator is never told a line was
   * RECORDED that is not on disk. The `known`/`observed` pair is the one thing joined back
   * from the decision — the written line carries the new figure, and only the decision
   * remembers the old one.
   *
   * NOT A QUALIFICATION, unlike the `restated` field it replaces. That field's own length
   * decided the status, because a skipped rung was work DEFERRED; this one records work
   * DONE, so `imported` widens back over it. A reader who never opens this field is not
   * misled by one, which is the test that decides what may qualify a status.
   */
  observations: RecordedObservation[];
}

/**
 * The two outcomes of an import that refused nothing — every member of
 * `OrdersImportOutcome` except the refusal, which is the whole of what this module can
 * return. Spelled here rather than in `import-orders.ts` so the reporter's return type
 * does not have to reach back into the shell it reports for.
 */
export type OrdersImportRecorded =
  /**
   * Every row of the export was read. The unqualified success, and the only one.
   *
   * ITS INVARIANT WIDENS BACK HERE (#199 → #181), and this union has never shrunk before,
   * so it is worth saying plainly: this is a GAP CLOSING, not precision lost. #199
   * strengthened the member to "every row read AND nothing restated" because a
   * restatement was then a DEFERRAL — a rung read perfectly and then not written down —
   * and a status that called that unqualified would be lying to the reader who opens no
   * second field. The restatement is now RECORDED, so it defers nothing and qualifies
   * nothing, and the only thing left qualifying an import is a row nobody could read.
   */
  | ({ status: "imported" } & OrdersImportWrite)
  /**
   * The import ran to its end, and SOMETHING ABOUT THE EXPORT WAS QUALIFIED (`D3`, #177;
   * #199).
   *
   * A DISTINCT MEMBER, not `imported` carrying a non-empty field. A shape that forces
   * every reader to open a second field to discover the first was qualified is a type
   * that lies to the reader who does not. It is still a SUCCESS, and the test is that
   * NOTHING WAS REFUSED — not that lines were written, which is the weaker claim this
   * used to make and which an export of nothing but restated rungs falsifies while still
   * being a perfectly honest run. The CLI exits 0 either way (`D3`).
   *
   * ONE qualification reaches it now (#181): `skips` — a row was not read, so a rung
   * resting at the venue is `committed` that nobody counted and `available` reads HIGH.
   * A restated rung used to be the second, and it is a RECORDED line rather than a
   * deferral since #181, so it no longer qualifies anything.
   *
   * STILL A DISTINCT MEMBER RATHER THAN A PREDICATE OVER `skips`, because `skips` is
   * heterogeneous: a `not-resting` row was read completely and qualifies nothing, so the
   * status is decided by `leavesRungUnweighed` over the entries rather than by the
   * array's length. It is still a SUCCESS, and the test is that NOTHING WAS REFUSED.
   */
  | ({ status: "imported-partial" } & OrdersImportWrite);

/** Everything the counting rule reads. No IO, no clock, no enclosing scope. */
export interface OrdersImportReportInput {
  /**
   * The lines the append filter LET THROUGH — what is on disk, and the basis of every
   * count below. Both kinds ride in one array because one `appendOrders` call wrote them.
   */
  written: readonly OrderRecord[];
  /**
   * What this batch PROPOSED to place — an ARRAY rather than a count, deliberately. See
   * the module header: `alreadyKnown` is this length less what landed, and one rule in one
   * place must count both halves of that subtraction.
   */
  placements: readonly OrderPlacedRecord[];
  /**
   * The old figure, per rung, joined onto the observations that were written.
   *
   * PASSED AS THE ALREADY-BUILT MAP rather than as the `restated` decision array, and the
   * choice is the #181 defect's own lesson: a decision array here could be ITERATED, which
   * is exactly how the old reporter came to describe lines the file did not hold. A Map is
   * only joinable — there is no entry point into it except an id read off a written line —
   * so the failure mode is unreachable by construction rather than by comment.
   */
  knownFigures: ReadonlyMap<string, number>;
  /**
   * The picks whose declared rung price differs from their order's price, per WRITTEN line
   * (#286). A Map for the same reason {@link OrdersImportReportInput.knownFigures} is one:
   * it is only joinable, so a difference with no line on disk cannot be reported.
   */
  pickedDifferences: ReadonlyMap<string, PickedPriceDifference>;
  /** The parser's skips, whole and unfiltered — the reporter discriminates, not the caller. */
  skips: BitgetRowSkip[];
  /** The export's path, as the operator named it. Interpolated into both notices. */
  csvPath: string;
}

/**
 * The outcome and the words for it — returned as a pair so the caller owns the write.
 */
export interface OrdersImportReport {
  outcome: OrdersImportRecorded;
  /** Ready to hand to `io.out` verbatim, trailing newline included. */
  message: string;
}

/** Count what landed, say what it means, and let the caller print it. */
export function reportOrdersImport(input: OrdersImportReportInput): OrdersImportReport {
  const { written, placements, knownFigures, pickedDifferences, skips, csvPath } = input;
  const appended = written.filter((record) => record.kind === "orderPlaced").length;
  const alreadyKnown = placements.length - appended;
  const observed: RecordedObservation[] = [];
  for (const record of written) {
    if (record.kind !== "orderFillObserved") {
      continue;
    }
    const known = knownFigures.get(record.id);
    // A written observation with no decision behind it cannot exist — every one of them
    // was built from a `restated` entry by the caller. Dropped rather than defaulted if it
    // ever did: inventing a `known` would print an arithmetic nobody performed.
    if (known !== undefined) {
      observed.push({ id: record.id, known, observed: record.observedFilledQuantity });
    }
  }

  // THE OBSERVATION CLAUSE RENDERS ALWAYS, INCLUDING AT ZERO. A clause that appears
  // conditionally is two shapes for a reader to learn and two for a test to assert, and
  // it is one more place for the two exits to diverge again. `appended` counts ORDERS,
  // so a pure-observation import reads `0 order(s) appended` beside a non-zero
  // observation count — which is the honest pair, not a contradiction.
  const counts =
    `${appended} order(s) appended, ${alreadyKnown} already known, ` +
    `${observed.length} observation(s) recorded`;
  const write = { appended, alreadyKnown, skips, observations: observed };

  // NOT `skips.length` (#184). `skips` is heterogeneous, and a `not-resting` row was read
  // COMPLETELY — the parser's finding about it is that nothing is still claimed. The gap
  // this line warns about is rungs we could not weigh, so both the discrimination and the
  // count below run through the engine's predicate rather than the raw total.
  // `outcome.skips` still carries every skip and stderr still reports every one of them.
  const unweighed = skips.filter((entry) => leavesRungUnweighed(entry.problem));

  // EACH NOTICE GETS ITS OWN LINE, OPENING ON WHAT IT IS ABOUT (`D3`, #177; #199). The
  // counts follow all of them, once — they used to be the whole line, with the notice a
  // suffix (`..., 1 row(s) skipped.`) in exactly the position an operator skims past.
  //
  // Unread rows lead, because they are the one thing here we know least about: a
  // restatement was read perfectly and we can state its figures, an unread row we cannot.
  const notices: string[] = [];

  if (unweighed.length > 0) {
    notices.push(
      `INCOMPLETE — ${unweighed.length} row(s) of ${csvPath} could not be read, so that ` +
        `many rung(s) resting at the venue are NOT counted as committed and available reads ` +
        `HIGH by whatever they encumber. Re-export and re-import to pick the missing ` +
        `rung(s) up; the reasons are on the error channel above.`,
    );
  }

  if (observed.length > 0) {
    // BOTH FIGURES AND NO REMAINDERS. The remainders were printed while the rung was
    // SKIPPED, because they were the safety argument an operator was owed a way to
    // check; the line is written now, so the file's remainder IS the venue's and the
    // pair would print the same number twice.
    const detail = observed
      .map((claim) => `${claim.id} (filled ${claim.known} → ${claim.observed})`)
      .join("; ");
    notices.push(
      `OBSERVED — ${observed.length} rung(s) of ${csvPath} have filled FURTHER at the ` +
        `venue since this file last observed them — ${detail} — and the restatement was ` +
        `RECORDED. Their remainders now read what the venue shows. This is NOT a ` +
        `qualification: the work is done, and the line does not reprint on the next ` +
        `import unless the venue moves again.`,
    );
  }

  // THE PICK FLAG, LAST AMONG THE NOTICES: it is the one that reports something that WENT
  // RIGHT — a deliberate declaration — rather than a gap. It renders only when there is a
  // difference, unlike the observation clause, because a batch with no picks at all is the
  // common case and a permanent `0 pick(s) differ` line would be noise on every import.
  const differing: string[] = [];
  for (const record of written) {
    if (record.kind !== "orderPlaced") {
      continue;
    }
    const difference = pickedDifferences.get(record.id);
    if (difference !== undefined) {
      differing.push(
        `${record.id} (rung declares ${difference.declared}, ` +
          `order at ${difference.order})`,
      );
    }
  }
  if (differing.length > 0) {
    notices.push(
      `PICKED — ${differing.length} order(s) were joined to a rung declared at a DIFFERENT ` +
        `price — ${differing.join("; ")} — and the pick was recorded as declared. This is not ` +
        `an error: a declared join beats a price match by design, and the operator may know ` +
        `something the match does not. It is stated here because nothing downstream will ` +
        `ever question it again.`,
    );
  }

  const message = [...notices, `Imported ${csvPath}: ${counts}.`].join("\n") + `\n`;

  // A ROW NOBODY COULD READ IS THE ONLY THING LEFT THAT QUALIFIES AN IMPORT (#181). A
  // restatement qualified while it was deferred; it is recorded here, so it does not.
  return {
    outcome:
      unweighed.length === 0
        ? { status: "imported", ...write }
        : { status: "imported-partial", ...write },
    message,
  };
}
