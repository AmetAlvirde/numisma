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

import { APP_TOKENS, THEME_MODES } from "./theme-modes.ts";

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
 * ── NAME-FOR-NAME, WHICH IS NOW FIFTEEN ON BOTH SIDES ─────────────────────
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
 * the two numbers agreed at each step and agree at fifteen.
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
