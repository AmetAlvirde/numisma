import { formatUsd } from "@numisma/engine/format";
import type {
  ChangeSlot,
  FundValueSlot,
  ReserveSlot,
  SuppressionReason,
  Verdict,
} from "../glance/verdict.ts";
import { referenceLabel } from "../glance/verdict.ts";
import { Absent } from "./ui/Absent.tsx";
import { Card } from "./ui/Card.tsx";

/**
 * THE GLANCE (D1/D3) — a verdict sentence and a CLOSED SET of exactly three standing
 * numbers: fund value, change, Reserve %. Adding a fourth later costs a slot.
 *
 * It is judged on how fast and how confidently it delivers the *no* — the answer on
 * 22 of the fund's first 28 recorded days — so the verdict is the only thing above 20px and
 * it lands before the eye reaches the numbers.
 *
 * ALL THREE SLOTS ALWAYS RENDER. An empty slot already means *suppressed* (V1/D7); it
 * must not also mean "nothing to say", or the diagnostic value of an absence is
 * destroyed. An absent number renders as an em dash with its CAUSE beside it, so it
 * can never be misread as zero.
 *
 * VERDICT AND SLOT ARE NOT DUPLICATES. The verdict names the CONDITION ("Fund moved
 * more than 1.5% since Mon 13 Jul"); the slot carries the NUMBER ("▲1.83% vs Mon 13
 * Jul"). A firing `navMove` forces the Change slot's reference to its own — which
 * here is structural rather than enforced: both read the one reference the verdict
 * resolved.
 */
export function GlanceCard({ verdict }: { verdict: Verdict }) {
  return (
    <Card className="glance">
      <p className={verdict.needsYou ? "verdict verdict-yes" : "verdict verdict-no"}>
        {verdict.sentence}
      </p>
      <p className="muted">as of {referenceLabel(verdict.asOf)}</p>

      <dl className="metrics">
        <div>
          <dt>Fund value</dt>
          <dd>
            <FundValue slot={verdict.slots.fundValue} />
          </dd>
        </div>
        <div>
          <dt>Change</dt>
          <dd>
            <Change slot={verdict.slots.change} />
          </dd>
        </div>
        <div>
          <dt>Reserve</dt>
          <dd>
            <Reserve slot={verdict.slots.reserve} />
          </dd>
        </div>
      </dl>
    </Card>
  );
}

/**
 * Why a number is absent, in the operator's words. Every cause is NAMED: "the number
 * is missing" and "the number is missing BECAUSE the feed did not run" are different
 * amounts of information, and the second one is the whole reason suppression is
 * per-number instead of whole-page.
 */
const REASON_COPY: Record<SuppressionReason, string> = {
  "unexpected-absence": "no current mark",
  "no-policy": "no floor set",
  "no-earlier-anchor": "no earlier anchor",
  "reference-withheld": "reference withheld",
};

/**
 * The translation `Absent` deliberately does not do. The shared primitive takes words,
 * not this module's enum, so the vocabulary stays here with the view that owns it.
 * `undefined` falls through to the primitive's own default, which reads `suppressed` —
 * the arm this card rendered before the extraction, unchanged.
 */
function whyAbsent(reason: SuppressionReason | undefined): string | undefined {
  return reason ? REASON_COPY[reason] : undefined;
}

function FundValue({ slot }: { slot: FundValueSlot }) {
  if (!slot.rendered) return <Absent why={whyAbsent(slot.suppressedBy)} />;
  return <>{formatUsd(slot.usdValue!)}</>;
}

function Change({ slot }: { slot: ChangeSlot }) {
  if (!slot.rendered) {
    return (
      <>
        <Absent why={whyAbsent(slot.suppressedBy)} />
        {/* V3: never claim a date you don't have — but when a reference WAS
            resolved, name it even though the number is withheld. */}
        {slot.referenceLabel ? (
          <span className="muted"> vs {slot.referenceLabel}</span>
        ) : null}
      </>
    );
  }
  const pct = slot.percent!;
  return (
    <>
      <span className={pct >= 0 ? "pos" : "neg"}>
        {pct >= 0 ? "▲" : "▼"}
        {Math.abs(pct).toFixed(2)}%
      </span>
      {/* D4: always against a NAMED reference, always rendered — never a bare
          "today", and always the anchor actually landed on (V3). */}
      <span className="muted"> vs {slot.referenceLabel}</span>
    </>
  );
}

function Reserve({ slot }: { slot: ReserveSlot }) {
  if (!slot.rendered) return <Absent why={whyAbsent(slot.suppressedBy)} />;
  return (
    <>
      {slot.percentOfFund!.toFixed(1)}%
      {/* C4: the wire says `target`, the UI says FLOOR. The divergence is
          deliberate — renaming would mean migrating an append-only sidecar. */}
      <span className="muted"> floor {slot.floorPct}%</span>
    </>
  );
}
