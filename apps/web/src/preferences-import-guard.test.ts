/**
 * Blast-radius guard (PRD #146, slice #147). This slice gives `apps/web` a dependency
 * on `@numisma/preferences` — the IO shell over accumulus's append-only
 * `preferences.jsonl` sidecar. Slice #148's push needs it to stamp the Reserve FLOOR
 * onto each anchor; nothing else in the web app does.
 *
 * The confinement is the same one the durable-log reader lives under, for the same
 * reason: the push is a privileged reader, a render surface is not. A route that
 * imported the sidecar reader directly would be reading a file off the machine's disk
 * from a render path, and would be positioned to fall back to
 * `seedDefaultPreferences`'s `10` on a read gap — the exact number V2/R1 forbid
 * inventing.
 *
 * So: no source file in `apps/web` outside `apps/web/src/push/` may import
 * `@numisma/preferences`. Direct sibling: `event-store-import-guard.test.ts`, whose
 * shape this follows deliberately (walk the SOURCE TREE, not a build output, so it
 * needs no build and MUST NOT self-skip — it runs on every `pnpm test`, on every
 * machine).
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
/** The web app's source root — this file lives at its top level. */
const SRC_DIR = resolve(HERE);
/** The ONE directory allowed to read the preferences sidecar. */
const ALLOWED_DIR = join(SRC_DIR, "push");

const PACKAGE = "@numisma/preferences";
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"];

/** Every file under `dir`, recursively (skipping build/dependency output). */
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) return [];
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function sourceFiles(dir: string): string[] {
  return walk(dir).filter((file) =>
    SOURCE_EXTENSIONS.some((ext) => file.endsWith(ext)),
  );
}

/**
 * Does this file name the package in an IMPORT POSITION? Matched by syntax
 * (`from "…"`, `import "…"`, `import("…")`, `require("…")`) rather than by bare
 * substring, so a file that merely mentions the name in prose or in a constant —
 * this guard itself, for one — is not a false positive.
 *
 * ANY SUBPATH counts, not just the bare package name. `@numisma/preferences` ships a
 * single `exports["."]` entry today, but a guard that only matched the root entry
 * would let a subpath added later walk straight past a confinement rule that is about
 * the DEPENDENCY, not about one entry point.
 */
const IMPORT_RE = new RegExp(
  `(?:\\bfrom|\\bimport|\\brequire\\s*\\(|\\bimport\\s*\\()\\s*["']${PACKAGE.replace("/", "\\/")}(?:\\/[^"']*)?["']`,
);

function importsPreferences(file: string): boolean {
  return IMPORT_RE.test(readFileSync(file, "utf-8"));
}

describe("blast radius: @numisma/preferences is confined to the push path", () => {
  it("no apps/web source file outside src/push/ imports the sidecar reader", () => {
    const offenders = sourceFiles(SRC_DIR)
      .filter((file) => !file.startsWith(`${ALLOWED_DIR}${sep}`))
      .filter(importsPreferences)
      .map((file) => relative(SRC_DIR, file));

    expect(
      offenders,
      `These files import ${PACKAGE} outside src/push/, which would put a disk read ` +
        `of the preferences sidecar within reach of a render surface:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  // SKIPPED UNTIL #148. The teeth assertion below is the exact counterpart of
  // event-store-import-guard.test.ts's second case, and it is written now rather than
  // deferred so the guard's vacuity is a KNOWN, NAMED gap instead of an invisible one.
  // It cannot pass in slice #147: this slice only makes reading the sidecar from
  // `apps/web` POSSIBLE — the dependency is declared and the confinement is enforced,
  // but nothing under `push/` reads it until slice #148 stamps `reserveTargetPct` onto
  // the glance block. Faking an import to turn this green would defeat the purpose of
  // the check. #148 un-skips this line; nothing else about it should need to change.
  it.skip("guards a tree where the import actually occurs (assertion has teeth) — un-skip in #148", () => {
    // Guard against a false pass: if the push path stopped importing the reader
    // (or the scan stopped matching import syntax), the check above would pass
    // vacuously while proving nothing.
    const importers = sourceFiles(ALLOWED_DIR).filter(importsPreferences);
    expect(importers.length).toBeGreaterThan(0);
  });
});
