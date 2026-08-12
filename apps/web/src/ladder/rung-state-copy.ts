/**
 * THE WORDS THE FILL PATH PRINTS FOR ONE RUNG'S STATE — authored HERE, on the web, from
 * the two axes and nothing else (spec #302 slice D, issue #306; Seam C).
 *
 * ── WHY THIS MODULE EXISTS ──────────────────────────────────────────────────────────
 * The engine's `reconcileFillPath` also spells these words (`fill-path.ts`'s `label`), and
 * they crossed the wire as `DcaWireRung.label`. The web then BRANCHED on the literal: two
 * components asked `rung.label === "waiting"` to decide whether to print a state at all.
 * Rewording the engine's string broke the web silently — the engine's own tests move with
 * it, `tsc` stays green, every test stays green, and the rung list resumes printing the
 * default word down all eight rows, which is the exact thing the empty state column was
 * built to stop. That is a seam carrying COPY where it should carry FACTS.
 *
 * ── THE INVARIANT IS THE INPUT TYPE ─────────────────────────────────────────────────
 * {@link RungStateFacts} carries no string. Not "must not read `label`" in a comment about
 * another package: this function is never GIVEN the engine's words, so it cannot print
 * them, and a caller that tries to pass them fails to compile. The engine's `label` still
 * rides the wire — `projection/contract.ts` is untouched (C1), the phone-and-desk
 * convenience it was written to be — and the web reads it nowhere.
 *
 * ── EVERY ARM IS SPELLED, INCLUDING THE ABSENCES ────────────────────────────────────
 * `venueAxis` is optional on the wire and its two absences mean different things (absence
 * rule 1 vs rule 2), so the undefined arm branches on `reconciled` rather than falling
 * into a default. The rendered strings are UNCHANGED from what shipped; this module moves
 * their authorship, it does not reword them.
 */
import type { DcaWireBookAxis, DcaWireVenueAxis } from "../projection/contract.ts";

/**
 * WHAT THE SURFACE KNOWS about one rung's state — facts, never words. See the module
 * header: the absence of a `label` field here is the whole point of the type.
 */
export interface RungStateFacts {
  /** Absent means NO ORDER JOINED (rule 1) — or, unreconciled, "unknown" (rule 2). */
  venueAxis?: DcaWireVenueAxis;
  /** What the FUND recorded. Never collapsed into the venue axis. */
  bookAxis?: DcaWireBookAxis;
  /** Whether a reconciliation ran for this row at all — absence rule 2. */
  reconciled: boolean;
  /** MEASURED whole percent, present only on a `partly-filled` rung. */
  filledPercent?: number;
}

/**
 * The state words for one rung. ONE authoring site in `apps/web`; both the inspect card's
 * pill and the rung row's state column render this string and neither reads inside it.
 */
export function rungStateCopy(facts: RungStateFacts): string {
  const { venueAxis, bookAxis, reconciled, filledPercent } = facts;
  // ABSENCE RULE 1 AND RULE 2 MEET HERE, AND THE ARM IS SPELLED FIRST rather than fallen
  // into. A missing axis means "no order joined" only when a reconciliation ran; on a v4
  // row, or one whose sidecar could not be read, the same gap means "unknown" — and
  // printing `declared — not placed` there would state a fact nobody established.
  if (venueAxis === undefined) {
    return reconciled ? "declared — not placed" : "fill state unavailable";
  }
  switch (venueAxis) {
    case "not-placed":
      // A CANCELLED RUNG THE FUND BOOKED AGAINST IS NOT AN UNPLACED ONE. The claim left
      // the book, so the venue axis is exactly `not-placed`; the book axis is what says
      // capital the same card counts as deployed came through it. One word for both
      // would let this row contradict the `Deployed` figure beside it.
      return bookAxis === "recorded"
        ? "cancelled — fills recorded against it"
        : "declared — not placed";
    case "resting":
      // THE LADDER'S DEFAULT, and the reason `venueResting` is a field on the view: the
      // surface prints this state as an ABSENCE (an empty state column), so what it says
      // matters far less than which rungs are in it.
      return "waiting";
    case "partly-filled":
      // The percentage DECORATES the state, it does not replace it. Absent only on a
      // wire rung that carries the axis without its measured fraction — the state is
      // still the answer, so the arm prints the state rather than refusing.
      return filledPercent === undefined
        ? "partly filled"
        : `partly filled · ${filledPercent}%`;
    case "filled":
      // THE GAP BETWEEN THE AXES IS THE CALL TO ACTION, so it is in the words. A
      // `bookAxis` the wire did not carry is not a claim that the fund recorded it.
      return bookAxis === "recorded"
        ? "filled"
        : bookAxis === "partly-recorded"
          ? "filled at venue — partly recorded"
          : "filled at venue — not recorded";
  }
}
