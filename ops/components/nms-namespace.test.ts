import { readFileSync } from "node:fs";
import { relative } from "node:path";

import { describe, expect, it } from "vitest";

import { PACKAGE_SRC, packageSourceFiles } from "./package-source.ts";
import { NMS_PREFIX, customPropertyReads } from "./rewrites.ts";

/**
 * THE NAMESPACE GUARD (spec #412 §3, second silent failure; Seam B).
 *
 * `packages/components` reads custom properties and defines none. Every read it
 * makes therefore resolves against WHATEVER THE CONSUMER HAPPENS TO HAVE, and
 * `apps/web` owns ten bare properties of its own in `styles.css` — `--bg
 * --card --line --text --muted --ok --warn --pos --neg --now`. `--muted` is the
 * one that collides today. An unnamespaced `var(--muted)` inside an arbitrary
 * value in a component resolves against the app's unrelated muted-text grey: in
 * the spike it computed to a real colour and LOOKED PLAUSIBLE, which is worse
 * than failing, because nothing in the render says the value came from the
 * wrong owner. Where the name does not resolve at all, `color-mix` gets an
 * undefined argument and the declaration computes to transparent WHILE THE RULE
 * SITS PRESENT AND CORRECT IN THE STYLESHEET.
 *
 * `pnpm components:add` rewrites bare reads into the namespace at write time.
 * This is the standing form of that claim: the write path can be bypassed by a
 * hand edit, a merge, or a component pasted in from upstream, and the guard has
 * to hold whatever route the source arrived by.
 *
 * WRITTEN AGAINST THE NAMESPACE, NEVER AGAINST TODAY'S COLLIDING NAMES. A list
 * of the ten would go stale the first time `styles.css` gains a palette name,
 * and the eleventh would reintroduce the exact failure this closed. The rule is
 * that the package reads inside `--nms-` and nowhere else, which is checkable
 * without knowing anything about the consumer at all — that independence is the
 * point.
 *
 * WHAT THIS TEST DOES NOT PROVE, and must not be read as proving: that any of
 * those namespaced names has a VALUE. A read of `var(--nms-primary)` against a
 * consumer that never defined it computes to nothing just as silently as the
 * collision above — same rendered result, different cause, different channel.
 * Naming and defining are two separate contracts; conflating them is the
 * mistake these guards exist to prevent. The defining half is
 * `apps/web/src/nms-tokens.test.ts`, per consumer, and it does not check
 * namespacing any more than this file checks values.
 *
 * NARROWER SIBLING, NOT A DUPLICATE. `packages/components/src/tokens.test.ts`
 * makes the same check from inside the package as one of several claims about
 * `tokens.ts`, with a per-file `it.each` and no repo-level reach. This is the
 * standing guard the package side deliberately stopped short of: one assertion,
 * every file, and a red that NAMES THE FILE AND THE PROPERTY so the fix does not
 * start with a search.
 */

/** One offending read, formatted so the failure message is the whole diagnosis. */
function offences(): string[] {
  return packageSourceFiles().flatMap((file) =>
    customPropertyReads(readFileSync(file.absolute, "utf8"))
      .filter((name) => !name.startsWith(NMS_PREFIX))
      // The name, not the syntax it was written in: a read reaches the same
      // property as `var(--muted)` or as Tailwind 4's `bg-(--muted)`, and a
      // message that named one would send the fixer looking for the other.
      .map((name) => `${relative(PACKAGE_SRC, file.absolute)} reads ${name}`),
  );
}

describe("packages/components reads only --nms-* custom properties", () => {
  it("walks a package that actually has source in it", () => {
    // Guards the guard: an empty walk makes the assertion below pass with
    // nothing checked, which is how a source-scan test fails toward green.
    const files = packageSourceFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((file) => file.absolute.endsWith("button.tsx"))).toBe(true);
  });

  it("reads nothing outside the namespace", () => {
    // Strict on purpose: `--tw-*` and any other well-known prefix is an
    // offence here too. The package has no reason to reach into Tailwind's
    // internals, and an exemption list is the thing this guard replaces.
    expect(offences()).toEqual([]);
  });
});
