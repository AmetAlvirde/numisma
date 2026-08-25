import type { Verdict } from "./glance-card";

/**
 * `GlanceCard`'s prop literals, beside the component (spec #439 §4.3).
 *
 * A LITERAL, NEVER A `computeVerdict` CALL, and that is forced rather than chosen. All
 * 637 lines of the derivation stay in `apps/web/src/glance/verdict.ts`, and
 * `seam-isolation.test.ts` forbids the workbench importing from there on every
 * specifier. What keeps these honest instead is the type direction: this package
 * DECLARES `Verdict` and that module returns it, so a field that moves stops compiling
 * on both sides rather than drifting on one.
 *
 * THE ARMS ARE CHOSEN BY WHAT THEY PUT ON SCREEN, not by what they mean. The card reads
 * ONE colour — `--nms-muted-foreground`, four times — so "the token repaints" is
 * satisfied by any of them. The useful claim is the second one, that every SITE reading
 * it repaints, and no single verdict can carry all four: the Change slot's suppressed
 * arm and its rendered arm are two branches of one `if`. So the suppressed reference
 * lives on {@link standingVerdict} and the rendered one on {@link risingVerdict}, and
 * the workbench fixture stages them together.
 *
 * SYNTHESIZED. Every date, figure and sentence below is authored. No ledger output has
 * been near this file.
 */

/**
 * The widest single arm: fund value and Reserve render, Change is suppressed but its
 * reference WAS resolved, so V3's "name the date you landed on" span still prints.
 *
 * Three of the four reads are on screen here — the "as of" line, the suppressed
 * Change's trailing reference, and the Reserve floor — and this is the literal the
 * moved structure test renders in every case.
 */
export function standingVerdict(): Verdict {
  return {
    asOf: "2026-01-05",
    staleDays: 0,
    needsYou: false,
    sentence: "Nothing needs you.",
    fired: [],
    slots: {
      fundValue: { rendered: true, usdValue: 1234.5 },
      change: {
        rendered: false,
        referenceLabel: "Mon 5 Jan",
        suppressedBy: "reference-withheld",
      },
      reserve: { rendered: true, percentOfFund: 12.25, floorPct: 10 },
    },
  };
}

/**
 * The arm that needs the operator, which is the only way to see the verdict line's
 * OTHER sign colour. `needsYou` and the sentence move together on purpose: a fixture
 * that flipped the flag and kept "Nothing needs you." would paint the alarming colour
 * on the settled words and read as a bug.
 */
export function alarmingVerdict(): Verdict {
  return {
    ...standingVerdict(),
    needsYou: true,
    sentence: "Reserve is under its floor.",
    fired: [{ name: "reserveFloor", sentence: "Reserve is under its floor." }],
  };
}

/** A rendered Change, up: the ▲ takes the positive sign and its reference prints. */
export function risingVerdict(): Verdict {
  const base = standingVerdict();
  return {
    ...base,
    slots: {
      ...base.slots,
      change: { rendered: true, percent: 1.83, referenceLabel: "Mon 5 Jan" },
    },
  };
}

/** The same slot, down, which is the only way to see the ▼ and the negative sign. */
export function fallingVerdict(): Verdict {
  const base = risingVerdict();
  return {
    ...base,
    slots: {
      ...base.slots,
      change: { rendered: true, percent: -1.83, referenceLabel: "Mon 5 Jan" },
    },
  };
}

/**
 * The three causes {@link standingVerdict} does not carry, one per slot, so all four
 * members of `SuppressionReason` reach the operator's words somewhere in the fixture.
 *
 * CHANGE HAS NO `referenceLabel` HERE, and that absence is the point: `no-earlier-anchor`
 * is the genesis case, where there is no earlier anchor to name, so the trailing span
 * does not render at all and the em dash stands alone.
 */
export function unresolvedVerdict(): Verdict {
  return {
    asOf: "2026-01-01",
    staleDays: 9,
    needsYou: true,
    sentence: "Data is 9 days old — last anchored Thu 1 Jan",
    fired: [
      { name: "freshness", sentence: "Data is 9 days old — last anchored Thu 1 Jan" },
    ],
    slots: {
      fundValue: { rendered: false, suppressedBy: "unexpected-absence" },
      change: { rendered: false, suppressedBy: "no-earlier-anchor" },
      reserve: { rendered: false, suppressedBy: "no-policy" },
    },
  };
}
