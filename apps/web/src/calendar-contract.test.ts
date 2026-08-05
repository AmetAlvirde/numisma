/**
 * Guards the ONE home of the `as-of` calendar arithmetic (`addDays`,
 * `daysBetween`) — the exact class of de-duplication ADR-001's *Realized* note
 * records for the shared formatters, and the same guard shape as
 * `apps/tui/src/format-contract.test.ts`.
 *
 * WHY A CONTRACT TEST AND NOT A CODE REVIEW. These eight lines had already been
 * copied once: `apps/web/src/projection/as-of.ts` held the validated, documented
 * pair and `apps/web/src/push/glance.ts` held a private, undocumented `addDays`
 * with the validation dropped. A package cannot import from an app, so the next
 * consumer would have written a THIRD copy. The single home is
 * `packages/engine/src/calendar.ts`; this test fails the moment a private copy
 * reappears ANYWHERE in the repo, which is what makes "zero private copies
 * repo-wide" a fact rather than a claim.
 *
 * The UTC-throughout docstring is asserted too, because it is load-bearing: the
 * defect it names (`new Date("2026-07-26")` renders in LOCAL time and lands west
 * of Greenwich on the previous day) is what would let a liveness detector call a
 * Monday a Sunday.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as engine from "@numisma/engine";
import * as calendar from "@numisma/engine/calendar";
import { describe, expect, it } from "vitest";

const SHARED_DATE_HELPERS = ["addDays", "daysBetween"] as const;

const HERE = dirname(fileURLToPath(import.meta.url));
// HERE = apps/web/src → the repo root is three levels up.
const REPO_ROOT = resolve(HERE, "../../..");
const SINGLE_HOME = "packages/engine/src/calendar.ts";

const SKIPPED_DIRS = new Set([
  "node_modules",
  ".git",
  ".vercel",
  ".output",
  ".nitro",
  "dist",
  "coverage",
]);

/** Every non-vendored TypeScript source in the repo, repo-root-relative. */
function typescriptSources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) {
        typescriptSources(join(dir, entry.name), found);
      }
    } else if (/\.tsx?$/.test(entry.name)) {
      found.push(relative(REPO_ROOT, join(dir, entry.name)));
    }
  }
  return found;
}

/** Files that DECLARE a helper of this name (a `function` or a `const` arrow). */
function declarersOf(name: string): string[] {
  const declaration = new RegExp(
    `(?:function\\s+${name}\\b|(?:const|let|var)\\s+${name}\\s*[:=][^=]*=>)`,
  );
  return typescriptSources(REPO_ROOT).filter((file) =>
    declaration.test(readFileSync(join(REPO_ROOT, file), "utf8")),
  );
}

const asOfSource = readFileSync(join(REPO_ROOT, "apps/web/src/projection/as-of.ts"), "utf8");
const glanceSource = readFileSync(join(REPO_ROOT, "apps/web/src/push/glance.ts"), "utf8");
const calendarSource = readFileSync(join(REPO_ROOT, SINGLE_HOME), "utf8");

/**
 * The names a module pulls out of any `@numisma/engine[...]` entry point. A
 * re-export (`export { addDays } from "@numisma/engine/calendar"`) counts — it is
 * an import that also forwards, which is exactly what `as-of.ts` does so the
 * projection's as-of vocabulary still reads as one module.
 */
function engineImports(source: string): string {
  return [
    ...source.matchAll(
      /(?:import|export)\s*\{([^}]*)\}\s*from\s*["']@numisma\/engine[^"']*["']/g,
    ),
  ]
    .map((match) => match[1])
    .join(",");
}

describe("as-of calendar arithmetic contract", () => {
  it("exports every shared date helper from @numisma/engine", () => {
    for (const name of SHARED_DATE_HELPERS) {
      expect(
        typeof (engine as Record<string, unknown>)[name],
        `@numisma/engine must export ${name}`,
      ).toBe("function");
    }
  });

  it("exports them from the browser-safe @numisma/engine/calendar subpath too", () => {
    // `as-of.ts` is reached from the BROWSER (glance/verdict.ts), so it cannot
    // value-import the engine root — that pulls `node:os`/`node:path` (data-dir)
    // into the client bundle. Same reason `@numisma/engine/format` exists.
    for (const name of SHARED_DATE_HELPERS) {
      expect(
        typeof (calendar as Record<string, unknown>)[name],
        `@numisma/engine/calendar must export ${name}`,
      ).toBe("function");
    }
  });

  it("is the same function through both entry points", () => {
    for (const name of SHARED_DATE_HELPERS) {
      expect((engine as Record<string, unknown>)[name]).toBe(
        (calendar as Record<string, unknown>)[name],
      );
    }
  });

  it("imports both helpers into the web projection's as-of module from the engine", () => {
    const imported = engineImports(asOfSource);
    for (const name of SHARED_DATE_HELPERS) {
      expect(
        new RegExp(`\\b${name}\\b`).test(imported),
        `as-of.ts must import ${name} from the engine`,
      ).toBe(true);
    }
  });

  it("imports addDays into the push glance module from the engine", () => {
    expect(
      /\baddDays\b/.test(engineImports(glanceSource)),
      "push/glance.ts must import addDays from the engine",
    ).toBe(true);
  });

  it("keeps ZERO private copies repo-wide — one declaring file, and it is the engine's", () => {
    for (const name of SHARED_DATE_HELPERS) {
      expect(declarersOf(name), `${name} must be declared once, in ${SINGLE_HOME}`).toEqual([
        SINGLE_HOME,
      ]);
    }
  });

  it("carries the UTC-throughout rationale over intact", () => {
    // The defect the docstring names is why the helper is UTC-only; losing the
    // note is how a future edit reintroduces a local-time `new Date(asOf)`.
    expect(calendarSource).toContain("LOCAL");
    expect(calendarSource).toMatch(/previous day/);
    expect(calendarSource).toMatch(/Monday a Sunday/);
  });

  it("keeps the validation both helpers were documented to have", () => {
    expect(() => calendar.addDays("not-a-date", 1)).toThrow(/addDays/);
    expect(() => calendar.daysBetween("2026-07-26", "not-a-date")).toThrow(/daysBetween/);
  });
});
