import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { NMS_TOKENS, NMS_TOKEN_NAMES } from "@numisma/components/tokens.ts";

import {
  customPropertyDeclarations,
  declarationMap,
  resolveVarChain,
} from "../../../ops/components/css-custom-properties.ts";

import { APP_TOKENS, GRAYSCALE_TOKENS, THEME_MODES } from "./theme-modes.ts";

/**
 * THE DRIFT TEST (spec #412 §5 Seam D; issue #418 acceptance).
 *
 * App mode carries the app's token VALUES AS DATA. It must, because Seam D
 * forbids the workbench importing anything from `apps/web` — and it should,
 * because tokens are data while the app's CSS is a cascade with SSR-linked
 * stylesheets and a `layer()` asymmetry in it. Copying data across a seam is
 * cheap; copying a cascade is not copying at all.
 *
 * WHAT A COPY COSTS, AND WHAT THIS BUYS BACK. The copy rots in silence. The app
 * changes its accent, nobody touches the workbench, and app mode goes on
 * showing last season's blue — under a label that says it is showing what the
 * app shows. That is worse than no app mode at all: a reviewer signs off on a
 * colour the app does not use. This test reads `apps/web/src/styles.css` OFF
 * DISK on every run and fails the moment the two disagree.
 *
 * READING THAT FILE IS NOT IMPORTING FROM `apps/web`. It is a text read in a
 * test, and nothing from the app reaches the workbench's module graph or its
 * bundle. `seam-isolation.test.ts` holds the actual seam, and it is written
 * against IMPORT SPECIFIERS precisely so this read does not trip it.
 *
 * ALIASES RESOLVED, NOT COMPARED. `styles.css` writes `--nms-background:
 * var(--bg)`, because that file staying the one place colour is defined is the
 * rule Slice 5 was careful to keep. The workbench has no `--bg`, so app mode
 * carries `#0f1115` and this test walks the alias chain through the app's own
 * palette block to meet it. Comparing the raw `var(--bg)` text instead would
 * pass while the palette moved underneath it, which is the exact rot this test
 * exists to catch.
 *
 * ── NAME-FOR-NAME, WHICH IS NOW NINETEEN ON BOTH SIDES ────────────────────
 *
 * This test mirrors whatever `styles.css` declares, rather than scoping itself
 * to `NMS_TOKEN_NAMES`, and that is still the contract #418 asked for. What
 * changed is the app's block. It carried fourteen — the package's twelve plus
 * `--nms-card` and `--nms-muted-foreground`, minted by spec #412 §4.2 for
 * components that had not arrived — and spec #420 S0 deleted both, so the two
 * numbers agreed at twelve. Spec #432 §4.1 moved them back one slice per name
 * and minted `--nms-neg` alongside them, which is wave 1's third and last.
 *
 * THE ARGUMENT THAT LOST, recorded because it was a real one: carrying an
 * unexercised alias means the day `Card` enters the package, app mode is
 * already correct for it, having been held honest all along. What decided
 * against it is the cost on the other side — until that day, app mode shows two
 * values no fixture can render, under a label saying it shows what the app
 * shows, and `tokens.ts` already refuses exactly that on the package's own side.
 * A name lands in `NMS_TOKEN_NAMES` when a component starts reading it, and the
 * app defines it then.
 *
 * WHICH IS THE DAY WAVE 1 ARRIVES (spec #432 §4.1). `Absent` and `Card` cross
 * into the package in wave 1, and `--nms-muted-foreground` and `--nms-card`
 * come back with them, in those slices and not before. All three of wave 1's
 * names have landed now: `Absent` reads `--nms-muted-foreground`, `Card` reads
 * `--nms-card`, and the two snapshot notices read `--nms-neg`, with the app
 * aliasing each onto its house name in the slice that moved the component.
 * Reusing the two deleted spellings is deliberate: same role, same name, one
 * vocabulary. Read it as the sentence above being satisfied, not withdrawn —
 * the losing argument asked to carry the alias while nothing read it, and this
 * carries it because something does. Both sides moved together on every one, so
 * the two numbers agreed at each step and agreed at fifteen.
 *
 * WAVE 2 TAKES IT TO NINETEEN, in two steps. `SummaryCard` crossed in spec #439
 * S1 reading `--nms-pos` on a rising P&L and `--nms-ok`/`--nms-warn` on the two
 * arms of its data-safety badge; `PriceDropPathChart` crossed in S5 reading
 * `--nms-now` three times, on the spot rule, its label and the `Now` legend
 * swatch. `styles.css` aliased each onto the house colour it already had in the
 * same commit. All four had been NAMED in `tokens.ts` since wave 1 and left
 * undeclared on the rule above — the round trip again, four for four, and the
 * ten-name house vocabulary that table has carried since wave 1 is closed.
 *
 * ONE APP VALUE NOW ANSWERS TO TWO NAMES. `styles.css` aliases both
 * `--nms-destructive` and `--nms-neg` onto `--neg`, so the per-value cases below
 * meet the same literal twice and pass, which is correct: this test asks whether
 * the copy matches the app, never whether the app's names are distinct from each
 * other. Themed mode is where distinctness is a contract, and the case for it is
 * at the bottom of this file.
 *
 * THE MIRROR STILL POINTS BOTH WAYS, and that is what makes the deletion a
 * two-sided edit: dropping the aliases from `styles.css` without dropping them
 * from `APP_TOKENS` reds the first case below, and the reverse reds it too.
 * THEMED MODE IS SCOPED DIFFERENTLY ON PURPOSE — to the package's declared
 * tokens, because its job is to make an UNEXERCISED DECLARED token visible.
 */

const WORKBENCH_SRC = dirname(fileURLToPath(import.meta.url));
const STYLES_CSS = resolve(WORKBENCH_SRC, "..", "..", "web", "src", "styles.css");

const stylesCss = readFileSync(STYLES_CSS, "utf8");
const declared = declarationMap(customPropertyDeclarations(stylesCss));

/** Every `--nms-*` the app declares, resolved through its palette aliases. */
const appDeclared = new Map(
  [...declared.entries()]
    .filter(([name]) => name.startsWith("--nms-"))
    .map(([name, value]) => [name, resolveVarChain(value, declared)] as const),
);

describe("app mode mirrors the app's --nms-* block", () => {
  it("covers exactly the names styles.css declares, no more and no fewer", () => {
    // Both directions matter. A name the app added and the workbench never
    // learned is a mode showing a hole; a name the workbench kept after the app
    // dropped it is a mode showing a colour the app no longer has.
    expect([...Object.keys(APP_TOKENS)].sort()).toEqual(
      [...appDeclared.keys()].sort(),
    );
  });

  it.each([...NMS_TOKEN_NAMES])("covers the declared token %s", (name) => {
    // The subset the package actually reads, called out by name so a red says
    // which contract broke: a missing one here is a component rendering
    // colourless in app mode, not merely a stale copy.
    expect(Object.keys(APP_TOKENS)).toContain(name);
  });

  it("declares neither more nor fewer names than the package does", () => {
    // The gap, closed and pinned shut. This read `toBeGreaterThanOrEqual` while
    // the app carried two aliases nothing rendered; spec #420 S0 deleted them,
    // and equality is what stops a surplus creeping back in through app mode
    // rather than through `styles.css`. `nms-tokens.test.ts` holds the same
    // line on the app's side, so a surplus has nowhere to enter.
    expect(Object.keys(APP_TOKENS).length).toBe(NMS_TOKEN_NAMES.length);
  });

  it.each([...appDeclared.entries()])(
    "matches the app's resolved value for %s",
    (name, value) => {
      expect([name, APP_TOKENS[name]]).toEqual([name, value]);
    },
  );

  it("resolved every alias to a literal", () => {
    // Guards the comparison itself. If `resolveVarChain` gave up — a renamed
    // palette entry, a cycle — both sides could still agree on the string
    // `var(--bg)` and this suite would go green over an unresolved copy.
    for (const [name, value] of appDeclared) {
      expect([name, value.includes("var(")]).toEqual([name, false]);
    }
  });
});

describe("the three modes", () => {
  const modes = new Map(THEME_MODES.map((mode) => [mode.id, mode]));

  it("are grayscale, themed and app, in that order", () => {
    expect(THEME_MODES.map((mode) => mode.id)).toEqual([
      "grayscale",
      "themed",
      "app",
    ]);
  });

  it("gives themed a DISTINCT value for every declared token", () => {
    // Themed mode's only job is to make an unexercised token visible: a token
    // nothing renders is a token nothing changes when you switch into it. Two
    // tokens sharing a value would hide exactly that signal for both.
    const themed = modes.get("themed")!.tokens;
    const values = NMS_TOKEN_NAMES.map((name) => themed[name]);
    expect(values).not.toContain(undefined);
    expect(new Set(values).size).toBe(NMS_TOKEN_NAMES.length);
  });

  it("gives grayscale exactly the package's own defaults", () => {
    // Not "some greys" — the package's base mode, read off the package. A hand
    // copy here would be a second source of truth for the one thing the package
    // unambiguously owns, so the VALUES are what this compares. Key presence
    // alone would pass a hand-written table that had every name and the wrong
    // colour behind each one, which is the substitution this case exists for.
    const grayscale = modes.get("grayscale")!.tokens;
    expect(NMS_TOKENS.map((token) => [token.name, grayscale[token.name]])).toEqual(
      NMS_TOKENS.map((token) => [token.name, token.value]),
    );
  });
});

/* ── THE GRAYSCALE STATE FAMILY, AND WHY IT GETS A DISTINCTNESS GUARD ───────
 *
 * Themed mode has had one since #418 and the base mode had none, which is the
 * wrong way round for the one question grayscale mode exists to answer. Themed
 * mode's distinctness is about VISIBILITY: a token whose colour does not appear
 * when the switcher moves is a token nothing renders. Grayscale mode's is about
 * READING: it is the mode a reviewer judges hierarchy, spacing and STATE in, and
 * two states one hundredth of L apart are the same colour on a screen.
 *
 * IT WENT RED ON ARRIVAL, against a collision `tokens.ts` had already written
 * down and left unguarded. Spec #451 S3 darkened six defaults for contrast and
 * landed `--nms-ok` at L 0.46, one hundredth from `--nms-destructive` and
 * `--nms-neg` at 0.45. The row for that token recorded the fact and said
 * "nothing catches it". This is what catches it.
 *
 * SCOPED TO THE STATE FAMILY, NOT TO ALL TWENTY NAMES. These seven are the
 * names that carry a meaning a reader has to tell apart from its neighbour:
 * destroyed, negative, positive, all-clear, withheld-as-fill,
 * withheld-as-type, and where price is now. The surfaces and the structural
 * tokens are not in that contest — `--nms-background` and `--nms-card` sit one
 * step apart ON PURPOSE, because a card a whole step off the page has no
 * hierarchy left to review, and a guard that demanded they separate would be
 * arguing with the reason they are close.
 *
 * THE THRESHOLD IS DERIVED, NOT PREFERRED. Read the family's own values: six
 * distinct lightnesses inside a band bounded at both ends by contrast
 * obligations. Every one of these is a fill under white, or type on a card, or
 * both, so the band cannot run to white at the top or to black at the bottom
 * without failing SC 1.4.3 in one direction or the other. 0.02 is the spacing
 * six distinct values already fit into that band: every gap in the family is
 * exactly 0.02 except the one this guard was written for. So the number is the
 * family's own measured spacing, and a value that violates it is a value that
 * did not fit where its neighbours already fit.
 *
 * `--nms-destructive` AND `--nms-neg` ARE A DECLARED IDENTICAL PAIR. They hold
 * one value in every palette on purpose — `tokens.ts` argues at length that the
 * sign of a number and the affordance of a destructive button are different
 * kinds of thing wearing one colour today — so the guard EXEMPTS them and then
 * ASSERTS THE EXEMPTION, the way `contrast.ts` declares an excluded pair rather
 * than staying silent about it. An absence would be indistinguishable from an
 * oversight, and a stale one would be worse: the day those two values come
 * apart, the case below reds and the declaration has to go rather than sitting
 * there excusing a pair that no longer exists.
 */

/** The seven names whose whole job is to be told apart from each other. */
const STATE_FAMILY: readonly string[] = [
  "--nms-destructive",
  "--nms-neg",
  "--nms-pos",
  "--nms-ok",
  "--nms-warn",
  "--nms-caution",
  "--nms-now",
];

/** The family's own measured spacing, in OKLCH lightness. See the block above. */
const MIN_STATE_LIGHTNESS_GAP = 0.02;

/** Two state tokens that hold one value on purpose, and the argument for it. */
interface DeclaredIdenticalPair {
  readonly one: string;
  readonly other: string;
  /** Why one value under two names is the intended state. A sentence. */
  readonly reason: string;
}

/**
 * The pairs the guard above lets through, each with its argument attached.
 */
const DECLARED_IDENTICAL_PAIRS: readonly DeclaredIdenticalPair[] = [
  {
    one: "--nms-destructive",
    other: "--nms-neg",
    reason:
      "Two names at one value, decided in spec #432 §4.1 and argued in `tokens.ts`. `--nms-neg` is DATA, the sign of a number; `--nms-destructive` is INTENT, the affordance of a button that destroys something. Every palette in the repo resolves both to the same colour today, `apps/web` included, and that is the point rather than an oversight: welding them into one name would mean the day the money-red wants to soften, or wants a colourblind-safe pairing with `--nms-pos`, every destructive affordance moves with it. Themed mode is where the two roles come apart on screen, a cyan and a red, and it is the mode built to pull them apart. So this pair is exempt from the spacing rule here, and the case below holds the exemption honest by asserting the two values really are identical.",
  },
];

/** `oklch(L 0 0)`'s lightness, or `undefined` for anything else. */
function grayscaleLightness(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const match = /^oklch\(\s*([\d.]+)\s+0\s+0\s*\)$/.exec(value.trim());
  return match === null ? undefined : Number.parseFloat(match[1]!);
}

/** Every unordered pair of the family, as `[a, b]`. */
const STATE_PAIRS: readonly (readonly [string, string])[] = STATE_FAMILY.flatMap(
  (one, at) => STATE_FAMILY.slice(at + 1).map((other) => [one, other] as const),
);

function isDeclaredIdentical(one: string, other: string): boolean {
  return DECLARED_IDENTICAL_PAIRS.some(
    (pair) =>
      (pair.one === one && pair.other === other) ||
      (pair.one === other && pair.other === one),
  );
}

describe("grayscale keeps its state colours apart", () => {
  it("names seven tokens the package actually declares", () => {
    // FALSE-PASS FLOOR. A family scoped to names nothing declares would produce
    // no readable lightness, no pair, and a green run over nothing at all. The
    // count is here too, so a name silently dropped from the list is a red
    // rather than a quieter guard.
    expect(STATE_FAMILY.length).toBe(7);
    for (const name of STATE_FAMILY) {
      expect(NMS_TOKEN_NAMES, `${name} is not a declared token`).toContain(name);
    }
    expect(STATE_PAIRS.length).toBe(21);
  });

  it("writes every state colour in a lightness this guard can read", () => {
    // The second half of the floor. `oklch(0.45 0 0)` is the base mode's whole
    // notation, and a value in any other one would compare as `undefined`
    // against `undefined` and pass every spacing case below without measuring a
    // thing.
    for (const name of STATE_FAMILY) {
      const value = GRAYSCALE_TOKENS[name];
      expect(
        grayscaleLightness(value),
        `${name} is ${value}, which is not oklch(L 0 0)`,
      ).toBeDefined();
    }
  });

  it.each(STATE_PAIRS.filter(([one, other]) => !isDeclaredIdentical(one, other)))(
    "keeps %s and %s at least 0.02 L apart",
    (one, other) => {
      const first = grayscaleLightness(GRAYSCALE_TOKENS[one])!;
      const second = grayscaleLightness(GRAYSCALE_TOKENS[other])!;
      const gap = Math.abs(first - second);
      // The verdict sentence IS the compared value, so the diff a red prints
      // says which two states collapsed and by how much, in the shape
      // `ops/components/contrast.test.ts` uses for a failed ratio.
      expect(
        gap + 1e-9 >= MIN_STATE_LIGHTNESS_GAP
          ? "apart"
          : `${one} at L ${first} and ${other} at L ${second} are ${gap.toFixed(3)} L apart, ` +
            `and grayscale is the mode that reviews state. The family spaces itself ` +
            `${MIN_STATE_LIGHTNESS_GAP} L; move one of them.`,
      ).toBe("apart");
    },
  );

  it.each(DECLARED_IDENTICAL_PAIRS.map((pair) => [pair.one, pair.other, pair] as const))(
    "still finds %s and %s holding one value, as declared",
    (one, other, pair) => {
      // The exemption asserted rather than merely taken. If these two ever come
      // apart, the declaration is stale and this red is what says so: delete the
      // row and let the spacing rule have the pair.
      expect([one, GRAYSCALE_TOKENS[one]]).toEqual([one, GRAYSCALE_TOKENS[other]]);
      expect(pair.reason.length).toBeGreaterThan(80);
      expect(STATE_FAMILY).toContain(one);
      expect(STATE_FAMILY).toContain(other);
    },
  );
});
