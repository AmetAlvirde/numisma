import { readFileSync } from "node:fs";
import * as engine from "@numisma/engine";
import { describe, expect, it } from "vitest";

// Guards the engine↔TUI formatter seam: the engine owns ONE exported source of
// truth for the shared formatters, and the TUI must consume them rather than
// keeping byte-identical private copies (which previously drifted unguarded and
// could silently break the cents-precision product constraint). This test fails
// if a private copy of a shared formatter reappears in dashboard.ts.

const SHARED_FORMATTERS = [
  "formatUsd",
  "formatMaybeUsd",
  "formatPrice",
  "formatSignedPercent",
  "formatPercent",
  "pad",
  "padLeft",
  "divider",
] as const;

// Legitimately TUI-only — no engine counterpart, so they stay defined here.
const TUI_ONLY_FORMATTERS = ["formatUsdCompact", "formatLoadTime"] as const;

const dashboardSource = readFileSync(
  new URL("./dashboard.ts", import.meta.url),
  "utf8",
);

const engineImport =
  /import\s*\{([^}]*)\}\s*from\s*["']@numisma\/engine["']/.exec(dashboardSource)?.[1] ??
  "";

describe("engine↔TUI formatter contract", () => {
  it("exports every shared formatter from @numisma/engine", () => {
    for (const name of SHARED_FORMATTERS) {
      expect(
        typeof (engine as Record<string, unknown>)[name],
        `@numisma/engine must export ${name}`,
      ).toBe("function");
    }
  });

  it("imports the shared formatters into the TUI from the engine root", () => {
    for (const name of SHARED_FORMATTERS) {
      expect(
        new RegExp(`\\b${name}\\b`).test(engineImport),
        `dashboard.ts must import ${name} from "@numisma/engine"`,
      ).toBe(true);
    }
  });

  it("keeps no private copy of a shared formatter in dashboard.ts", () => {
    for (const name of SHARED_FORMATTERS) {
      expect(
        new RegExp(`function\\s+${name}\\b`).test(dashboardSource),
        `dashboard.ts must not redefine ${name} — import it from the engine`,
      ).toBe(false);
    }
  });

  it("does not deep-import engine internals", () => {
    expect(/from\s*["']@numisma\/engine\/(?!index)/.test(dashboardSource)).toBe(
      false,
    );
  });

  it("retains the TUI-only formatters that have no engine counterpart", () => {
    for (const name of TUI_ONLY_FORMATTERS) {
      expect(
        new RegExp(`function\\s+${name}\\b`).test(dashboardSource),
        `dashboard.ts should still define TUI-only ${name}`,
      ).toBe(true);
    }
  });
});
