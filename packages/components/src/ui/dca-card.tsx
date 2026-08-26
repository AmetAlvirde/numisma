import type { ReactElement, ReactNode } from "react";
import { formatUsd } from "@numisma/engine/format";
import { Absent } from "./absent";
import { Card } from "./card";
// The table surface, from the component that owns its deleted element rules (spec #420
// Seam B — the first surface in the migration's order converts every carrier, wherever
// it renders). The rung ladder is a table on the same terms as the composition one.
// `SectionTable` crossed into the package in spec #439 S2 and took the six strings with
// it; this card followed in S4 and now reads them as siblings.
import {
  TABLE_CELL,
  TABLE_CELL_NUM,
  TABLE_HEAD_CELL,
  TABLE_HEAD_CELL_NUM,
  TABLE_SCROLL,
  TABLE_SURFACE,
} from "./section-table";

/**
 * THE DCA CARD (spec #277, D4/D6) — the declared accumulation plan, on the phone.
 *
 * WHAT IT IS FOR: *is my accumulation plan still what I think it is?* That question
 * is checked at the same frequency as the verdict above it, which is why this
 * standing content sits on `/` and the composition tables do not (see
 * `routes/index.tsx`'s header for the reversal and its reason).
 *
 * DAY ZERO SHOWS `pending`, NEVER `$0` (D4). Zero is a MEASUREMENT — it asserts that
 * accumulation happened and came to nothing. `pending` is the absence of one: the
 * plan is declared and not yet realized. The two are different facts and this card
 * shows no capital figure at all, so it cannot accidentally state the first while
 * meaning the second. The wire carries no rung SIZES either, deliberately, so the
 * mistake is unavailable rather than merely avoided.
 *
 * ── THE CHART GATE IS RETIRED (spec #285 §6.2, slice #289) ──────────────────────────
 * This header used to say a price-axis chart was "gated on node 7.10 (#145)" — the
 * sign-in design issue. THAT WAS TRUE AND IS NOT ANY MORE, and a false constraint left
 * standing is worse than none: the next reader takes it as a live rule and does not
 * build the thing. The chart shipped in slice #289 on `/ladder/$planId`, and `styles.css`
 * gained an appended block with nothing above it changed, so the constraints the gate was
 * protecting held anyway. This paragraph also used to say "no chart library" — true of
 * #289's hand-rolled SVG, FALSE SINCE the Price Drop Path adopted `@tanstack/charts`
 * (**ADR-018**), which is the only place that decision is recorded (M5.1, spec #302 §5).
 * #145 stays independent (G-D10a); this card inherits the theme when it lands.
 *
 * THE TABLE IS STILL THE PLOT HERE. The rungs price-sorted descending — the sort lives
 * in `glance/dca-view.ts`, never here — read top-down as the ladder itself, at zero
 * substrate cost. The chart is one tap down, where there is room for it.
 *
 * ── THE CARD IS THE ALERT AND THE TAP TARGET (G-D13) ────────────────────────────────
 * It answers *does anything need me?* — rung counts, and a warning when a venue fill has
 * no recorded lot — and links to the ladder, which answers *where am I?*. The counts are
 * computed in `glance/dca-view.ts`; the link needs `planId`, which a v4 row does not
 * carry, so both are rendered only where the wire actually supplies them.
 *
 * ABSENCES ARE RENDERED AND NAMED, the same invariant as `GlanceCard`'s and
 * `SectionTable`'s, sharing their em dash: a plan with no ladder to show says WHY,
 * because "no rungs" and "not a rung-shaped plan" are different amounts of
 * information. And an unreadable file NEVER renders as "no plans" — that lie is the
 * exact thing the wire's `source` field exists to prevent.
 *
 * COUNTS, NEVER CONTENT. `unattributable` renders as a number of lines. The plans
 * sidecar's line content is operator capital declaration and never reaches this
 * surface — it is not even on the wire to render.
 */

/* ─────────────────────────────────── the shape ────────────────────────────────── */

/**
 * THE FOUR VIEW TYPES ARE DECLARED HERE AND `glance/dca-view.ts` IMPORTS THEM BACK
 * (spec #439 §4.1, S4). The consumer defines the interface, which is the standard
 * direction and also the only one that lets `dca-card.fixtures.ts` build a `DcaView`
 * literal without importing `apps/web` — `seam-isolation.test.ts` forbids that on
 * every specifier.
 *
 * `composeDcaView` keeps every line of its derivation: the price sort, the copy before
 * the sort, and the `figures`-is-the-gate rule. It RETURNS this `DcaView`, so the arrow
 * points both ways and a field that moves on either side stops compiling on both.
 *
 * TWO FIELDS BELOW ARE INDEXED ACCESSES INTO A TYPE THAT DOES NOT MOVE.
 * `projection/contract.ts` is read by 34 files including all of `push/`, so moving it
 * would make the push script import a React package. `DcaPositionRow["state"]` and
 * `DcaPositionRow["kind"]` are therefore spelled out here — and they do not drift
 * silently for the reason above: `composeDcaView` assigns `position.state` straight
 * into a `DcaPositionView` and spreads `position.kind` into the same object, so a fifth
 * state or a third kind stops that assignment compiling, in `apps/web`, in front of the
 * author who would have to decide what this card says about it.
 */

/**
 * THE ALERT LINE'S THREE COUNTS (spec #285 G-D13, slice #289) — what the card says
 * before the operator taps it: `8 rungs · 4 filled · ⚠ 1 needs recording`.
 *
 * COUNTS, NOT AMOUNTS. The card still shows no capital figure of any kind, for the
 * reason this file's header gives: day zero must render `pending`, never `$0`. A count
 * of rungs is a cardinality and carries no such trap.
 */
export interface DcaAlertView {
  rungs: number;
  /** Rungs the VENUE reports filled — the walk so far, as the venue sees it. */
  filled: number;
  /** Filled at the venue with no lot recorded. The only thing here that needs action. */
  needsRecording: number;
}

/** One rung, ready to render — the price axis and nothing else, as it arrives. */
export interface DcaRungView {
  priceUsd: number;
}

/** One position's plan, shaped so the card branches on data rather than on absence. */
export interface DcaPositionView {
  positionId: string;
  /** `DcaPositionRow["state"]`, spelled out. See the section header for why. */
  state: "pending" | "active" | "ended" | "unreadable";
  /**
   * Present on `pending`/`active` rows only, exactly as the wire has it.
   *
   * THE `| undefined` IS LOAD-BEARING. `DcaPositionRow.kind` is itself optional, so the
   * indexed access this replaces already carried `undefined`, and both tsconfigs set
   * `exactOptionalPropertyTypes: true`. Writing `kind?: "dcaLadder" | "dcaTime"` here
   * compiles, looks right, and is NARROWER than the type the app has today: it makes an
   * explicit `kind: undefined` an error at every call site that writes one.
   */
  kind?: "dcaLadder" | "dcaTime" | undefined;
  /**
   * The declared rungs, DESCENDING by price — and ALWAYS an array, empty where the
   * wire has no `rungs` key at all. That normalization is the point: a `dcaTime` plan
   * and an ended ladder are different FACTS, carried by `state` and `kind`, and the
   * card should read them there rather than inferring them from a missing key.
   */
  rungs: readonly DcaRungView[];
  /**
   * THE LADDER'S DURABLE IDENTITY, carried so the card can be the TAP TARGET for the
   * ladder route. Absent on a v4 row, which is exactly why the card branches on it
   * rather than assuming a link is always available.
   *
   * A JOIN KEY, NEVER A LABEL. It goes out through {@link DcaCard}'s `renderLink` slot
   * and nowhere else; nothing renders it as a name.
   */
  planId?: string;
  /**
   * The alert counts, PRESENT ONLY WHEN THE ROW RECONCILED. An unreconciled row (a v4
   * anchor, an unreadable orders sidecar) has no `figures`, and rendering `0 filled`
   * for it would state a measurement nobody took — the same absent-not-zero discipline
   * the rest of that increment runs on. The card renders the plan without an alert.
   */
  alert?: DcaAlertView;
}

export interface DcaView {
  /**
   * The loader's whole-file failure, raised to the one boolean the card renders. An
   * unreadable file and a file that declares no plan both produce zero positions, and
   * they must NOT render the same empty — that is the entire reason `source` is on
   * the wire.
   */
  unreadable: boolean;
  /** One entry per declared position, in the wire's own first-mention order. */
  positions: readonly DcaPositionView[];
  /** The COUNT of unreadable lines that named no position. Never their content. */
  unattributable: number;
}

/**
 * THE TAP-THROUGH LEAVES BY A SLOT, AND IT IS OPTIONAL (spec #439 §4.6, S4).
 *
 * `@numisma/workbench` depends on this package, React, and nothing else — no router and
 * no SSR, stated in its vite config as the whole point of the second consumer — so
 * TanStack Router is not available here and this package's manifest does not name it.
 * `route-move.test.ts`'s dependency pin asserts that manifest exactly.
 *
 * A LINK-ADAPTER CONTEXT LOSES, on `Crumb`'s reasoning: TanStack checks `to` against the
 * generated route tree, and an adapter normalising every destination to `to: string`
 * would throw that check away silently, shipping the first typo in a route path. The
 * slot keeps the call site building a fully typed `<Link>` with its own literal
 * destination, where the route tree is in scope.
 *
 * `planId` WIDENS IT, WHERE `Crumb` REFUSED `params` A SLOT. `Crumb` gets away with
 * keeping everything about navigation at the call site because its caller knows the
 * destination. This one's does not: `planId` arrives inside `view`, per position, and
 * the card holds the only copy. So the slot hands it out — one field, no `to`, no
 * `search`, no route object.
 *
 * OPTIONAL IS THE BETTER HALF, and it is the part to check. This card already carries a
 * no-link arm: `planId` is absent on a v4 row and the alert renders as a plain paragraph
 * in that case, today, in production. So an absent slot renders the REAL unlinked
 * paragraph rather than a dead `<a href="#">`. Nothing has to pretend, which is why
 * currying — byte-identical to wave 1's signature at the cost of a two-level function at
 * every call site — lost.
 *
 * THE ARROW GLYPH STAYS THE PACKAGE'S, deliberately unlike `Crumb`'s. `Crumb`'s arrow is
 * the caller's because two of its five usages point in opposite directions. Here there is
 * one destination, one direction, and the arrow sits inside the link with the alert text
 * as one sentence — so it renders only where the link renders, which is what the app does
 * today: the unlinked arm carries the counts and no arrow.
 */
/**
 * The slot's own type, spelled once and NOT exported.
 *
 * What a consumer needs is the component. A second public name for this signature
 * would invite a call site to hold a link renderer apart from the card that hands it
 * the classes, which is the coupling the slot exists to keep in one place.
 *
 * It is `| undefined` on every prop that carries it, deliberately: both tsconfigs set
 * `exactOptionalPropertyTypes: true`, so threading an absent slot down to {@link Alert}
 * means passing `undefined` explicitly, and a bare `?` would refuse it.
 */
type DcaLinkSlot = (props: {
  className: string;
  children: ReactNode;
  planId: string;
}) => ReactElement;

export function DcaCard({
  view,
  renderLink,
}: {
  view: DcaView;
  renderLink?: DcaLinkSlot | undefined;
}) {
  return (
    <Card className="dca">
      <Card.Title>DCA</Card.Title>

      {view.unreadable ? (
        <p className="m-0 mt-1 text-[var(--nms-muted-foreground)]">
          The plans file could not be read — this is NOT "no plans declared".
        </p>
      ) : null}

      {view.unattributable > 0 ? (
        <p className="m-0 mt-1 text-[var(--nms-muted-foreground)]">
          {view.unattributable} unreadable{" "}
          {view.unattributable === 1 ? "line names" : "lines name"} no position.
        </p>
      ) : null}

      {view.positions.length === 0 && !view.unreadable ? (
        <p className="m-0 mt-1 text-[var(--nms-muted-foreground)]">No plan declared.</p>
      ) : (
        view.positions.map((position) => (
          <Plan
            key={position.positionId}
            position={position}
            renderLink={renderLink}
          />
        ))
      )}
    </Card>
  );
}

/**
 * THE PLAN BLOCK AND ITS HEAD (spec #420 slice 6).
 *
 * `m-0 mb-[6px]` IS NOT `mb-[6px]`. Preflight is off, so the UA's `<p>` margin is live on
 * all four edges and the deleted rule set three of them to zero. The plan block is a
 * `<div>`, which the UA gives no margin, so its one edge is the whole of it.
 *
 * The head wraps and always did: an id, a state word and a kind on one line at desk
 * width, on two or three at 320px. That wrap is the reason this card needed no breakpoint
 * of its own and has no container.
 */
const PLAN_BLOCK = "mt-[14px]";
const PLAN_HEAD = "flex flex-wrap items-baseline gap-2 m-0 mb-[6px]";

/**
 * The state word, in the operator's terms — and each one says what it means, because
 * `active` in particular does NOT mean "accumulating". It names the POLICY in force
 * on this date (ADR-004); a ladder whose rungs sit far below spot is `active` with
 * zero fills, possibly for months.
 */
const STATE_COPY: Record<DcaPositionView["state"], string> = {
  pending: "pending",
  active: "in force",
  ended: "ended",
  unreadable: "unreadable",
};

/**
 * THE STATE WORD READS AS A BADGE — small, heavy, upper-cased and tracked out — and its
 * COLOUR IS THE CARD'S WHOLE ANSWER ON DAY ZERO.
 *
 * `pending` IS DELIBERATELY NOT AN ALARM COLOUR: a declared plan awaiting its first fill
 * is the normal starting state, not a problem, so it takes the same recessed grey `ended`
 * does. `unreadable` is the only one that wants the eye.
 *
 * EVERY ARM NAMES ITS OWN COLOUR AND THE BADGE NAMES NONE. The deleted rules were a base
 * that painted grey and two overrides that repainted it, which is a cascade the stylesheet
 * could express and this string cannot: two unvariant `color` utilities on one element are
 * resolved by Tailwind's EMITTED order, not by the order they are written in, so a base
 * grey beside a state colour would be a coin toss decided inside the framework's sort. A
 * total map has no override to lose — one colour reaches the element, and which one is a
 * fact about this table rather than about a cascade. `dca-card-structure.test.tsx` walks
 * all four arms for that reason, not only the one the live wire happens to be in.
 */
/**
 * ── THE FLOOR IS 0.75rem, AND IT IS THE HOUSE'S OWN (spec #451 S7) ───────────────────
 * WCAG 2.2 AA, adopted in ADR-026, sets NO MINIMUM FONT SIZE. It constrains contrast,
 * and `pending` and `ended` were never in trouble there: `--nms-muted-foreground` on
 * `--nms-card` measures 6.63:1 against a 4.5:1 threshold and passes with room. So the
 * complaint that these badges are hard to read was true and its diagnosis was not —
 * eyes report "too faint" for what is actually 0.72rem, upper-cased and tracked out,
 * which is three legibility costs stacked on one string.
 *
 * A ratio could not have caught this and a taste call would have to be re-argued on the
 * next badge, so the rule is written as a NUMBER instead: no shipped app surface renders
 * text below 0.75rem. It is a house rule rather than a conformance one, named as such
 * here so the next reader does not go looking for the success criterion behind it.
 *
 * THE COLOUR DOES NOT MOVE. Re-tinting a pair that passes at 6.63:1 would spend the
 * palette on a problem it does not have, and `pending` taking the same recessed grey as
 * `ended` is the argument above, not an oversight.
 */
const STATE_BADGE = "text-[0.75rem] font-semibold uppercase tracking-[0.04em]";

const STATE_TONE: Record<DcaPositionView["state"], string> = {
  pending: "text-[var(--nms-muted-foreground)]",
  active: "text-[var(--nms-pos)]",
  ended: "text-[var(--nms-muted-foreground)]",
  unreadable: "text-[var(--nms-caution)]",
};

/** What kind of plan this is, where the wire names one. */
const KIND_COPY: Record<"dcaLadder" | "dcaTime", string> = {
  dcaLadder: "price ladder",
  dcaTime: "time-based",
};

function Plan({
  position,
  renderLink,
}: {
  position: DcaPositionView;
  renderLink?: DcaLinkSlot | undefined;
}) {
  return (
    <div className={PLAN_BLOCK}>
      <p className={PLAN_HEAD}>
        <span>{position.positionId}</span>
        <span className={`${STATE_BADGE} ${STATE_TONE[position.state]}`}>
          {STATE_COPY[position.state]}
        </span>
        {position.kind ? (
          <span className="m-0 mt-1 text-[var(--nms-muted-foreground)]">
            {KIND_COPY[position.kind]}
          </span>
        ) : null}
      </p>
      <Alert position={position} renderLink={renderLink} />
      <Rungs position={position} />
    </div>
  );
}

/**
 * THE ALERT LINE AND ITS TAP TARGET (spec #420 slice 6).
 *
 * `m-0 mb-2` for the same reason the head is `m-0 mb-[6px]`: the deleted rule set three
 * `<p>` edges to zero and preflight is off, so all three are written.
 *
 * ── THE KEYBOARD RING WAS NEVER IN `styles.css`, AND THAT IS THE HAZARD ──────────────
 * The deleted `a:hover, a:focus-visible` pair declared TEXT-DECORATION and nothing else.
 * The outline a keyboard puts on this link is the USER AGENT's, live because preflight is
 * off and this app has never overridden it. So the conversion's risk is not a rule that
 * fails to move, it is a utility that suppresses something no rule ever declared: any
 * outline reset landing here removes a focus ring, and nothing in this repo's suite would
 * go red. Nothing below touches `outline`, deliberately, and Chrome measured the ring
 * after a real Tab rather than a scripted focus — the only channel that can see it.
 *
 * THE UNDERLINE IS A VARIANT PAIR, NOT AN OVERRIDE HOPING TO WIN. The base removes the
 * decoration and the two states put it back; both variants compile to a higher-specificity
 * selector than the base, so the restoration is decided by the cascade rule it means
 * rather than by Tailwind's emitted order.
 *
 * `px-0 py-1` IS THE WHOLE SHORTHAND. The deleted rule said `padding: 4px 0`, which sets
 * four edges, and it is what makes the line a thumb-sized target without turning the card
 * into a button.
 *
 * The warn span keeps its own colour on its own element, so it inherits nothing from the
 * link and overrides nothing on it — the two never meet on one property.
 */
const ALERT_LINE = "m-0 mb-2 text-[0.85rem]";

const ALERT_LINK =
  "inline-block px-0 py-1 text-[var(--nms-foreground)] no-underline hover:underline focus-visible:underline";

const ALERT_WARN = "text-[var(--nms-neg)]";

/**
 * The alert line, and the tap through to the Fill Path.
 *
 * NOTHING IS RENDERED WHERE THE WIRE SAYS NOTHING. `alert` is absent on a row no
 * reconciliation ran for, and `planId` is absent on a v4 row; either absence removes its
 * half and the card degrades to exactly what it was before this slice. A `0 filled` for
 * an unreconciled row would be a measurement nobody took.
 *
 * THE PLAN ID IS NEVER RENDERED. It goes out through the slot and nowhere else — the
 * text the operator reads is the ladder's own words.
 *
 * TWO ABSENCES REACH THE SAME PARAGRAPH AND THEY ARE NOT THE SAME FACT. A row with no
 * `planId` has no destination to offer; a caller with no `renderLink` has no router to
 * build one with. Both render the unlinked arm, which is a state the app itself produces
 * on every v4 row, so neither has to pretend with a dead anchor.
 */
function Alert({
  position,
  renderLink,
}: {
  position: DcaPositionView;
  renderLink?: DcaLinkSlot | undefined;
}) {
  const { alert, planId } = position;
  if (alert === undefined) return null;

  const line = (
    <>
      {alert.rungs} {alert.rungs === 1 ? "rung" : "rungs"} · {alert.filled} filled
      {alert.needsRecording > 0 ? (
        <span className={ALERT_WARN}>
          {" "}
          · <span aria-hidden="true">⚠ </span>
          {alert.needsRecording} needs recording
        </span>
      ) : null}
    </>
  );

  if (planId === undefined || renderLink === undefined) {
    return <p className={ALERT_LINE}>{line}</p>;
  }
  return (
    <p className={ALERT_LINE}>
      {renderLink({
        className: ALERT_LINK,
        planId,
        children: (
          <>
            {line} <span aria-hidden="true">→</span>
          </>
        ),
      })}
    </p>
  );
}

/**
 * The ladder — or the named reason there is none. Four shapes reach here and each
 * absence is a different fact:
 *
 *  - a ladder with rungs renders the table;
 *  - a `dcaTime` plan is honestly rungless: it buys on a cadence, and there is no
 *    price axis to plot;
 *  - an `ended` or `unreadable` row carries no plan body at all, by the wire's own
 *    design — those arms ship `{ positionId, state }` and nothing else;
 *  - a ladder with zero rungs is a declaration the operator wrote that way.
 */
function Rungs({ position }: { position: DcaPositionView }) {
  if (position.kind === "dcaTime") {
    return (
      <p>
        <Absent why="cadence plan — no rung ladder" />
      </p>
    );
  }
  if (position.kind === undefined) {
    return (
      <p>
        <Absent why={position.state === "ended" ? "plan ended" : "plan unreadable"} />
      </p>
    );
  }
  if (position.rungs.length === 0) {
    return (
      <p>
        <Absent why="no rungs declared" />
      </p>
    );
  }

  return (
    <div className={TABLE_SCROLL}>
      <table className={TABLE_SURFACE}>
        <thead>
          <tr>
            <th className={TABLE_HEAD_CELL}>Rung</th>
            <th className={TABLE_HEAD_CELL_NUM}>Limit price</th>
          </tr>
        </thead>
        <tbody>
          {/* Descending by price, sorted in `glance/dca-view.ts`. The index is the
              ladder position AS RENDERED, which is what the eye counts down; it is
              not the plan's own rung id — that never leaves the machine. */}
          {position.rungs.map((rung, index) => (
            <tr key={`${index}:${rung.priceUsd}`}>
              <td className={TABLE_CELL}>{index + 1}</td>
              <td className={TABLE_CELL_NUM}>{formatUsd(rung.priceUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
