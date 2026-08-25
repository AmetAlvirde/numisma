import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { NMS_TOKEN_NAMES } from "@numisma/components/tokens.ts";

import {
  customPropertyDeclarations,
  customPropertyNames,
} from "../../../ops/components/css-custom-properties.ts";

/**
 * THE CONSUMER SIDE OF THE TOKEN CONTRACT (spec #412 §4.3, assertion 2).
 *
 * `@numisma/components` ships no CSS. It declares token NAMES and reads them,
 * and `apps/web` owes it the VALUES. Both halves of that trade fail silently:
 *
 * - A token the app never defines makes every `var(--nms-…)` read in the
 *   package resolve to nothing. `color-mix` with an undefined argument computes
 *   to transparent while the rule sits present and correct in the stylesheet.
 * - A token no `@theme` block maps into Tailwind's namespace makes the matching
 *   utility vanish from the built CSS ENTIRELY — no error, no empty rule, exit
 *   code 0.
 *
 * Neither is visible in a diff, in a build log, or in a render test: jsdom will
 * not resolve `color-mix` through a cascade. This file is the text-channel half
 * of the guard, and it is what turns "someone remembered" into a red result.
 * The computed-style half is a documented browser procedure — see the header of
 * `tailwind.css` and spec #412 §5 Seam E.
 *
 * WHAT IT DELIBERATELY DOES NOT ASSERT: the token VALUES. They belong to the
 * generator (`ops/components/consumers.ts`) and to the app's own overrides;
 * pinning them here would make every palette change a two-file edit for no
 * added proof.
 */

const SRC = dirname(fileURLToPath(import.meta.url));

const read = (name: string): string => readFileSync(join(SRC, name), "utf8");

const tailwindCss = read("tailwind.css");
const generatedCss = read("nms-tokens.generated.css");
const stylesCss = read("styles.css");
const rootRoute = read(join("routes", "__root.tsx"));

/**
 * Every `--nms-*` custom property this text DEFINES (declares), in order.
 *
 * The syntax parse is shared with `ops/components` and with the workbench's
 * drift test — one regex over one syntax, so the three guards that read these
 * files cannot disagree about what a declaration is.
 */
function definedTokenNames(css: string): string[] {
  return customPropertyNames(css).filter((name) => name.startsWith("--nms-"));
}

describe("the app defines every token the package declares", () => {
  const defined = new Set([
    ...definedTokenNames(generatedCss),
    ...definedTokenNames(tailwindCss),
    ...definedTokenNames(stylesCss),
  ]);

  it.each(NMS_TOKEN_NAMES)("defines %s", (name) => {
    expect(defined).toContain(name);
  });

  it("declares at least as many tokens as the package does", () => {
    // Guards the direction the per-name cases cannot: a token list that shrank
    // to nothing would pass an empty `it.each`.
    expect(NMS_TOKEN_NAMES.length).toBeGreaterThanOrEqual(19);
  });

  it("defines no --nms-* name the package never declared", () => {
    // THE SURPLUS DIRECTION (spec #420 §5 S0.2, D4), and with it the block
    // becomes an exact mirror: the cases above forbid a hole, this forbids a
    // growth, so it can no longer drift by addition either.
    //
    // WHY A SURPLUS ALIAS IS A DEFECT AND NOT MERELY SPARE. It reads, in a
    // diff and in the workbench's app mode, as a value the app paints — and
    // nothing paints it. Spec #412 carried `--nms-card` and
    // `--nms-muted-foreground` on the argument that a future component would
    // want them ready; this migration deletes them on the stronger one, that a
    // token no component reads is a token no test can verify, which is the
    // rule `tokens.ts` already keeps on the package's own side. When a
    // component starts reading a name, the name lands in `NMS_TOKEN_NAMES`
    // first and this case goes green with it. Both names spec #412 minted
    // early have now made that round trip: `--nms-muted-foreground` with
    // `Absent` and `--nms-card` with `Card`, each declared, aliased and
    // mirrored again in the slice that moved the component reading it.
    expect([...defined].sort()).toEqual([...NMS_TOKEN_NAMES].sort());
  });
});

/**
 * THE APP'S OVERRIDES — `styles.css`'s ONE SANCTIONED EDIT (spec #412 §4.2, §5).
 *
 * Slices 1 to 4 left that file byte-identical and the app ran on the package's
 * grayscale defaults. This slice mints an accent, aliases the rest onto the app
 * palette, and everything below is what stops that block from rotting quietly.
 *
 * ALIASES, NOT COPIES. `--nms-background: var(--bg)` keeps `styles.css` the one
 * place that defines colour, which is what that file's own comments demand. A
 * hex pasted in here instead would look right on the day it landed and drift the
 * first time the palette moved, in the one direction no test can see: the
 * package's components would keep painting last season's grey while every
 * hand-written rule moved on.
 *
 * THE APP'S `--muted` IS READ, NEVER REDEFINED, and that has not changed.
 * Redefining it would repaint 25 call sites in `styles.css` and 2 in
 * `PriceDropPathChart.tsx` — the capture the spike suffered by accident, which
 * is the whole reason this increment namespaces rather than renames. What
 * carries it into the package's namespace is an ALIAS under a second name.
 * Spec #420 S0 deleted `--nms-muted-foreground` along with `--nms-card` because
 * no component in the package read either one; spec #432 §4.1 brought each back
 * in the slice that moved the component reading it, `Absent` and then `Card`,
 * which is the precondition the deletion was about. The block stays an exact
 * mirror of `NMS_TOKEN_NAMES` in both directions — nineteen names now. Fifteen
 * was wave 1's count; spec #439 S1 added `--nms-pos`, `--nms-ok` and
 * `--nms-warn` when `SummaryCard` crossed reading all three, and S5 added
 * `--nms-now` when `PriceDropPathChart` crossed reading it. Every one of the
 * four had been NAMED in `tokens.ts` and left undeclared until the day the
 * component arrived. Both sides moved together on every one.
 *
 * `--nms-muted` IS NOT `--muted`, and the collision of English words is exactly
 * why the prefix exists. shadcn reads `--nms-muted` as a recessed SURFACE
 * (Button's `ghost` and `outline` hover); the app's `--muted` is secondary TEXT.
 * Same word, different roles, and aliasing one onto the other would put grey
 * type-colour behind a hovered button.
 */
describe("the app's --nms-* overrides in styles.css", () => {
  // The same parse `apps/workbench/src/app-token-drift.test.ts` runs over this
  // file. That test resolves these aliases and pins the VALUES; this one asks
  // only whether the app took a position on each name. Two questions, one
  // parse.
  const overrides = new Map(
    customPropertyDeclarations(stylesCss)
      .filter(({ name }) => name.startsWith("--nms-"))
      .map(({ name, value }) => [name, value] as const),
  );

  it.each(NMS_TOKEN_NAMES)("overrides the package default for %s", (name) => {
    // Not "is defined somewhere" — the sibling suite above already allows the
    // generated grayscale file to answer that. This asks the narrower question:
    // did the APP take a position on this token, in the one file that owns
    // colour. A token left to the package default is a grayscale hole in a
    // themed app, and it looks deliberate in a diff.
    expect(overrides.has(name)).toBe(true);
  });

  it.each([
    ["--nms-background", "var(--bg)"],
    ["--nms-foreground", "var(--text)"],
    ["--nms-border", "var(--line)"],
    ["--nms-input", "var(--line)"],
    ["--nms-destructive", "var(--neg)"],
    ["--nms-muted-foreground", "var(--muted)"],
    ["--nms-card", "var(--card)"],
    // TWO NAMES, ONE HOUSE COLOUR, AND THAT IS THE END STATE (spec #432 §4.1).
    // `--nms-destructive` is the affordance of a control that destroys
    // something; `--nms-neg` is the sign of a number. Both read `--neg` today,
    // and the pair is written out here rather than collapsed so a future edit
    // that points one of them somewhere else reds this line instead of passing
    // as a tidy-up.
    ["--nms-neg", "var(--neg)"],
    // THE CARD'S THREE (spec #439 S1). Aliases like the rest: `--pos`, `--ok` and
    // `--warn` stay declared exactly once each, in the palette block at the top, and
    // the case at the bottom of this block is what counts those declarations.
    ["--nms-pos", "var(--pos)"],
    ["--nms-ok", "var(--ok)"],
    ["--nms-warn", "var(--warn)"],
    // THE SPOT LEVEL (spec #439 S5), and the last house colour to get a package
    // counterpart. `--now` stays declared exactly once, in the palette block at the
    // top, and the chart reaches it through this alias from inside the package.
    ["--nms-now", "var(--now)"],
  ])("aliases %s onto %s rather than copying its value", (name, alias) => {
    expect(overrides.get(name)).toBe(alias);
  });

  it("mints the accent rather than repurposing --now", () => {
    // `--now` is the spot colour chosen to collide with nothing else on the
    // Price Drop Path. Painting every call to action with it would put "where
    // price is now" on every button in the app, so the accent is its own
    // palette entry and no OTHER package name may reach for `--now`.
    expect(stylesCss).toMatch(/^\s*--accent:\s*#[0-9a-f]{6};/m);
    expect(overrides.get("--nms-primary")).toBe("var(--accent)");
    expect(overrides.get("--nms-ring")).toBe("var(--accent)");
    // `--nms-now` IS THE EXCEPTION, AND IT IS THE POINT RATHER THAN A HOLE IN THE
    // SWEEP (spec #439 S5). This case was written while the spot colour had no
    // package counterpart at all, and it read as "nothing may alias `--now`". What
    // it was actually forbidding was WELDING the spot colour onto an existing role,
    // which is what would have put a price level on every button. Giving it a name
    // of its own honours that argument instead of breaking it — so the sweep now
    // says every OTHER package name keeps its hands off, which is the claim that
    // was ever true. Skipping the one row by name, rather than loosening the match,
    // is what keeps the next `--nms-x: var(--now)` red.
    for (const [name, value] of overrides) {
      if (name === "--nms-now") continue;
      expect(value, name).not.toContain("--now");
    }
  });

  it("mints a recessed surface for --nms-muted, distinct from the app's --muted text", () => {
    expect(stylesCss).toMatch(/^\s*--recess:\s*#[0-9a-f]{6};/m);
    expect(overrides.get("--nms-muted")).toBe("var(--recess)");
    // And the app's own `--muted` is READ by hand-written rules, never
    // REDEFINED. What carries it into the package's namespace is a second name,
    // `--nms-muted-foreground`, which spec #432 §4.1 restored in the same slice
    // that moved `Absent` into the package reading it. The two greys stay
    // separate either way — that is what the prefix is for — and the pair of
    // assertions here is what stops the collision being "fixed" by pointing one
    // at the other.
    //
    // THE ASSERTION ABOVE IS THE ONE THAT MATTERS ON THIS LINE'S ACCOUNT.
    // `--nms-muted` stays pointed at `--recess` no matter how many aliases the
    // block carries, because the surface and the text are two different roles.
    // A mechanical rename that welded them would satisfy the line below and red
    // the line above, which is exactly the order those two are written in.
    expect(overrides.get("--nms-muted-foreground")).toBe("var(--muted)");
  });

  it("redefines no existing app palette token — the edit is purely additive", () => {
    // The whole risk of touching this file. Each of these names is declared
    // exactly once, in the palette block at the top, and a second declaration
    // added down here would repaint the app from a block whose stated job is
    // wiring the package.
    for (const appToken of [
      "--bg",
      "--card",
      "--line",
      "--text",
      "--muted",
      "--ok",
      "--warn",
      "--pos",
      "--neg",
      "--now",
    ]) {
      const declarations = stylesCss.match(
        new RegExp(`^\\s*${appToken}\\s*:`, "gm"),
      );
      expect([appToken, declarations?.length]).toEqual([appToken, 1]);
    }
  });
});

describe("the generated defaults actually reach the browser", () => {
  it("is imported by the Tailwind entry", () => {
    // The generator writes the file whether or not anything loads it. An import
    // that was never added leaves twelve perfectly correct declarations in a
    // file the browser never fetches.
    expect(tailwindCss).toMatch(/@import\s+"\.\/nms-tokens\.generated\.css"/);
  });

  it("is linked from the root route as a SECOND stylesheet, after appCss", () => {
    expect(rootRoute).toContain('from "../tailwind.css?url"');
    const appCssLink = rootRoute.indexOf("href: appCss");
    const tailwindLink = rootRoute.indexOf("href: tailwindCss");
    expect(appCssLink).toBeGreaterThan(-1);
    expect(tailwindLink).toBeGreaterThan(appCssLink);
  });
});

describe("every declared token is mapped into Tailwind's namespace", () => {
  // A theme utility (`bg-primary`, `rounded-md`) exists only if a theme
  // variable backs it. Without the mapping the package's components are scanned
  // perfectly and still render unstyled.
  const theme = tailwindCss.slice(tailwindCss.indexOf("@theme"));

  it.each(NMS_TOKEN_NAMES)("maps %s", (name) => {
    expect(theme).toMatch(new RegExp(`:\\s*var\\(${name}\\)\\s*;`));
  });
});

describe("preflight does not land", () => {
  it("imports theme.css and utilities.css, never preflight.css", () => {
    // `styles.css` styles bare elements deliberately. Omitting the preflight
    // import is the ONLY supported way to skip it in v4 — `corePlugins` is gone
    // — so this assertion is the whole mechanism, not a restatement of it.
    expect(tailwindCss).toContain('@import "tailwindcss/theme.css"');
    expect(tailwindCss).toContain('@import "tailwindcss/utilities.css"');
    expect(tailwindCss).not.toMatch(/@import\s+"[^"]*preflight/);
  });

  it("does not import the tailwindcss barrel, which carries preflight", () => {
    expect(tailwindCss).not.toMatch(/@import\s+"tailwindcss"/);
  });
});
