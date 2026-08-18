/**
 * Blast-radius guard #3 (spec #277, slice 1): the plans sidecar is a PUSH-ONLY read,
 * exactly like the durable log (`event-store-import-guard.test.ts`) and the
 * preferences sidecar (`preferences-import-guard.test.ts`). This file follows their
 * walk-the-source-tree idiom deliberately — no build step, so it runs on every
 * `pnpm test`, on every machine, and it MUST NOT self-skip.
 *
 * WHY THIS ONE SCANS SYMBOLS WHERE ITS TWO SIBLINGS MATCH IMPORT POSITIONS. A
 * package-level ban is IMPOSSIBLE for the plans selectors: they are exported through
 * `@numisma/engine`'s main index, and the engine is legitimately imported by non-push
 * web code (the projection contract, the components). Banning the package would ban
 * the app. So the rule is pinned to the SYMBOLS instead, which has the side benefit of
 * holding regardless of which package exports them — the IO half lives in
 * `@numisma/preferences` today, already confined at package level by the preferences
 * guard, and this scan is the belt over those braces.
 *
 * WHAT THE CONFINEMENT BUYS: a render surface that called `listPlansAsOf` would be
 * selecting plans at request time, off a file on the machine's disk, outside the one
 * as-of discipline the push applies — and a route that resolved the sidecar path
 * itself would be reading operator capital declarations from a browser-reachable
 * path. The wire carries the narrowed conclusion; nothing else needs the source.
 *
 * TWO SCANNING CHOICES, RECORDED SO THEY ARE NOT "FIXED" LATER:
 *  - COMMENTS ARE STRIPPED. Prose that CITES a selector is not a read, and this repo's
 *    source is heavily commented. Same reasoning as
 *    `push/orders-stay-off-the-wire.test.ts`, whose `stripComments` shape this reuses.
 *  - TEST FILES ARE EXCLUDED. This guard file names its own contraband, and so do the
 *    engine's own selector tests; a scanner that could not tell a test naming a symbol
 *    apart from production code reading it is a scanner nobody would keep.
 *
 * SCANS SIX EXTENSIONS, NOT TWO. `GUARD_SOURCE_EXTENSIONS` is the list this file
 * declared for itself before it moved onto the shared walker, passed back in
 * explicitly because the walker's `.ts`/`.tsx` default would narrow it. No
 * `.js`/`.jsx`/`.mts`/`.cts` file exists under `apps/web` today, so the scanned set
 * is unchanged — the point is that the first one to arrive is still caught here.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GUARD_SOURCE_EXTENSIONS,
  sourceFiles,
} from "../../../ops/testkit/repo-sources.testkit.js";

const HERE = dirname(fileURLToPath(import.meta.url));
/** The web app's source root — this file lives at its top level. */
const SRC_DIR = resolve(HERE);
/** The ONE directory allowed to name the plans sidecar. */
const ALLOWED_DIR = join(SRC_DIR, "push");

/**
 * The plans surface, IO half and selector half together. The first four are
 * identifiers (word-boundary matched); the last is a filename, so its dot is escaped
 * rather than left as the any-character it would otherwise be.
 */
const PLANS_SYMBOLS = [
  "loadPlans",
  "resolvePlansPath",
  "pickPlanAsOf",
  "listPlansAsOf",
  "plans\\.jsonl",
];

const SYMBOL_RE = new RegExp(`\\b(?:${PLANS_SYMBOLS.join("|")})\\b`);

/** The shared repo walk, minus the two file kinds the header's second choice excludes. */
function productionSources(dir: string): string[] {
  return sourceFiles({ dir, as: "absolute", extensions: GUARD_SOURCE_EXTENSIONS }).filter(
    (file) => !file.includes(".test.") && !file.includes(".fixtures."),
  );
}

/** Strip comments before scanning — see the header's second recorded choice. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function namesPlansSymbol(file: string): boolean {
  return SYMBOL_RE.test(stripComments(readFileSync(file, "utf-8")));
}

describe("blast radius: the plans sidecar is confined to the push path", () => {
  it("no apps/web source file outside src/push/ names a plans symbol", () => {
    const scanned = productionSources(SRC_DIR).filter(
      (file) => !file.startsWith(`${ALLOWED_DIR}${sep}`),
    );
    // False-pass guard: an empty or mis-resolved file list makes the assertion below
    // vacuous, the failure mode every source scan is prone to.
    expect(scanned.length).toBeGreaterThan(3);

    const offenders = scanned.filter(namesPlansSymbol).map((file) => relative(SRC_DIR, file));
    expect(
      offenders,
      `These files name the plans sidecar outside src/push/, which would put an ` +
        `as-of plan selection — or a disk read of the sidecar — within reach of a ` +
        `render surface. The wire carries the narrowed DCA branch; read that ` +
        `instead:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("guards a tree where the symbols actually appear (assertion has teeth)", () => {
    // GREATER THAN ZERO, NOT ALL FIVE, and that is deliberate. `push/dca-block.ts`
    // imports `listPlansAsOf`, which is what gives this guard teeth from slice 1 on;
    // `loadPlans` and `resolvePlansPath` reach push source only with the cutover's
    // wiring, and the `plans.jsonl` literal may NEVER appear there at all — resolving
    // that filename is precisely `resolvePlansPath`'s job. Do not "strengthen" this
    // into a demand for every symbol: it would be a permanent red.
    const namers = productionSources(ALLOWED_DIR).filter(namesPlansSymbol);
    expect(namers.length).toBeGreaterThan(0);
  });
});
