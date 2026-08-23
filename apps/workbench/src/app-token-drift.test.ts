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
 * ── FOURTEEN NAMES, NOT TWELVE. A DELIBERATE CHOICE. ───────────────────────
 *
 * `packages/components/src/tokens.ts` declares TWELVE tokens — the ones a
 * component in the package actually reads. `styles.css` defines FOURTEEN: those
 * twelve plus `--nms-card` and `--nms-muted-foreground`, which spec §4.2 names
 * and which nothing in the package renders yet.
 *
 * THIS TEST MIRRORS ALL FOURTEEN, name-for-name, rather than scoping itself to
 * `NMS_TOKEN_NAMES`. Two reasons, and the second is the one that decides it:
 *
 *   1. #418 asks for "the `--nms-*` block in `apps/web/src/styles.css`,
 *      name-for-name". The block is fourteen names. Scoping to twelve would
 *      answer a narrower question than the one asked and read, in a diff, as if
 *      it had answered the wider one.
 *   2. The fourteen are where the next component lands. The day `Card` enters
 *      the package, `--nms-card` becomes a token something renders — and app
 *      mode is already correct for it, having been held honest all along. The
 *      twelve-scoped version would have let those two drift freely for exactly
 *      as long as they were unexercised, then handed the new component a stale
 *      value on its first day.
 *
 * The cost, stated: app mode carries two values no fixture can currently show.
 * That is data the workbench holds and does not render, which is a smaller
 * problem than a value it renders and gets wrong. THEMED MODE MAKES THE
 * OPPOSITE CHOICE — it is scoped to the package's twelve, because its whole job
 * is to make an UNEXERCISED DECLARED token visible, and a token the package
 * never declared is not in that scope.
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

  it("declares more names than the package does, and knows why", () => {
    // The fourteen-vs-twelve gap, pinned rather than assumed. If this ever
    // reads `toBe` equal, the package caught up and the header's second reason
    // has been paid off — which is a good day, not a failure.
    expect(Object.keys(APP_TOKENS).length).toBeGreaterThanOrEqual(
      NMS_TOKEN_NAMES.length,
    );
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
