/**
 * THE STALE NOTICE'S THREE NUMBERS, WIRED THE SAME WAY AT EVERY CALL SITE.
 *
 * ── THE HAZARD IS NEW WITH THE EXTRACTION ────────────────────────────────────────────
 * Before Seam D, each route interpolated `expectedVersions.min` and `.max` directly into
 * the sentence that renders them, so a transposition was visible in the same JSX that
 * printed it. Now three route files hand three named numbers to a primitive that lives
 * somewhere else, and `snapshot-notice-copy.test.tsx` pins only the receiving end: it
 * renders the notice with authored numbers and asserts the window reads `4–6`, which is
 * exactly as true when a caller passes the window backwards. Swapping `min` and `max` at
 * a call site leaves the whole suite green — measured, which is why this file exists.
 *
 * The failure is quiet and wrong in the direction that matters: "the stored snapshot is
 * schema version 2, which is outside the versions this app supports (6–4)" tells the
 * operator to go and find an engine build in an empty range.
 *
 * ── WHY A SOURCE SCAN ────────────────────────────────────────────────────────────────
 * The claim is about WHERE and HOW several route files wire one primitive, which is the
 * same shape of claim `route-move.test.ts` and `jsdom-docblock-guard.test.ts` already
 * carry with the same instrument. A render test would have to mount a route — router,
 * loader, session gate and all — to observe three numbers crossing a prop boundary, and
 * it would still cover only the route it mounted. This scan covers every route there is
 * and any route added later.
 *
 * NOTHING HERE IS RETIRED OR RESTATED. `route-move.test.ts` asserts that each route keeps
 * its own guard branch and its own `Shell`; it says nothing about the props, and its
 * regexes are untouched by this file.
 *
 * Every value below is authored. Nothing reads product data.
 */
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { sourceFiles } from "../../../../ops/testkit/repo-sources.testkit.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The wiring, spelled once: the stored version, then the window's LOW end as `min` and
 * its HIGH end as `max`. Whitespace-tolerant so the formatter may reflow it; the
 * pairing of each prop with its own field is what is fixed.
 */
const WIRED_IN_ORDER =
  /<SnapshotStaleNotice\s+storedVersion=\{result\.storedVersion\}\s+min=\{result\.expectedVersions\.min\}\s+max=\{result\.expectedVersions\.max\}\s*\/>/;

/** A test file is not a call site — this one spells the JSX it is looking for. */
const isTest = (file: string) =>
  file.endsWith(".test.ts") || file.endsWith(".test.tsx");

/** Every route file that renders the stale notice at all, found rather than listed. */
function callSites(): { name: string; source: string }[] {
  return sourceFiles({ dir: HERE, as: "absolute" })
    .filter((file) => !isTest(file))
    .map((file) => ({ name: basename(file), source: readFileSync(file, "utf-8") }))
    .filter((file) => file.source.includes("<SnapshotStaleNotice"));
}

describe("the stale-snapshot notice's call sites", () => {
  it("is rendered by the three routes that carry a snapshot guard, and no others", () => {
    // Enumerated so a fourth call site has to be looked at rather than inherited. The
    // list is also what makes the per-site assertion below non-vacuous: a scan that
    // found nothing would otherwise pass.
    expect(callSites().map((file) => file.name).sort()).toEqual([
      "big-picture.tsx",
      "index.tsx",
      "ladder.$planId.tsx",
    ]);
  });

  it("hands each route's own window to `min` and `max` in that order", () => {
    for (const { name, source } of callSites()) {
      // `name` rides in the assertion message so a red names the route file.
      expect(source, `${name} wires the stale notice by hand`).toMatch(
        WIRED_IN_ORDER,
      );
    }
  });

  it("wires the notice nowhere but a route file", () => {
    // The primitive takes scalars, so a second caller elsewhere in `apps/web` would be a
    // fourth place for the window to be transposed, out of this scan's reach.
    const outside = sourceFiles({ dir: join(HERE, ".."), as: "absolute" })
      .filter((file) => !file.startsWith(HERE))
      .filter((file) => !isTest(file))
      .filter((file) => readFileSync(file, "utf-8").includes("<SnapshotStaleNotice"));

    expect(outside, outside.join("\n")).toEqual([]);
  });
});
