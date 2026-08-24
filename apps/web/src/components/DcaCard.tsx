import { Link } from "@tanstack/react-router";
import { formatUsd } from "@numisma/engine/format";
import { Absent } from "@numisma/components";
import type { DcaPositionView, DcaView } from "../glance/dca-view.ts";
import { Card } from "./ui/Card.tsx";
// The table surface, from the component that owns its deleted element rules (spec #420
// Seam B — the first surface in the migration's order converts every carrier, wherever
// it renders). The rung ladder is a table on the same terms as the composition one.
import {
  TABLE_CELL,
  TABLE_CELL_NUM,
  TABLE_HEAD_CELL,
  TABLE_HEAD_CELL_NUM,
  TABLE_SCROLL,
  TABLE_SURFACE,
} from "./SectionTable.tsx";

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
export function DcaCard({ view }: { view: DcaView }) {
  return (
    <Card className="dca">
      <Card.Title>DCA</Card.Title>

      {view.unreadable ? (
        <p className="m-0 mt-1 text-[var(--muted)]">
          The plans file could not be read — this is NOT "no plans declared".
        </p>
      ) : null}

      {view.unattributable > 0 ? (
        <p className="m-0 mt-1 text-[var(--muted)]">
          {view.unattributable} unreadable{" "}
          {view.unattributable === 1 ? "line names" : "lines name"} no position.
        </p>
      ) : null}

      {view.positions.length === 0 && !view.unreadable ? (
        <p className="m-0 mt-1 text-[var(--muted)]">No plan declared.</p>
      ) : (
        view.positions.map((position) => (
          <Plan key={position.positionId} position={position} />
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
const STATE_BADGE = "text-[0.72rem] font-semibold uppercase tracking-[0.04em]";

const STATE_TONE: Record<DcaPositionView["state"], string> = {
  pending: "text-[var(--muted)]",
  active: "text-[var(--pos)]",
  ended: "text-[var(--muted)]",
  unreadable: "text-[var(--warn)]",
};

/** What kind of plan this is, where the wire names one. */
const KIND_COPY: Record<"dcaLadder" | "dcaTime", string> = {
  dcaLadder: "price ladder",
  dcaTime: "time-based",
};

function Plan({ position }: { position: DcaPositionView }) {
  return (
    <div className={PLAN_BLOCK}>
      <p className={PLAN_HEAD}>
        <span>{position.positionId}</span>
        <span className={`${STATE_BADGE} ${STATE_TONE[position.state]}`}>
          {STATE_COPY[position.state]}
        </span>
        {position.kind ? (
          <span className="m-0 mt-1 text-[var(--muted)]">{KIND_COPY[position.kind]}</span>
        ) : null}
      </p>
      <Alert position={position} />
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
  "inline-block px-0 py-1 text-[var(--text)] no-underline hover:underline focus-visible:underline";

const ALERT_WARN = "text-[var(--neg)]";

/**
 * The alert line, and the tap through to the Fill Path.
 *
 * NOTHING IS RENDERED WHERE THE WIRE SAYS NOTHING. `alert` is absent on a row no
 * reconciliation ran for, and `planId` is absent on a v4 row; either absence removes its
 * half and the card degrades to exactly what it was before this slice. A `0 filled` for
 * an unreconciled row would be a measurement nobody took.
 *
 * THE PLAN ID IS NEVER RENDERED. It goes into the link's params and nowhere else — the
 * text the operator reads is the ladder's own words.
 */
function Alert({ position }: { position: DcaPositionView }) {
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

  if (planId === undefined) return <p className={ALERT_LINE}>{line}</p>;
  return (
    <p className={ALERT_LINE}>
      <Link to="/ladder/$planId" params={{ planId }} className={ALERT_LINK}>
        {line} <span aria-hidden="true">→</span>
      </Link>
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
