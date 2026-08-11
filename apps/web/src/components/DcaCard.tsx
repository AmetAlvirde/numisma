import { formatUsd } from "@numisma/engine/format";
import type { DcaPositionView, DcaView } from "../glance/dca-view.ts";

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
 * THE TABLE IS THE PLOT. A price-axis chart of the ladder is hot-set item 11 and is
 * gated on node 7.10 (#145): no chart library, no `styles.css` rewrite. The rungs
 * price-sorted descending — the sort lives in `glance/dca-view.ts`, never here — read
 * top-down as the ladder itself, at zero substrate cost.
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
    <section className="card dca">
      <h2>DCA</h2>

      {view.unreadable ? (
        <p className="muted">
          The plans file could not be read — this is NOT "no plans declared".
        </p>
      ) : null}

      {view.unattributable > 0 ? (
        <p className="muted">
          {view.unattributable} unreadable{" "}
          {view.unattributable === 1 ? "line names" : "lines name"} no position.
        </p>
      ) : null}

      {view.positions.length === 0 && !view.unreadable ? (
        <p className="muted">No plan declared.</p>
      ) : (
        view.positions.map((position) => (
          <Plan key={position.positionId} position={position} />
        ))
      )}
    </section>
  );
}

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

/** What kind of plan this is, where the wire names one. */
const KIND_COPY: Record<"dcaLadder" | "dcaTime", string> = {
  dcaLadder: "price ladder",
  dcaTime: "time-based",
};

/** An em dash is not a zero — and the cause says which absence this is. */
function Absent({ why }: { why: string }) {
  return (
    <span className="absent">
      <span aria-hidden="true">—</span>
      <span className="muted absent-why">{why}</span>
    </span>
  );
}

function Plan({ position }: { position: DcaPositionView }) {
  return (
    <div className="dca-plan">
      <p className="dca-head">
        <span>{position.positionId}</span>
        <span className={`dca-state dca-state-${position.state}`}>
          {STATE_COPY[position.state]}
        </span>
        {position.kind ? (
          <span className="muted">{KIND_COPY[position.kind]}</span>
        ) : null}
      </p>
      <Rungs position={position} />
    </div>
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
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Rung</th>
            <th className="num">Limit price</th>
          </tr>
        </thead>
        <tbody>
          {/* Descending by price, sorted in `glance/dca-view.ts`. The index is the
              ladder position AS RENDERED, which is what the eye counts down; it is
              not the plan's own rung id — that never leaves the machine. */}
          {position.rungs.map((rung, index) => (
            <tr key={`${index}:${rung.priceUsd}`}>
              <td>{index + 1}</td>
              <td className="num">{formatUsd(rung.priceUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
