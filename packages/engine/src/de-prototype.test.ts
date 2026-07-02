// R1 regression lock (ADR-003 realized-P&L amendment): reliable-tier engine code
// must not ship literally labelled with the realized-P&L prototype marker. Walks the
// engine source tree and asserts the marker is gone. The needle is built from
// fragments so this guard file never matches itself.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
// Also scan the sibling TUI package's source: a realized-P&L prototype demo lived
// there (packages/tui/src), so the marker could reach main via either package.
const TUI_SRC_DIR = join(SRC_DIR, "..", "..", "tui", "src");
const SCAN_DIRS = [SRC_DIR, TUI_SRC_DIR];
const MARKER = "2026-07-01" + "-realized-pnl";
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

describe("de-prototype: realized-P&L marker is stripped from engine + TUI source", () => {
  it("leaves no realized-P&L prototype marker anywhere under engine/src or tui/src", () => {
    const offenders = SCAN_DIRS.flatMap(tsFiles).filter((file) =>
      readFileSync(file, "utf8").includes(MARKER),
    );
    expect(offenders).toEqual([]);
  });
});
