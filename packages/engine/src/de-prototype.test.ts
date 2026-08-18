// R1 regression lock (ADR-003 amendments): reliable-tier engine + TUI code must not
// ship literally labelled with a prototype marker. Walks the source trees and asserts
// no marker SHAPE survives — not an enumerated list of increments someone remembered
// to add, but the forms a prototype marker takes: the `PROTOTYPE (mvi <slug>)` header
// stamp for ANY increment slug or date, the bare `MVI PROTOTYPE` label, and the
// `Dev/tmp/mvi-*` scratch-worktree handoff path. A new prototype dated years from now
// is caught by the same three needles. Each needle is built from fragments so this
// guard file never matches itself (and the scan also skips this file by name).
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, sourceFiles } from "../../../ops/testkit/repo-sources.testkit.js";

const SRC_DIR = join(REPO_ROOT, "packages", "engine", "src");
// Also scan the TUI app's source: a realized-P&L prototype demo lived there
// (apps/tui/src), so the marker could reach main via either package.
const TUI_SRC_DIR = join(REPO_ROOT, "apps", "tui", "src");
// And the price-feed app: the crypto price tracer (#106) was prototyped there
// (apps/price-feed/src) before its reliable conversion, so its markers must be
// stripped too (R7).
const PRICE_FEED_SRC_DIR = join(REPO_ROOT, "apps", "price-feed", "src");
const SCAN_DIRS = [SRC_DIR, TUI_SRC_DIR, PRICE_FEED_SRC_DIR];
// Needles assembled from fragments so this guard file never matches itself.
const MARKERS = [
  // The header stamp, for ANY increment: `PROTOTYPE (mvi 2026-06-29-portfolio-...)`.
  "PROTOTYPE" + " (mvi ",
  // The bare label used by the price-fetch prototype (#106 / R7)...
  "MVI " + "PROTOTYPE",
  // ...and any scratch-worktree handoff path left pointing at a prototype tree.
  "Dev/tmp/" + "mvi-",
];
const SELF = "de-prototype.test.ts";

/*
 * The listing comes from the shared gitignore-aware walker rather than a raw
 * recursive `readdirSync`, so nothing git ignores — build output, vendored trees,
 * an agent worktree checked out under the scanned roots — can enter the scan and
 * turn a stale copy of a stripped file into a false red. The walker yields `.ts`
 * and `.tsx`; this guard keeps its own narrowing to `.ts`, and its own exclusion of
 * this very file by name, both unchanged.
 */
function tsFiles(dir: string): string[] {
  return sourceFiles({ dir, as: "absolute" }).filter(
    (file) => file.endsWith(".ts") && basename(file) !== SELF,
  );
}

describe("de-prototype: prototype markers are stripped from engine + TUI source", () => {
  const files = SCAN_DIRS.flatMap(tsFiles);

  // FALSE-PASS FLOOR. Every assertion below is "no offender found", which is also
  // exactly what an empty scan produces. `repoRelativeDir` now throws on a scan
  // root that does not exist, so a renamed directory is loud — but a root that
  // exists and yields nothing (a walker regression, an extension filter that stops
  // matching) would still turn all three guards green while guarding zero files.
  // The sibling converted guards (orders-stay-off-the-wire, suppression-seam,
  // rung-state-seam) already assert this floor; it belongs here too.
  it("scans a non-empty set, so a green above means checked rather than skipped", () => {
    expect(files.length).toBeGreaterThan(0);
    // Per-root, not just in aggregate: one silently-empty root would otherwise
    // hide behind the other two.
    for (const dir of SCAN_DIRS) {
      expect(tsFiles(dir), `no .ts sources scanned under ${dir}`).not.toEqual([]);
    }
  });

  for (const marker of MARKERS) {
    it(`leaves no "${marker}" prototype marker anywhere under engine/src or tui/src`, () => {
      const offenders = files.filter((file) => readFileSync(file, "utf8").includes(marker));
      expect(offenders, `prototype marker "${marker}" still present in:\n${offenders.join("\n")}`).toEqual([]);
    });
  }
});
