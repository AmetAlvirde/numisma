import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * WRONG-BY-COLLISION, THE ONE FAILURE GREP IS THE RIGHT INSTRUMENT FOR
 * (spec #420 §1 failure 4, §5 S0.3; D5).
 *
 * The other three silent failures in this migration are cascade facts and need
 * a build or a browser to see. This one is a NAMING MISTAKE, and it is the only
 * one a text scan catches — which is also the only thing that catches it at all.
 *
 * THE TRAP, CONCRETELY. `tailwind.css`'s `@theme` block maps Tailwind's colour
 * namespace onto the PACKAGE's tokens: `--color-muted: var(--nms-muted)`. In the
 * package's vocabulary `--nms-muted` is a RECESSED SURFACE — the well behind a
 * hovered ghost button. In the app's vocabulary `--muted` is SECONDARY TEXT.
 * Same English word, opposite roles. Write `text-muted` in an app component and
 * every stage of the pipeline agrees with you: the candidate is scanned, the
 * utility is emitted, the token resolves, the rule wins its cascade, and the
 * most-used colour in the app paints the wrong grey. No build error, no empty
 * rule, no red test anywhere else in this suite. IT COMPILES.
 *
 * THE RULE THIS ENFORCES, stated in `tailwind.css`'s `@theme` header as well:
 * THEME COLOUR UTILITIES ARE PACKAGE-ONLY. App code reads house colours as
 * arbitrary values — `text-[var(--muted)]`, `bg-[var(--card)]` — which name the
 * app's own token and cannot collide with the package's namespace. Nothing is
 * lost: `styles.css` is the one place colour is defined either way, and D5 mints
 * no new tokens to make this read shorter.
 *
 * WHAT THIS NOW WATCHES IS ROUTE MARKUP, NOT COMPONENT MARKUP (spec #439 §4.5). The
 * seven components that used to sit under `src/components` are moving into
 * `@numisma/components` one slice at a time, and each one leaves this scan as it goes.
 * The rule has not changed; the tree it applies to has. What is left when the wave lands
 * is `router.tsx`, `routes/__root.tsx` and the five route files — which is exactly where
 * `text-muted` can still be typed by hand.
 *
 * PACKAGE SOURCE IS EXEMPT BY CONSTRUCTION, not by an exception list. It lives
 * outside the tree scanned below, and `bg-primary` on the package `Button` is
 * exactly right there — that is the vocabulary those utilities belong to.
 *
 * TEST FILES ARE EXEMPT, and one file needs it: `login-submit-button.test.tsx`
 * ASSERTS `bg-primary` on the rendered package `Button`, which is the app-side
 * proof that the token contract paints. A guard that flagged its own sibling
 * would be a guard nobody could keep green.
 */

const SRC = dirname(fileURLToPath(import.meta.url));

/**
 * The colour names `@theme` maps, and the utility prefixes that take a colour.
 *
 * Both lists are literal rather than parsed out of `tailwind.css`. Deriving them
 * would make the guard follow the map — including in the one direction that
 * matters least and hurts most: a mapping deleted by accident would silently
 * narrow the guard at the same moment it narrowed the theme. The lists are
 * short, they change roughly never, and `tailwind.css`'s header carries the same
 * rule in prose.
 *
 * THE LIST IS LITERAL, AND A SUBSET FLOOR HOLDS IT COMPLETE (spec #439 review
 * finding 2). Keeping it literal buys the paragraph above, and it costs the
 * mirror failure: a mapping ADDED to `@theme` widens the theme and leaves the
 * guard where it was, so the new name becomes typeable in app code with nothing
 * red. That is what happened here — `pos`, `ok`, `warn` and `now` were minted at
 * §4.5 and listed nowhere, and `neg` and `card` had been unlisted since before
 * this wave. The case below asserts one direction only: every name `@theme` maps
 * must appear here. It can therefore only ever WIDEN this list, never narrow it,
 * which is the direction the paragraph above rules out.
 */
const COLOR_PREFIXES = [
  "bg",
  "text",
  "border",
  "ring",
  "fill",
  "stroke",
  "outline",
  "shadow",
  "from",
  "via",
  "to",
];

const THEME_COLOR_NAMES = [
  "background",
  "foreground",
  "muted",
  "border",
  "input",
  "ring",
  "primary",
  "secondary",
  "destructive",
  "card",
  "neg",
  "pos",
  "ok",
  "warn",
  "now",
];

/**
 * Matches a theme colour utility anywhere in the text.
 *
 * `-foreground` is optional because half the names take the paired form
 * (`bg-primary` and `text-primary-foreground` are both theme utilities); the
 * opacity modifier is optional because `text-destructive/70` is the same
 * mistake with an alpha on it. A leading `\b` lets a variant prefix through
 * (`hover:bg-primary` is a hit, as it should be) and the trailing `\b` stops
 * `text-[var(--muted)]` from matching, since `[` is where the arbitrary-value
 * form diverges — that form is the SANCTIONED one and must never be flagged.
 */
const THEME_COLOR_UTILITY = new RegExp(
  `\\b(?:${COLOR_PREFIXES.join("|")})-(?:${THEME_COLOR_NAMES.join("|")})(?:-foreground)?(?:/\\d+)?\\b`,
  "g",
);

/** A test file, by this repo's one naming convention. */
const isTestFile = (path: string): boolean =>
  /\.test\.[cm]?[jt]sx?$/.test(basename(path));

/** Every `.tsx` under a directory, recursively. */
function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return entry.endsWith(".tsx") ? [path] : [];
  });
}

const appComponents = tsxFiles(SRC).filter((path) => !isTestFile(path));

describe("no theme colour utility in app code", () => {
  it("finds app components to scan at all", () => {
    // Guards the guard. A walker that stopped returning files — a moved tree, a
    // renamed extension — would pass every case below over an empty list and
    // report the strongest possible green for having looked at nothing.
    //
    // THE FLOOR IS THE WAVE'S END STATE, SET ONCE (spec #439 §4.5). This is a
    // false-pass floor, not a census: its job is to prove the walk still returns
    // files. The count falls monotonically from fifteen to seven as the domain
    // migration moves each component out, so a floor true at seven is true at every
    // step in between — and the alternative was five separate edits to one number,
    // each of which reads in review as somebody weakening a guard.
    expect(appComponents.length).toBeGreaterThan(6);
  });

  it.each(appComponents.map((path) => relative(SRC, path)))(
    "%s reads house colours as arbitrary values, never theme utilities",
    (name) => {
      const hits = readFileSync(join(SRC, name), "utf8").match(
        THEME_COLOR_UTILITY,
      );
      // The failure message is the hit list, because the fix is mechanical once
      // you can see it: `text-muted` becomes `text-[var(--muted)]`.
      expect([name, hits]).toEqual([name, null]);
    },
  );
});

describe("the convention is written down where the utilities are created", () => {
  it("states the package-only rule in tailwind.css's @theme header", () => {
    // A guard with no stated rule behind it reads, on a red, as an arbitrary
    // style objection — and the fix someone reaches for is deleting the guard.
    // The rule lives in the header of the block that CREATES these utilities,
    // which is the one place a reader is already looking when they reach for
    // one. Spec #420 §8 success signal 2 checks for it by hand; this checks for
    // it on every run.
    const tailwindCss = readFileSync(join(SRC, "tailwind.css"), "utf8");
    const header = tailwindCss.slice(0, tailwindCss.indexOf("@theme {"));
    expect(header).toContain("THEME COLOUR UTILITIES ARE PACKAGE-ONLY");
    expect(header).toContain("IS THE TRAP, AND IT COMPILES");
    expect(header).toContain("theme-color-utilities.test.ts");
  });

  it("lists every colour name `@theme` maps", () => {
    // THE GUARD CANNOT BE NARROWER THAN THE THEME. `THEME_COLOR_NAMES` is literal
    // for the reason its docblock gives, and this is the one derivation that costs
    // nothing: it reads the map and demands the list COVER it. A mapping deleted
    // from `tailwind.css` leaves this green and the list one name wide of the
    // theme, which is harmless; a mapping added without a matching list entry is
    // a hole, and that is what reds.
    const tailwindCss = readFileSync(join(SRC, "tailwind.css"), "utf8");
    const theme = tailwindCss.slice(tailwindCss.indexOf("@theme {"));
    const mapped = [
      ...new Set(
        [...theme.matchAll(/^\s*--color-([a-z-]+)\s*:/gm)].map((match) =>
          (match[1] as string).replace(/-foreground$/, ""),
        ),
      ),
    ].sort();
    // The floor guards the derivation itself: a `@theme` block this regex stopped
    // reading would assert an empty set against the list and pass.
    expect(mapped.length).toBeGreaterThan(8);
    expect(mapped.filter((name) => !THEME_COLOR_NAMES.includes(name))).toEqual([]);
  });
});

describe("the guard itself", () => {
  it("flags the trap it exists for", () => {
    // The negative control, standing rather than performed once by hand. A
    // regex edit that stopped matching `text-muted` would otherwise leave every
    // case above green forever, which is the shape this whole spec's guards are
    // written against.
    expect('className="card text-muted"').toMatch(THEME_COLOR_UTILITY);
    expect("hover:bg-primary").toMatch(THEME_COLOR_UTILITY);
    expect("text-destructive/70").toMatch(THEME_COLOR_UTILITY);
    expect("border-input").toMatch(THEME_COLOR_UTILITY);
    expect("text-secondary-foreground").toMatch(THEME_COLOR_UTILITY);
  });

  it("leaves the sanctioned arbitrary-value form alone", () => {
    // The other half, and the one a tightened regex would break loudly: if
    // `text-[var(--muted)]` ever matched, the migration's own idiom would be
    // unwritable and nine slices would have nowhere to land.
    expect('className="text-[var(--muted)] mt-1"').not.toMatch(
      THEME_COLOR_UTILITY,
    );
    expect("bg-[var(--card)]").not.toMatch(THEME_COLOR_UTILITY);
    expect("shadow-[0_0_0_1px_var(--line)]").not.toMatch(THEME_COLOR_UTILITY);
  });
});
