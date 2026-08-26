/**
 * THE CONTRAST PAIR LIST. The package owns which foreground its components put
 * on which surface, so the package is what can check a consumer's palette for
 * legibility (spec #451 §4.1, ADR-026).
 *
 * `tokens.ts` beside this file already gets the seam checked for PRESENCE.
 * `ops/components/consumers.test.ts` byte-compares each consumer's generated
 * defaults against the generator, and `apps/workbench/src/app-token-drift.test.ts`
 * reads `apps/web/src/styles.css` off disk on every run. Neither asks whether a
 * value is LEGIBLE, and neither could: a consumer supplying a palette cannot
 * know that `--nms-caution` lands on `--nms-card` without reading this
 * package's source, and reading this package's source is the coupling ADR-023
 * exists to prevent.
 *
 * HAND-AUTHORED, FOR THE REASON ADR-023 GIVES ABOUT THE TOKEN LIST. A scan sees
 * that `fill-path.tsx` reads `--nms-caution` and that something nearby reads
 * `--nms-card`. It cannot see that one sits ON the other, any more than it
 * could see `bg-primary` as a token read. Only a list separates a foreground
 * from a surface, so this is a list. It is roughly two dozen entries and it
 * stays that size: a pair is added when a component starts painting one, the
 * same rule `tokens.ts` keeps for names.
 *
 * EVERY ENTRY CARRIES ITS SUCCESS CRITERION, not only a number. A red that says
 * "2.91 is below 4.5" tells a reader which number moved; a red that says
 * "SC 1.4.3 (Contrast Minimum) wants 4.5:1" tells them which rule broke, and
 * ADR-026 is where that rule is written down. The threshold on an entry is
 * derived from its criterion in `contrastPairs` below rather than typed twice,
 * so the two cannot disagree.
 *
 * WHAT THIS FILE DOES NOT DO: read a palette, parse CSS, or compute a ratio.
 * The package ships no CSS and reaches no consumer's disk. `contrast.ts` is the
 * claim; `ops/components/contrast.test.ts` is what resolves two palettes off
 * disk and measures them against it.
 */

/**
 * A WCAG 2.2 success criterion this package's colour choices are judged
 * against. ADR-026 adopts the level and names these two clauses.
 */
export interface SuccessCriterion {
  /** The clause number, as WCAG spells it. */
  readonly id: string;
  /** The clause's own title, so a red reads as a rule and not as an id. */
  readonly title: string;
  /** The ratio the clause requires at Level AA. */
  readonly ratio: number;
}

/**
 * SC 1.4.3, Contrast Minimum. Text against the surface behind it.
 *
 * The criterion's large-text allowance of 3:1 applies at 18pt, or 14pt bold,
 * and ADR-026 records that nothing in this repo claims it. So every text pair
 * below wants the full 4.5, including the badges, which are small and
 * uppercase rather than large.
 */
export const TEXT_CONTRAST: SuccessCriterion = {
  id: "SC 1.4.3",
  title: "Contrast Minimum",
  ratio: 4.5,
};

/**
 * SC 1.4.11, Non-text Contrast. A fill or a mark that carries meaning, and the
 * boundary that tells a user where a control is.
 *
 * ADR-026 draws the line this list depends on: a hairline drawn for texture is
 * not a boundary, the line a field is identified by is. That sentence is why
 * `--nms-border` is an exclusion below and `--nms-input` is a pair.
 */
export const NON_TEXT_CONTRAST: SuccessCriterion = {
  id: "SC 1.4.11",
  title: "Non-text Contrast",
  ratio: 3,
};

/**
 * A foreground in a pair: a declared token, or one of the two colour literals
 * the package writes out.
 *
 * `"white"` IS NOT A TOKEN AND IS NOT A HOLE IN THE NAMESPACE. `SummaryCard`
 * paints both arms of its data-safety badge `text-white` over a token fill, and
 * white is the one colour whose value cannot move with a consumer's palette
 * without ceasing to be white. Naming it here is what lets the badge's label be
 * measured at all.
 */
export type ContrastForeground = `--nms-${string}` | "white";

/** One foreground, on one surface, under one criterion. */
export interface ContrastPair {
  /** The colour the mark or the type is drawn in. */
  readonly foreground: ContrastForeground;
  /** The token filling the area behind it. */
  readonly surface: `--nms-${string}`;
  /** The clause this pair answers to. */
  readonly criterion: SuccessCriterion;
  /** What paints it, in one line, so a red points at a component. */
  readonly renders: string;
}

/**
 * A pair a component really renders that this list deliberately does not
 * assert, and why.
 *
 * DECLARED RATHER THAN ABSENT, for the reason the themed palette's exemption is
 * declared in the guard's registration: an absence is indistinguishable from an
 * oversight, and the next reader would have to re-derive the argument before
 * they could trust the list. Each row below is a pair that exists on screen and
 * is out of scope on a stated ground, never a pair nobody has looked at.
 *
 * #453's THEMED-MODE CENSUS CONTRIBUTES NOTHING HERE, AND THAT IS THE FINDING.
 * The census (`docs/component-package.md` §5) swept all twelve fixture files and
 * found no `--nms-*` name that repaints nothing, so the exclusion list this file
 * was expected to inherit from it is empty. Three names it flags as painting
 * only in a state the fixtures do not hold — `--nms-muted` on hover,
 * `--nms-ring` on keyboard focus, `--nms-input` under a dark scheme — are live
 * reads on real elements and all three carry pairs below.
 */
export interface ExcludedPair {
  readonly foreground: ContrastForeground;
  readonly surface: `--nms-${string}`;
  /** Why it is not asserted. A sentence, not a label. */
  readonly reason: string;
}

/**
 * The pairs, grouped by criterion so the list reads as two claims rather than
 * one undifferentiated table.
 */
const TEXT_PAIRS: readonly Omit<ContrastPair, "criterion">[] = [
  {
    foreground: "--nms-foreground",
    surface: "--nms-background",
    renders: "Crumb's current segment, Button `outline`'s label, and the waiting rung row, which tints from the page rather than the card.",
  },
  {
    foreground: "--nms-foreground",
    surface: "--nms-card",
    renders: "Every `CardTitle` and card body, `METRICS_FIGURE`, the section table's cells, and the torn-act block's paragraph.",
  },
  {
    foreground: "--nms-foreground",
    surface: "--nms-muted",
    renders: "Button `ghost` and `outline` on hover, which is the one place `--nms-muted` is a surface under type: `hover:bg-muted hover:text-foreground`.",
  },
  {
    foreground: "--nms-muted-foreground",
    surface: "--nms-background",
    renders: "Crumb's trailing segments, and the rung row's index and size over the waiting tint.",
  },
  {
    foreground: "--nms-muted-foreground",
    surface: "--nms-card",
    renders: "`Absent`'s em dash and its stated cause, `METRICS_TERM`, the section table's head box, and most of the fill path's labels.",
  },
  {
    foreground: "--nms-pos",
    surface: "--nms-card",
    renders: "`POSITIVE`, shared by `SummaryCard`, `GlanceCard` and `SectionTable`, and the fill path's `active` badge.",
  },
  {
    foreground: "--nms-neg",
    surface: "--nms-card",
    renders: "`NEGATIVE` on the same three-file path, the stale-snapshot refusal, and the torn-act headline.",
  },
  {
    foreground: "--nms-now",
    surface: "--nms-card",
    renders: "The fill path's `next` pill, and the chart's end-anchored spot label.",
  },
  {
    foreground: "--nms-caution",
    surface: "--nms-card",
    renders: "`DcaCard`'s `unreadable` sidecar tone, the fill path's `unreadable` row tone, and `PILL_TONE.inferred`.",
  },
  {
    foreground: "white",
    surface: "--nms-ok",
    renders: "`SummaryCard`'s data-safety badge, the arm asserting the fold excluded nothing.",
  },
  {
    foreground: "white",
    surface: "--nms-warn",
    renders: "The same badge's other arm, and the fill job `--nms-warn` keeps now that the text job is `--nms-caution`.",
  },
  {
    foreground: "--nms-primary-foreground",
    surface: "--nms-primary",
    renders: "Button `default`'s label.",
  },
  {
    foreground: "--nms-secondary-foreground",
    surface: "--nms-secondary",
    renders: "Button `secondary`'s label.",
  },
];

const NON_TEXT_PAIRS: readonly Omit<ContrastPair, "criterion">[] = [
  {
    foreground: "--nms-caution",
    surface: "--nms-card",
    renders: "The inferred warning's dashed left rule, and `PILL_TONE.inferred`'s edge. Both are graphical objects under SC 1.4.11 and both move with the pill, so splitting them across two rules would split one visual element.",
  },
  {
    foreground: "--nms-pos",
    surface: "--nms-card",
    renders: "The chart's filled path stroke and its filled rung dots, and the progress bar's fill.",
  },
  {
    foreground: "--nms-neg",
    surface: "--nms-card",
    renders: "The torn-act block's solid left rule, the one the dashed caution rule is read against.",
  },
  {
    foreground: "--nms-now",
    surface: "--nms-card",
    renders: "The chart's horizontal spot rule and the `Now` legend swatch.",
  },
  {
    foreground: "--nms-muted-foreground",
    surface: "--nms-card",
    renders: "The chart's dashed waiting path and its waiting rung dots, which carry the rungs price has not reached.",
  },
  {
    foreground: "--nms-ring",
    surface: "--nms-background",
    renders: "`focus-visible:border-ring` on every Button variant, where the control sits on the page. `tokens.ts` calls this the one token whose absence is a keyboard defect, and a ring nobody can see is that absence by another route.",
  },
  {
    foreground: "--nms-ring",
    surface: "--nms-card",
    renders: "The same ring where the control sits on a card, which is where `SnapshotStaleNotice` puts one.",
  },
  {
    foreground: "--nms-input",
    surface: "--nms-background",
    renders: "The field edge. `apps/web`'s login inputs fill with the page colour, so this is the boundary against the field's own fill.",
  },
  {
    foreground: "--nms-input",
    surface: "--nms-card",
    renders: "The same edge against the card the login form sits in. Both surfaces are required, which is what rules out a value clearing one and missing the other.",
  },
];

/**
 * Every pair the package asserts, threshold attached from the criterion.
 *
 * The threshold is not a field an author types. Writing 3 beside SC 1.4.3 would
 * be a green the guard could never catch, because nothing else in the repo knows
 * what that clause requires.
 */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  ...TEXT_PAIRS.map((pair) => ({ ...pair, criterion: TEXT_CONTRAST })),
  ...NON_TEXT_PAIRS.map((pair) => ({ ...pair, criterion: NON_TEXT_CONTRAST })),
];

/**
 * The pairs that render and are not asserted. See `ExcludedPair` for why this
 * is a list rather than a silence.
 */
export const EXCLUDED_CONTRAST_PAIRS: readonly ExcludedPair[] = [
  {
    foreground: "--nms-border",
    surface: "--nms-card",
    reason:
      "A hairline drawn for texture, which ADR-026 names as the thing SC 1.4.11 does not reach. It separates two surfaces that are already one step apart in value; it identifies no control and carries no meaning a user could lose. Asserting it would demand 3:1 between a card and its own edge, which is a visual decision the criterion has no opinion about.",
  },
  {
    foreground: "--nms-border",
    surface: "--nms-background",
    reason:
      "The card's outer edge against the page, and the same hairline argument. `--nms-input` is the other half of this pair on purpose: an input's boundary and a card's hairline were never the same decision, which is what spec #451 §4.1 unaliases.",
  },
  {
    foreground: "--nms-primary",
    surface: "--nms-card",
    reason:
      "Button `variant=\"link\"`, which paints `text-primary` with no fill. It is the same one-token-two-jobs shape `--nms-warn` had before this list existed: `apps/web` resolves `--nms-primary` to an accent chosen as a FILL under white, and no single blue clears 4.5:1 both as that fill and as type on a dark card. The variant renders in `apps/workbench`'s button fixture and on no shipped app surface, so nothing is failing for a user today. Asserting it would demand a mint spec #451 S3 is not scoped for, and the finding is recorded here rather than dropped.",
  },
  {
    foreground: "--nms-warn",
    surface: "--nms-card",
    reason:
      "`SummaryCard`'s data-safety badge is a filled pill under `text-white`, and the fill is not what carries the meaning: the label is, in words, and white on it is asserted at 4.5:1 as a text pair. SC 1.4.11 reaches a graphical object required to understand the content, which a plate behind readable type is not. The distinction is doing real work here rather than excusing a number — `--nms-caution`'s dashed left rule IS asserted, because a dashed rule beside a solid `--nms-neg` one is the whole signal that an inference is an inference and no text says so.",
  },
  {
    foreground: "--nms-ok",
    surface: "--nms-card",
    reason:
      "The same badge's other arm, out on the same ground. It measures 3.24:1 in `apps/web` and would pass, and listing it here rather than asserting the arm that happens to clear is what stops the pair list from being a record of which numbers were convenient.",
  },
  {
    foreground: "--nms-destructive",
    surface: "--nms-card",
    reason:
      "Button `destructive` is `bg-destructive/10 text-destructive` — type on a 10% tint of its own colour over the card. The measurable surface is a composite the palette does not declare, so a solid-on-solid ratio computed here would be a number about a colour nothing paints. Every alpha-modified pair in the package is out for this reason, and this is the one that would otherwise look like an oversight.",
  },
];

/** How many pairs the package asserts. Read by the guard, and by nothing else. */
export const CONTRAST_PAIR_COUNT = CONTRAST_PAIRS.length;
