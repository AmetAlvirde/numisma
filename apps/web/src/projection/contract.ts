/**
 * Projection contract — the SINGLE SOURCE OF TRUTH for the composition_snapshot
 * projection DB (ADR-007). Imported by BOTH the web reader (Deliverable E) and
 * the push shell (Deliverable C), so the schema version, the fund-id derivation,
 * and the row shape can never drift between writer and reader.
 *
 * The `report` column is typed as {@link ProjectionReport} — a `Pick` of the
 * engine's `CompositionReport`. That import is the compile-time drift guard: if
 * the engine's dashboard shape changes, `pnpm --filter @numisma/web typecheck`
 * breaks here.
 *
 * This module is the right home for the narrowing (D8): the engine must stay
 * unaware that a cloud exists, so the "what may leave the machine" decision
 * lives on the web side, next to the row shape it governs.
 *
 * IT IS PG-FREE, AND THAT IS LOAD-BEARING (audit finding 8). The Postgres reader
 * that used to sit at the bottom of this file now lives in `./snapshot-reader.ts`.
 * Because everything imports the contract and only the server-side dashboard
 * imports the reader, keeping the driver out of THIS module's reach is what lets a
 * shared RUNTIME value live here without dragging `pg` toward the client bundle
 * (`client-bundle.integration.test.ts`). `contract.test.ts` asserts the property
 * from the module graph, so it cannot rot into a comment. Add values here freely;
 * add an import of `pg`, or of anything that reaches it, and that suite goes red.
 */
import type { CompositionReport } from "@numisma/engine";
import { asOfSortKey } from "./as-of.ts";

/**
 * The ONLY slice of the engine's `CompositionReport` that is allowed to leave
 * the machine and land in the hosted projection DB (ADR-007 blast radius, as
 * re-decided in D8 of the 2026-07-24 hosted-security grill).
 *
 * DELIBERATELY DROPPED, and each drop is a decision, not an omission:
 *  - `invalidationWatch` — per-position stop levels (instrument, mark, level,
 *    direction, breached). The sharpest item in the system: positions PLUS the
 *    price at which the operator is forced out is materially more useful to an
 *    adversary than either alone. Near-zero value on the phone-glance view that
 *    justified the hosted leg.
 *  - `closedBook` — the full closed-trade blotter with realized P&L and
 *    open/close dates, including per-row `strategy` tags. Trade history, not
 *    current composition.
 *  - `priceJourneys`, `reserveReconciliation`, and the fold diagnostics
 *    (`warnings`, `excluded`, `load`) — operational detail with no phone-glance
 *    use case.
 *
 * WHY A `Pick` AND NOT A HAND-ROLLED INTERFACE: a `Pick` tracks the engine's own
 * types. If `totals` or `dashboard` is RENAMED upstream, this line stops
 * compiling and `pnpm --filter @numisma/web typecheck` goes red. A hand-rolled
 * mirror would keep compiling against a stale copy of the shape and let writer
 * and reader drift apart silently — which is exactly the failure that produced D8
 * in the first place (the engine grew, the projection inherited the growth, and
 * nothing said so).
 *
 * WHAT THE `Pick` DOES NOT DO — read this before trusting it: a `Pick` tracks
 * only the TOP-LEVEL key set. It says nothing about growth *inside* `totals` or
 * `dashboard`. Add `DashboardSummary.entryNote` or `CompositionRow.strategyLabel`
 * upstream and this line still compiles, {@link toProjectionReport} still copies
 * `report.dashboard` wholesale by reference, and the new field serializes
 * straight into the hosted JSONB — the identical drift D8 exists to stop, one
 * level deeper. {@link ProjectionKeyAllowList} is what closes that; it, not the
 * `Pick`, is the durable guard.
 *
 * A `Pick` narrows the TYPE only. The runtime narrowing is
 * {@link toProjectionReport}, which builds the payload key-by-key; a type
 * assertion over the wide object would still serialize every extra key into
 * JSONB. `push/projection-payload.test.ts` is the durable guard on THAT half —
 * it walks the actually-derived payload and allow-lists every key path it finds,
 * so a cast that smuggles the wide object through fails at runtime the same way
 * {@link ProjectionKeyAllowList} fails at compile time.
 *
 * Widening later is cheap by design: widen this `Pick`, bump
 * {@link COMPOSITION_SNAPSHOT_SCHEMA_VERSION}, re-push, deploy. The reader's
 * `status: "stale"` branch refuses a version it does not expect, so a stale
 * snapshot is a clean refusal, never a mis-render.
 */
export interface GlanceMissingMark {
  /**
   * The composition row id the absent mark belongs to — `instrument:<id>`, the
   * engine's own row-id convention. Slice 5's per-row suppression matches on it.
   */
  rowId: string;
  /** The row's display label (`SYMBOL (Name)`) — the same string `sections` carries. */
  label: string;
}

/**
 * The glance block (PRD #146 seam B) — the conclusions the READER cannot reach on
 * its own, computed push-side and shipped as conclusions rather than as inputs.
 *
 * THE RULE THAT PLACES EVERY FIELD HERE: *does this computation need data D8 keeps
 * off the wire?* If yes the push computes it and ships the answer; if no the reader
 * computes it from the wire plus the wall clock. Freshness is therefore NOT here —
 * it is `summary.asOf` against the clock, a render-time derivation. Expectation-vs-
 * arrival IS here, because it needs per-instrument mark dates that must never leave
 * the machine (D14).
 */
export interface GlanceBlock {
  /**
   * The Reserve FLOOR in force on THIS anchor, stamped by the push from the
   * as-of preferences sidecar (R5).
   *
   * ABSENT means no policy was in effect as-of this anchor (or the governing line
   * was quarantined). It is NEVER defaulted and NEVER `10` (V2/R1): rendering a
   * floor the operator never set is precisely the failure the invariant forbids.
   * `defaultProfitPolicyEntry` is a SEED FOR A NEW SIDECAR, not a read-gap filler.
   *
   * C4: the wire says `target`, the UI says `floor`. The divergence is deliberate
   * (renaming would mean migrating an append-only sidecar) — do not "fix" it.
   */
  reserveTargetPct?: number;
  /**
   * D14 — the CONCLUSION of expectation-vs-arrival, never the mark dates it was
   * computed from. `expected` is how many instruments the venue calendar says
   * should have quoted on this anchor; `arrived` how many did; `missing` names the
   * shortfall by row id + label, BOTH of which `sections` already carries, so this
   * block adds zero new classes of data.
   *
   * Rejected: `markAsOf?` on every `CompositionRow`. That ships a per-instrument
   * observation timeline — materially closer to the `priceJourneys` D8 dropped on
   * purpose — and discloses which instruments are actively traded.
   */
  feedGap: {
    expected: number;
    arrived: number;
    missing: GlanceMissingMark[];
  };
  /**
   * V5 — every number whose input was UNEXPECTEDLY absent, named by key. A key
   * present here means "this number would be wrong, so it is not rendered".
   *
   * A LIST OF KEYS, NOT N BOOLEANS, and that encoding is the point: this slice
   * emits the three header keys ({@link SUPPRESSION_KEYS}); slice 5 adds
   * `CompositionRow.id`s to the SAME array, at no schema cost. There is no v4 for
   * that extension (C5).
   */
  suppressed: string[];
  /**
   * #266 D6 — WHICH VENUE WENT DARK, on a day it owed marks and produced none.
   *
   * WHAT THIS EXISTS FOR. A venue that goes dark while still serving stale bars is
   * signalled by nothing: every instrument self-skips as INFO, the run exits 0, the
   * heartbeat reads healthy. The durable log's gap report now answers that question,
   * but its only automatic channel is the TUI's startup line — which speaks only when
   * the operator opens it, the same delivery failure the detector was written to fix.
   * This field is what makes the verdict reach a phone.
   *
   * IT DISCLOSES STRICTLY LESS THAN {@link GlanceBlock.feedGap} ALREADY DOES. That
   * block ships the row id AND label of every instrument whose mark did not arrive; a
   * venue name plus a weekday name is a coarser statement over the same event. ZERO
   * NEW CLASSES OF DATA — the same phrase `feedGap` above is admitted under.
   *
   * NO DATE, AND THAT IS THE WHOLE REASON IT SAYS `weekday`. `VenueDarkDay` in
   * `@numisma/event-store` carries the ISO date, because the gap report is a LOCAL
   * artifact — stdout, a git-ignored sidecar, the TUI. This is the hosted payload,
   * where `$.dashboard.summary.asOf` is the only date-shaped value that may exist
   * (`push/projection-payload.test.ts`, `push/anchor-fixture.test.ts`, ADR-007's prose
   * form). D7 already ruled the message shape — it "names venue and weekday so a
   * holiday reads as one" — so the weekday is what the surface wanted anyway.
   *
   * THREE STATES, AND ALL THREE ARE LOAD-BEARING:
   *
   *  - ABSENT — this build could not answer. Either the row predates v6, or the
   *    derivation failed and the push degraded the branch rather than withholding the
   *    anchor. It is NEVER an all-clear, and no surface may render it as one: a false
   *    *no* is the one failure a triage surface cannot have.
   *  - `[]` — checked, and no venue was dark in the window.
   *  - non-empty — the MOST RECENT dark day per venue inside the window, in
   *    `PRICE_SOURCES` order. Deduped rather than enumerated: a three-day outage
   *    carried whole would put three indistinguishable weekday names on the wire,
   *    which is a worse conclusion than one. Ship the conclusion, not the inputs.
   *
   * `source` is a bare `string`, unlike the DCA branch's narrowed unions. The venue
   * roster is registry-owned and grows without a schema change; nothing branches on
   * this value, it is rendered as a name.
   */
  venueDark?: GlanceVenueDarkDay[];
}

/**
 * One venue's most recent dark day inside the glance window — a CONCLUSION, and the
 * whole of what crosses. See {@link GlanceBlock.venueDark}.
 */
export interface GlanceVenueDarkDay {
  /** The venue that produced no marks — the registry's own `source` id. */
  source: string;
  /** The English weekday name of the day it owed them on. Never a date. */
  weekday: string;
}

/**
 * The DCA branch (spec #277) — the plans sidecar's as-of roster, narrowed to what a
 * phone glance can honestly show. DECLARED HERE, NOT YET ON THE WIRE: slice 1 defines
 * the shape and the builder; the cutover that adds it to {@link ProjectionReport},
 * latches it in {@link ProjectionKeyAllowList} and pays the version bump is slice 2.
 *
 * PROJECTION-OWNED, like {@link GlanceBlock} and for the same reason: the engine must
 * stay unaware that a cloud exists, so the "what may leave the machine" narrowing
 * lives on the web side. `DcaWireRung` deliberately does NOT reuse the engine's
 * `DcaRung` (`{ id, priceUsd, sizeUsd }`) — that is a different shape, and it stays
 * off the wire whole.
 *
 * NO DATE-SHAPED VALUE ANYWHERE IN THIS BRANCH. `effectiveAt` is a desk fact
 * (`pnpm plans` shows it), and three deliberate invariants depend on the payload
 * carrying exactly one date: `push/projection-payload.test.ts`,
 * `push/anchor-fixture.test.ts`, and ADR-007's prose form.
 */
export interface DcaBlock {
  /**
   * The loader's WHOLE-FILE outcome, which the per-row states cannot express: with
   * zero rows enumerable there is no row to carry a discriminant. A missing file is
   * `loaded`-with-empty — the normal starting state — while a real read error is
   * `load-failed`, mapped here to `"unreadable"`. Without this field the wire renders
   * a failed read as "no plans", the exact lie the engine names on `LoadedPlans`
   * (`packages/engine/src/plans.ts:289-292`).
   */
  source: "loaded" | "unreadable";
  /**
   * One row per position the sidecar names, in the roster's first-mention file order.
   * Rows whose lookup is `none` are OMITTED — absence is the encoding, and `none`
   * never appears on the wire (`D5`).
   */
  positions: DcaPositionRow[];
  /**
   * The COUNT of file-global skipped lines, never their content. Same discipline as
   * the glance block's conclusions: ship the conclusion, not the inputs.
   */
  unattributable: number;
  /**
   * THE COUNT OF OUTSTANDING TORN FILL ACTS (spec #285 / G-D7) — halves of a fill act
   * found on one file without their other half, which block recording until repaired.
   *
   * ON THE BRANCH ROOT BECAUSE THE FACT IS FUND-LEVEL. `reconcileFillActs` pairs the
   * WHOLE durable log against the WHOLE orders sidecar by a derived id; the result
   * belongs to no ladder in particular, so a per-row copy would either repeat one
   * number on every row or imply an attribution the detector never computed. G-D7
   * calls it a fund-level banner, and this is where a fund-level banner reads from.
   *
   * A COUNT, NEVER THE ACTS. Each `TornFillAct` carries an order id and a second-
   * granular `observedAt` — the two classes `push/dca-block.ts` exists to stop, and
   * the second of which would put a stamp on a branch that must stay DATE-FREE. The
   * surface needs to know THAT recording is blocked; the repair happens at the desk.
   *
   * PRESENT AT ZERO, unlike {@link DcaPositionRow.orphanLots}. That count sits beside
   * `figures`, whose presence already says a reconciliation ran, so its absence reads
   * unambiguously as "none". Here there is no such neighbour, so absence has to carry
   * the other meaning — this row could not check, which is a v4 row or an unreadable
   * orders sidecar — and "checked, none outstanding" must be a visible `0`.
   *
   * Optional for the version-range reason spelled on {@link DcaPositionRow.planId}.
   */
  tornActs?: number;
}

/**
 * WHAT THE VENUE SHOWED about a declared rung, narrowed from the engine's
 * `FillVenueAxis`. Spelled here rather than imported for the same reason `state` is:
 * this branch is PROJECTION-OWNED, and the wire's vocabulary must be decidable in this
 * file. `push/dca-block.ts` assigns the engine's union to this one, so an engine that
 * grows a fifth arm fails to compile there — named, at the seam, rather than shipping
 * a word the reader has no branch for.
 */
export type DcaWireVenueAxis = "not-placed" | "resting" | "partly-filled" | "filled";

/** WHAT THE FUND RECORDED, narrowed from the engine's `FillBookAxis`. Never collapsed
 * into the venue axis: the gap between the two IS the unrecorded-fill call to action. */
export type DcaWireBookAxis = "not-recorded" | "partly-recorded" | "recorded";

/** How the rung and its order found each other, so the card can show its confidence. */
export type DcaWireJoinProvenance = "declared" | "price-matched";

/**
 * The measured figures for ONE ladder (spec #285 / G-D8) — CONCLUSIONS of the engine's
 * reconciliation, never the lots and orders they were measured from.
 *
 * ABSENT, NEVER ZERO, for the three measured ones. A recorded fill has cost > 0 and
 * quantity > 0 by construction, so a `0` would be a bug rather than a fact, and the
 * surface renders an em-dash with a named cause where an absent figure sits. The block
 * itself is absent when no ladder was reconciled at all.
 *
 * BOTH WAITING FIGURES ARE ALWAYS PRESENT, because zero waiting capital is a real
 * answer. They differ ONLY on never-placed rungs: any rung with an order is resting
 * exactly while it is unfilled, by construction. The split is therefore
 * "declared but never placed" — capital the operator meant to encumber and has not —
 * and it is not a filled-vs-open distinction.
 */
export interface DcaWireFillFigures {
  deployedUsd?: number;
  unitsAcquired?: number;
  avgEntryUsd?: number;
  /** Σ `sizeUsd` of every rung not filled at the venue. Knowable on day zero. */
  waitingDeclaredUsd: number;
  /** Σ `sizeUsd` of the rungs that actually have an order resting at the venue. */
  waitingRestingUsd: number;
}

/** One position's plan status at one anchor — a conclusion, never the fold inputs. */
export interface DcaPositionRow {
  positionId: string;
  /**
   * The engine's five-arm `PlanLookup` minus `none`. `pending` means DECLARED, NOT
   * YET REALIZED (day zero renders the state word, never `$0`); `active` means the
   * plan is in force, which is a statement about policy and not about activity.
   */
  state: "pending" | "active" | "ended" | "unreadable";
  /** Present on `pending` and `active` rows only — the arms that carry a plan. */
  kind?: "dcaLadder" | "dcaTime";
  /** Present on `pending`/`active` `dcaLadder` rows only. Absent, never empty. */
  rungs?: DcaWireRung[];
  /**
   * THE LADDER'S OWN DURABLE IDENTITY (#286) — the plan record's `id`, a UUID, so a
   * route can resolve ONE ladder out of the roster (`/ladder/$planId`).
   *
   * A JOIN KEY, NEVER A LABEL. Nothing renders it as a name; a UUID is chosen over an
   * authored slug precisely so no meaning — venue, tier, date — can accrete in it.
   *
   * OPTIONAL BECAUSE THE READER ACCEPTS A RANGE, not because a v5 push may omit it: a
   * v4 row is still readable by this build (see
   * {@link MIN_SUPPORTED_SNAPSHOT_SCHEMA_VERSION}) and no v4 row carries one.
   */
  planId?: string;
  /**
   * The reconciled figures for this ladder. Absent when no reconciliation ran for the
   * row at all — a `dcaTime` plan, an `ended` row, or a v4 anchor.
   */
  figures?: DcaWireFillFigures;
  /**
   * The COUNT of recorded lots no declared rung explains — the same discipline as
   * `unattributable` beside it: the conclusion crosses, the lots do not. A lot is
   * position data of exactly the class D8 keeps off the wire; how MANY of them the
   * ladder cannot explain is a call to action the surface has to be able to make.
   */
  orphanLots?: number;
}

/**
 * A rung: the declared PRICE AXIS, plus what the venue and the book have since said
 * about it (spec #285).
 *
 * `sizeUsd` CROSSES, AND IT USED NOT TO. The contract said it stayed off on the grounds
 * that it was "a per-rung capital figure with no phone-glance use" and that the ladder's
 * capital question was answered by {@link DcaWireFillFigures}'s two waiting totals —
 * conclusions, it said, rather than the per-rung amounts they were summed out of. That
 * reasoning expired with slice 4's chart: the chart is `aria-hidden` (it is presentation,
 * and every per-rung fact it plots is already in the rung list), and its one irreplaceable
 * content — THE SHAPE OF THE CAPITAL CURVE, spec §6.3's caption "the deepest rung is 3.7×
 * the first" — is generated from per-rung declared size and from nothing else. A sum
 * cannot reconstruct the ladder it was summed from, so the accessible substitute for the
 * chart has no data source without this field.
 *
 * THE MARGINAL DISCLOSURE IS THE LADDER'S SHAPE, and that is the whole of it: every rung's
 * PRICE already crosses, and `waitingDeclaredUsd` is already the sum of these sizes, so
 * neither the levels nor the total is new. What becomes visible is how the operator
 * distributed capital across their own declared levels — the fund's intention, rendered
 * back to the operator who authored it, which G-D2 puts squarely under the authentication
 * ceiling. It remains a DECLARED figure: nothing about it is a fill, so it is present on
 * every rung of a v5 row including one with no order joined.
 *
 * EVERY FILL FIELD IS OPTIONAL AND OMITTED, never defaulted. A rung with nothing
 * recorded serializes to exactly what v4 shipped, which is what makes the version
 * range honest: absence is the day-zero state, spelled the same way by a v4 row and by
 * a v5 row for a ladder that has not moved.
 */
export interface DcaWireRung {
  /**
   * The rung's identity WITHIN its plan — the stable key slice 4's inspect panel and
   * keyboard rung rows select on.
   *
   * The contract used to call this "a join key for a fill export that does not exist
   * yet" and omit it on those grounds. That export is this increment; the reasoning
   * expired with it. Optional for the version-range reason spelled on
   * {@link DcaPositionRow.planId}, not because a v5 push may leave it out.
   */
  id?: string;
  priceUsd: number;
  /**
   * The capital the operator DECLARED for this rung — see the header for why it crosses
   * and what it discloses. Optional for the version-range reason spelled on
   * {@link DcaPositionRow.planId}: a v4 row carries none. Present on every v5 rung.
   */
  sizeUsd?: number;
  venueAxis?: DcaWireVenueAxis;
  bookAxis?: DcaWireBookAxis;
  /**
   * The rendered word(s) for the two axes together, spelled ONCE — in the engine's
   * reconciliation — so the phone and the desk cannot describe the same rung
   * differently. A convenience over the two axes, never a replacement for them.
   */
  label?: string;
  joinProvenance?: DcaWireJoinProvenance;
  /**
   * The price the joined order was actually PLACED at. Present only when it is a fact
   * the rung's own `priceUsd` does not already carry — i.e. alongside
   * {@link DcaWireRung.declaredPriceMismatch}, so the card can say what the operator
   * placed instead of merely that it differed.
   */
  orderPriceUsd?: number;
  /** A DECLARED join whose order price differs from the rung's. Honored, and flagged. */
  declaredPriceMismatch?: boolean;
  placedQuantity?: number;
  venueConsumedQuantity?: number;
  bookedQuantity?: number;
  /** MEASURED as `consumed / placed`, never guessed — it decorates `partly-filled`. */
  venueFilledFraction?: number;
  /** Whether the order is still claiming capital at the venue. */
  resting?: boolean;
}

/**
 * THE ONE DECLARED HOME for the three header suppression keys — the closed set of
 * standing numbers D3 names, spelled here and nowhere else (audit finding 7).
 *
 * WHY IT LIVES ON THE WIRE CONTRACT AND NOT PUSH-SIDE, where it was born: these are
 * not the push's private names. They are values that cross the wire in
 * {@link GlanceBlock.suppressed} as bare `string`s, so the type system cannot relate
 * the writer's spelling to the reader's. Before this constant was shared, a rename
 * push-side still compiled everywhere and the reader silently stopped suppressing —
 * rendering a NAV computed from a mark that never arrived, the false *no* the design
 * forbids. One home makes a rename move both halves at once.
 *
 * It is a RUNTIME value in a module every browser-reachable surface imports, which is
 * only safe because this file is pg-free and `contract.test.ts` holds it that way
 * from the module graph (audit finding 8). That property is what this constant is
 * standing on; do not import a driver here to save it a hop.
 *
 * `glance/suppression-seam.test.ts` pins the set, forbids a hand-typed literal in any
 * production speller, and drives push-emitted keys through the reader end to end.
 *
 * Slice #151 adds `CompositionRow.id`s to the SAME array (see `suppressedRowIds` in
 * `push/glance.ts`), which costs no schema change: that is the whole reason
 * `suppressed` was a key list and not N booleans, and it is why v3 is still v3. A
 * reader therefore tells the two apart by the key itself — the header keys are these
 * three literals, everything else is a row id.
 */
export const SUPPRESSION_KEYS = {
  fundValue: "summary.fundValueUsd",
  change: "summary.change",
  reserve: "summary.reserve",
} as const;

/**
 * The pushed payload: the engine `Pick` above PLUS a third top-level branch the
 * PROJECTION authors.
 *
 * WHY A THIRD BRANCH AND NOT NEW `DashboardSummary` FIELDS. Putting `glance` on
 * `dashboard` means widening an engine type — which drags the TUI along, re-opens
 * D8's "what may leave the machine" one level down, and makes the engine aware a
 * cloud exists. This module's own header states the opposite principle. A block
 * authored here keeps the engine at ZERO contract change (C1) and passes the
 * deletion test cleanly: delete `glance` and the glance feature dies; nothing else
 * notices.
 */
export type ProjectionReport = Pick<CompositionReport, "totals" | "dashboard"> & {
  glance: GlanceBlock;
  /**
   * The DCA branch (spec #277) — the plans sidecar's as-of roster, narrowed by
   * `push/dca-block.ts`. Projection-authored for the same reason `glance` is: the
   * engine stays at ZERO contract change, and deleting this key deletes the feature
   * and nothing else.
   */
  dca: DcaBlock;
};

/** Resolves to `T` only when `T` is `true`; otherwise the alias itself errors. */
type Assert<T extends true> = T;

/** Element type of an array type — used to reach INTO `sections` and `rows`. */
type ElementOf<T> = T extends readonly (infer E)[] ? E : never;

/**
 * Compile-time proof that `T`'s key set is EXACTLY `Allowed` — neither side
 * carrying a key the other lacks.
 *
 * Resolves to `true` when they match. When they do not it resolves to an object
 * type whose single SHOUTING property name is the diagnosis and whose value type
 * is the offending key, so the `Assert<...>` below fails with the actual key
 * named in the compiler error rather than a bare `true`/`false` mismatch.
 *
 * Both directions matter. Unlisted keys are the leak this exists to stop; listed
 * keys the type no longer has are how an allow-list rots into decoration.
 */
type KeysAreExactly<T, Allowed extends string> = [
  Exclude<keyof T, Allowed>,
] extends [never]
  ? [Exclude<Allowed, keyof T>] extends [never]
    ? true
    : {
        ALLOW_LIST_NAMES_A_KEY_THE_ENGINE_TYPE_NO_LONGER_HAS: Exclude<
          Allowed,
          keyof T
        >;
      }
  : {
      ENGINE_GREW_A_KEY_THE_PROJECTION_ALLOW_LIST_DOES_NOT_NAME: Exclude<
        keyof T,
        Allowed
      >;
    };

type ProjectionSummary = ProjectionReport["dashboard"]["summary"];
type ProjectionFocus = NonNullable<ProjectionSummary["largestPortfolio"]>;
type ProjectionSection = ElementOf<ProjectionReport["dashboard"]["sections"]>;
type ProjectionRow = ElementOf<ProjectionSection["rows"]>;

/**
 * THE DURABLE NARROWING GUARD (D8) — an exhaustive ALLOW-LIST over every key at
 * every depth of {@link ProjectionReport}, checked by the compiler.
 *
 * WHY AN ALLOW-LIST AND NOT A BLOCKLIST: "what may leave the machine" is a
 * closed question, so it needs closed-world enforcement. A blocklist of known-bad
 * key names (`strategy`, `invalidation`, …) only ever catches the leaks somebody
 * already thought of; a field nobody anticipated passes it by construction. This
 * inverts the polarity — every key must be named HERE to be allowed out, so an
 * engine increment that adds ANY field under `totals` or `dashboard` fails
 * `pnpm --filter @numisma/web typecheck` and forces a deliberate re-decision
 * instead of silently inheriting it.
 *
 * WHEN THIS GOES RED: do not reflexively paste the new key in. Decide whether it
 * may leave the machine at all. If yes, add it here and bump
 * {@link COMPOSITION_SNAPSHOT_SCHEMA_VERSION}. If no, drop it in
 * {@link toProjectionReport} — which then has to stop copying its parent
 * wholesale and construct that level key-by-key too.
 *
 * Exported so it can never be dead-code-eliminated or flagged unused; it carries
 * no runtime value and is erased at build.
 */
export type ProjectionKeyAllowList = {
  /**
   * THE TOP-LEVEL LATCH — the branch set itself, closed at compile time.
   *
   * It did not exist until spec #277 went looking for it, and its absence was a real
   * hole: every entry below latches the INSIDE of a branch, so a FIFTH top-level
   * branch could be added to {@link ProjectionReport} and construct cleanly in
   * {@link toProjectionReport} without one compile-time assert firing. Only the
   * runtime latches would have caught it, and only if somebody ran the push tests.
   * A new branch is the single most expensive thing that can happen to this payload
   * — it is what makes a version bump unavoidable — so it is now the one thing that
   * cannot happen quietly.
   */
  report: Assert<
    KeysAreExactly<ProjectionReport, "totals" | "dashboard" | "glance" | "dca">
  >;
  totals: Assert<
    KeysAreExactly<
      ProjectionReport["totals"],
      "baseCurrency" | "fundValueUsd" | "usdMxn"
    >
  >;
  dashboard: Assert<
    KeysAreExactly<ProjectionReport["dashboard"], "summary" | "sections">
  >;
  summary: Assert<
    KeysAreExactly<
      ProjectionSummary,
      | "fundName"
      | "asOf"
      | "fundValueUsd"
      | "usdMxn"
      | "totalUnrealizedPnlUsd"
      | "largestPortfolio"
      | "largestTempo"
      | "largestAccount"
      | "largestInstrument"
      | "reserve"
      | "dataSafety"
    >
  >;
  summaryDataSafety: Assert<
    KeysAreExactly<
      ProjectionSummary["dataSafety"],
      | "nonLiveExcluded"
      | "invalidExcluded"
      | "shortDeferredExcluded"
      | "hasWarnings"
    >
  >;
  /** Shared by every `largest*` field and `reserve` on the summary. */
  summaryFocus: Assert<
    KeysAreExactly<
      ProjectionFocus,
      "rowId" | "kind" | "label" | "usdValue" | "percentOfFund"
    >
  >;
  section: Assert<
    KeysAreExactly<ProjectionSection, "id" | "title" | "rows">
  >;
  sectionRow: Assert<
    KeysAreExactly<
      ProjectionRow,
      | "id"
      | "kind"
      | "label"
      | "usdValue"
      | "percentOfFund"
      | "costBasisUsd"
      | "unrealizedPnlUsd"
    >
  >;
  /**
   * The glance branch. The compile-time half is weaker here BY NATURE — the
   * projection owns `GlanceBlock`, so widening the type and widening the allow-list
   * are one edit away from each other, where the engine branches above are guarded
   * across a package boundary. The RUNTIME guard is not weaker:
   * `push/projection-payload.test.ts` walks the actually-derived payload and
   * allow-lists every key path it finds, so a wider block fails there the same way
   * an engine growth fails here. These three lines still earn their keep as the
   * place a reviewer sees the block's shape declared as closed.
   */
  glance: Assert<
    KeysAreExactly<
      GlanceBlock,
      | "reserveTargetPct"
      | "feedGap"
      | "suppressed"
      // #266 D6 — ENUMERATED, like every growth before it. A second block-root field
      // is the most expensive kind of addition this branch can take, so it is spelled
      // out here rather than absorbed into an existing key the way row ids were
      // absorbed into `suppressed` (C5).
      | "venueDark"
    >
  >;
  glanceFeedGap: Assert<
    KeysAreExactly<GlanceBlock["feedGap"], "expected" | "arrived" | "missing">
  >;
  glanceMissing: Assert<KeysAreExactly<GlanceMissingMark, "rowId" | "label">>;
  glanceVenueDark: Assert<KeysAreExactly<GlanceVenueDarkDay, "source" | "weekday">>;
  /**
   * The DCA branch. Projection-owned like the glance block above, with the same
   * compile-time weakness and the same runtime backstop — `push/projection-payload
   * .test.ts` walks the derived payload and allow-lists every path it finds. What
   * these three lines buy is the reviewer's-eye declaration that the block is CLOSED:
   * an `effectiveAt`, a `sizeUsd` or an `endedBy` added to any of the three shapes
   * fails HERE, named, before anyone has to notice it in a fixture diff.
   */
  dca: Assert<
    KeysAreExactly<
      DcaBlock,
      | "source"
      | "positions"
      | "unattributable"
      // The fund-level count, enumerated beside the file-level one it shares its
      // discipline with. A second block-root field is the most expensive kind of
      // addition this branch can take, which is why it is spelled out here.
      | "tornActs"
    >
  >;
  dcaPosition: Assert<
    KeysAreExactly<
      DcaPositionRow,
      | "positionId"
      | "state"
      | "kind"
      | "rungs"
      // Spec #285 slice 3 — ENUMERATED, one line per field, never widened to a
      // wildcard. Each of these was decided: a UUID join key, the reconciliation's
      // figures, and a count of the lots no rung explains.
      | "planId"
      | "figures"
      | "orphanLots"
    >
  >;
  dcaRung: Assert<
    KeysAreExactly<
      DcaWireRung,
      | "id"
      | "priceUsd"
      // The declared per-rung capital figure, admitted by name. Its absence from this
      // list WAS the decision that kept it off the wire; this line is what admitting it
      // looks like, and the reasoning is on {@link DcaWireRung}'s header rather than
      // here so it sits beside the field it governs.
      | "sizeUsd"
      // The fill state, enumerated.
      | "venueAxis"
      | "bookAxis"
      | "label"
      | "joinProvenance"
      | "orderPriceUsd"
      | "declaredPriceMismatch"
      | "placedQuantity"
      | "venueConsumedQuantity"
      | "bookedQuantity"
      | "venueFilledFraction"
      | "resting"
    >
  >;
  dcaFigures: Assert<
    KeysAreExactly<
      DcaWireFillFigures,
      | "deployedUsd"
      | "unitsAcquired"
      | "avgEntryUsd"
      | "waitingDeclaredUsd"
      | "waitingRestingUsd"
    >
  >;
};

/**
 * Build the pushed payload BY EXPLICIT CONSTRUCTION — the runtime half of the
 * {@link ProjectionReport} narrowing.
 *
 * Key-by-key on purpose. `report as ProjectionReport` would satisfy the compiler
 * while the value at runtime is still the whole wide report, and every dropped
 * field would serialize straight into the `report` JSONB column. The type is the
 * intent; this function is the enforcement.
 *
 * `glance` is a REQUIRED argument, not an optional one with a default. There is no
 * honest empty glance: an all-zero `feedGap` asserts "nothing was expected and
 * nothing is missing", which on a real Tuesday outage is the false *no* a triage
 * surface cannot have. A caller that has no glance to give must not push.
 *
 * `dca` IS REQUIRED FOR THE SAME REASON, one step sharper: the block's own `source`
 * field is what separates "the sidecar names no plans" from "the file could not be
 * read", so a defaulted empty block would manufacture the first answer out of the
 * absence of any answer at all. There is no honest default; a caller that cannot read
 * the plans sidecar must not push.
 */
export function toProjectionReport(
  report: CompositionReport,
  glance: GlanceBlock,
  dca: DcaBlock,
): ProjectionReport {
  return {
    totals: report.totals,
    dashboard: report.dashboard,
    glance,
    dca,
  };
}

/**
 * Version of the payload shape stored in the projection. Bump this in lockstep
 * with any breaking change to {@link ProjectionReport} so the reader can REFUSE
 * to render a stale snapshot instead of mis-rendering it.
 *
 * History:
 *  - v1 — the whole engine `CompositionReport` was pushed.
 *  - v2 — payload narrowed to `{ totals, dashboard }` (D8). `invalidationWatch`,
 *    `closedBook` (and its `strategy` tags), `priceJourneys`,
 *    `reserveReconciliation` and the fold diagnostics no longer leave the
 *    machine. A v1 row read by a v2 reader yields `status: "stale"`.
 *  - v3 — the third top-level `glance` branch (PRD #146 seam B): the as-of Reserve
 *    floor, the derived `feedGap` conclusion, and the `suppressed` key list. The
 *    engine's contract is UNCHANGED by this bump (C1) — the block is authored here.
 *    A v2 row read by a v3 reader is `status: "stale"`, and v2 rows are dropped
 *    from `anchors` entirely (see `getSnapshotHistory` in `./snapshot-reader.ts`),
 *    which is what makes
 *    the cutover graceful: the next daily push writes a v3 row that renders
 *    immediately, and leftover v2 rows are simply unresolvable as references until
 *    the backfill upgrades them.
 *
 *  - v4 — the fourth top-level `dca` branch (spec #277): the plans sidecar's as-of
 *    roster, narrowed to `{ source, positions, unattributable }` with `priceUsd`-only
 *    rungs. The engine's contract is again UNCHANGED (C1) — the block is authored
 *    here, from the engine's pure `listPlansAsOf` selector. A v3 row read by a v4
 *    reader is `status: "stale"`, and both routes REFUSE to render on the mismatch,
 *    so the cutover is deliberately hard: deploy, then backfill immediately. The
 *    backfill is upsert-only, so every existing row is rewritten in place at v4 and
 *    the row count does not move.
 *
 * WHY THIS IS A v4 AND THE GLANCE'S OWN GROWTH WAS NOT. C5 carves out exactly two
 * additive shapes — an optional `reserveCeilingPct?` beside the floor, and new
 * strings inside `suppressed` — and both live INSIDE an existing branch whose reader
 * already walks it. That is why `suppressed` absorbing row ids stayed v3. A NEW
 * TOP-LEVEL BRANCH is outside those carve-outs by construction: a v3 reader handed
 * this payload has no code that looks at `dca` at all, so "additive" would describe
 * the bytes while the reader silently rendered a fund with no visible strategy. The
 * carve-outs are about fields a stale reader can safely ignore; a branch nobody can
 * ignore is what the version number is for.
 *
 *  - v5 — the Fill Path (spec #285): optional per-rung fill state, the rung's declared
 *    `sizeUsd`, the ladder's `planId`, the reconciled {@link DcaWireFillFigures}, the
 *    orphan-lot count and the fund-level {@link DcaBlock.tornActs} count, all INSIDE the
 *    existing `dca` branch. No new top-level branch, so the deletion test still passes
 *    cleanly: delete the fill path and the branch reverts to its v4 shape.
 *
 * WHY THIS IS A BUMP AT ALL, GIVEN EVERY NEW FIELD IS OPTIONAL. It is not the reader's
 * safety that forces it — a v4 reader handed a v5 row would simply not look at the new
 * fields, which is the C5 carve-out exactly. It is the WRITER'S contract: the version
 * is what tells a reader whether an absent `venueAxis` means "this build could not
 * have written one" or "nothing is recorded on this rung". Both are absences; only the
 * version tells them apart, and the surface says different things about them.
 *
 * AND THIS BUMP COSTS NO CUTOVER WINDOW, which every bump before it did. See
 * {@link MIN_SUPPORTED_SNAPSHOT_SCHEMA_VERSION}.
 *
 *  - v6 — the venue-dark verdict (#266 D6): an optional {@link GlanceBlock.venueDark},
 *    naming the venue and the weekday of each venue's most recent dark day, INSIDE the
 *    existing `glance` branch. No new top-level branch, and therefore no ADR-007
 *    amendment: the carve-out reasoning above applies unchanged, and what crosses
 *    discloses strictly less than `feedGap.missing[]` — which already ships the row id
 *    and label of every instrument whose mark did not arrive — so it adds zero new
 *    classes of data. The deletion test still passes cleanly: delete the venue-dark
 *    field and the branch reverts to its v5 shape.
 *
 * WHY THIS IS A BUMP AT ALL, in v5's own terms. It is not the reader's safety that
 * forces it — a v5 reader handed a v6 row would simply not look at the new field, the
 * C5 carve-out exactly. It is the WRITER'S contract: the version is what tells a reader
 * whether an absent `venueDark` means "this build could not have written one" or "no
 * venue was dark in the window". Both are absences, only the version tells them apart,
 * and the surface must say nothing at all about the first — an all-clear rendered off a
 * build that never checked is the false *no* this whole issue exists to remove.
 *
 * AND IT COSTS NO CUTOVER WINDOW EITHER, for v5's reason: the field is optional and its
 * absence on a v4 or v5 row is a TRUE statement about that build.
 */
export const COMPOSITION_SNAPSHOT_SCHEMA_VERSION = 6;

/**
 * THE OLDEST STORED VERSION THIS BUILD WILL RENDER (spec #285 / G-D9) — the decision
 * that abolishes the cutover window permanently.
 *
 * Every earlier bump was an equality test against
 * {@link COMPOSITION_SNAPSHOT_SCHEMA_VERSION}, so the instant the constant moved, every
 * row already in the projection became unreadable and the phone refused until a
 * backfill finished. That window was survivable when it was minutes and an outage when
 * a hosted credential turned out to point somewhere else.
 *
 * The reader now accepts `MIN_SUPPORTED ≤ stored ≤ CURRENT`, WHICH REVERSES THE DEPLOY
 * ORDER: the reader ships FIRST, understanding both shapes, and the first v5 row lands
 * into a build that was already ready for it. There is never an instant when the phone
 * reads a version it does not understand — not at this bump and not at the next one,
 * provided the floor is raised only when a version genuinely stops being renderable.
 *
 * FOUR IS THE FLOOR BECAUSE V4 IS RENDERABLE, and that is the whole test. Everything v5
 * added is optional, and its absence on a v4 row is a TRUE statement about that day:
 * no fill was recorded, because the anchor predates the plumbing that could record one.
 * v6 (#266) leaves the floor where it is for exactly the same reason: an absent
 * `venueDark` on a v4 or v5 row truthfully says that build could not have written one,
 * and the surface renders NOTHING there — never an all-clear.
 * A v3 row is a different case and is still REFUSED — it carries no `dca` branch at
 * all, so rendering it would show a fund with no visible strategy rather than a fund
 * whose strategy has not moved.
 *
 * RAISING THIS IS A DECISION, not bookkeeping that follows the bump above. Raise it
 * only when a stored shape can no longer be rendered honestly, and expect the refusal
 * card's copy to change with it.
 */
export const MIN_SUPPORTED_SNAPSHOT_SCHEMA_VERSION = 4;

/** Is a stored `schema_version` one this build can render? The range, spelled once. */
export function isSupportedSchemaVersion(storedVersion: number): boolean {
  return (
    storedVersion >= MIN_SUPPORTED_SNAPSHOT_SCHEMA_VERSION &&
    storedVersion <= COMPOSITION_SNAPSHOT_SCHEMA_VERSION
  );
}

/**
 * Deterministic fund id: slug of the fund name — lowercased, every run of
 * non-alphanumeric characters collapsed to a single "-", leading/trailing "-"
 * trimmed. Fixture ("Sanitized Exploratory Fund") -> "sanitized-exploratory-fund".
 */
export function fundIdOf(report: CompositionReport): string {
  return report.dashboard.summary.fundName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Chronologically-comparable sort key for an `as_of` calendar date — see
 * {@link asOfSortKey} in `./as-of.ts` for why the ordering is typed rather than
 * lexical.
 *
 * IMPLEMENTED IN `./as-of.ts`, re-exported here. `asOf` ordering is part of the
 * stored contract — every consumer that compares two anchors must compare them the
 * same way, and re-deriving date ordering by string comparison anywhere else would
 * re-introduce exactly the lexical trap that function exists to stop. So it is
 * named on the contract surface, alongside the {@link SnapshotAnchor} it orders.
 *
 * It sits ABOVE the reader seam deliberately: `./snapshot-reader.ts` is one of its
 * callers, not its owner. When the reader lived in this file, this re-export was
 * the last thing standing between the wire contract and the driver.
 */
export { asOfSortKey };

/** One stored anchor: a single `(fund_id, as_of)` row's identity plus its payload. */
export interface SnapshotAnchor {
  fundId: string;
  asOf: string;
  report: ProjectionReport;
}

/**
 * Discriminated result of `getSnapshotHistory` (`./snapshot-reader.ts`).
 *
 * The TYPE lives here, with the row shape it is built from; the query that
 * produces it lives with the driver. Every consumer of the result — the session
 * gate, the render surfaces — imports only this, and so imports no `pg`.
 *
 * Same `empty | stale | ok` union the single-day reader always returned, widened on
 * the `ok` branch to carry BOTH `latest` and the full `anchors` history. D4's named
 * reference — the entire change/delta feature — has no delivery mechanism without
 * it, because the app could previously only ever see one day.
 *
 * Nearest-anchor resolution (V3) deliberately does NOT live here. It is a pure
 * function over `anchors` and belongs to slice 4's verdict module: this query
 * returns the anchors, it does not interpret them.
 */
export type SnapshotHistory =
  | { status: "empty" }
  | {
      status: "stale";
      storedVersion: number;
      /**
       * THE SUPPORTED RANGE, not a single expected version (spec #285 / G-D9). It was
       * `expectedVersion: number` while the reader tested equality; reshaped
       * DELIBERATELY rather than left as the range's upper bound, because a refusal
       * card that says "expects 5" while the reader happily renders 4 is a rendered
       * lie — and the copy that reads it is the one place an operator meets this type.
       */
      expectedVersions: { min: number; max: number };
    }
  | { status: "ok"; latest: SnapshotAnchor; anchors: SnapshotAnchor[] };
