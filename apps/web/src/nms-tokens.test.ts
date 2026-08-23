import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { NMS_TOKEN_NAMES } from "@numisma/components/tokens.ts";

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

/** Every `--nms-*` custom property this text DEFINES (declares), in order. */
function definedTokenNames(css: string): string[] {
  return [...css.matchAll(/^\s*(--nms-[\w-]+)\s*:/gm)].map((match) => match[1]!);
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
    expect(NMS_TOKEN_NAMES.length).toBeGreaterThanOrEqual(12);
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
