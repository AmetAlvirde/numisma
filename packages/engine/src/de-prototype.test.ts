// R1 regression lock (ADR-003 amendments): reliable-tier engine + TUI code must not
// ship literally labelled with a prototype marker. Walks the source trees and asserts
// the markers are gone — both the realized-P&L prototype (#90) and the
// partial-close/profit-split prototype (#96). Each needle is built from fragments so
// this guard file never matches itself (and the scan also skips this file by name).
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
// Also scan the TUI app's source: a realized-P&L prototype demo lived there
// (apps/tui/src), so the marker could reach main via either package.
const TUI_SRC_DIR = join(SRC_DIR, "..", "..", "..", "apps", "tui", "src");
// And the price-feed app: the crypto price tracer (#106) was prototyped there
// (apps/price-feed/src) before its reliable conversion, so its markers must be
// stripped too (R7).
const PRICE_FEED_SRC_DIR = join(SRC_DIR, "..", "..", "..", "apps", "price-feed", "src");
const SCAN_DIRS = [SRC_DIR, TUI_SRC_DIR, PRICE_FEED_SRC_DIR];
// Needles assembled from fragments so this guard file never matches itself.
const MARKERS = [
  "2026-07-01" + "-realized-pnl",
  "PROTOTYPE (mvi " + "2026-07-02" + "-partial-close-profit-split)",
  // The crypto price-fetch prototype marker + its tmp-path handoff (#106 / R7).
  "MVI " + "PROTOTYPE",
  "Dev/tmp/mvi-numisma-" + "2026-07-03" + "-price-fetch-prototype",
];
const SELF = "de-prototype.test.ts";

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...tsFiles(full));
    } else if (entry.name.endsWith(".ts") && entry.name !== SELF) {
      out.push(full);
    }
  }
  return out;
}

describe("de-prototype: prototype markers are stripped from engine + TUI source", () => {
  const files = SCAN_DIRS.flatMap(tsFiles);
  for (const marker of MARKERS) {
    it(`leaves no "${marker}" prototype marker anywhere under engine/src or tui/src`, () => {
      const offenders = files.filter((file) => readFileSync(file, "utf8").includes(marker));
      expect(offenders).toEqual([]);
    });
  }
});
