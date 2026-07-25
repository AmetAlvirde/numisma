/**
 * Blast-radius guard (PRD #134 R4). Slice 2 gave `apps/web` a dependency on
 * `@numisma/event-store` — the read path over the PRIVATE durable log, the whole
 * event history, everything the fund ever did. The push needs it; nothing else in
 * the web app does. Today's other tests guard the *payload* (`toProjectionReport`
 * narrows to `{ totals, dashboard }`, and the client-bundle test scans the built
 * browser assets), but nothing would stop a route or a render surface importing
 * the log reader directly and shipping the full event log to a browser.
 *
 * So: no source file in `apps/web` outside `apps/web/src/push/` may import
 * `@numisma/event-store`. The precedent is the client-bundle credential-literal
 * guard (`client-bundle.integration.test.ts`) — same shape of structural
 * assertion. UNLIKE that one, this reads the SOURCE TREE rather than a build
 * output, so it needs no build and MUST NOT self-skip: it runs on every
 * `pnpm test`, on every machine.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
/** The web app's source root — this file lives at its top level. */
const SRC_DIR = resolve(HERE);
/** The ONE directory allowed to read the durable log. */
const ALLOWED_DIR = join(SRC_DIR, "push");

const PACKAGE = "@numisma/event-store";
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
 * ANY SUBPATH counts, not just the bare package name. `@numisma/event-store` now
 * also exports `./testkit`, and a guard that only matched the root entry would let
 * `@numisma/event-store/testkit` — or any subpath added later — walk straight past
 * a confinement rule that is about the DEPENDENCY, not about one entry point.
 */
const IMPORT_RE = new RegExp(
  `(?:\\bfrom|\\bimport|\\brequire\\s*\\(|\\bimport\\s*\\()\\s*["']${PACKAGE.replace("/", "\\/")}(?:\\/[^"']*)?["']`,
);

function importsEventStore(file: string): boolean {
  return IMPORT_RE.test(readFileSync(file, "utf-8"));
}

describe("blast radius: @numisma/event-store is confined to the push path", () => {
  it("no apps/web source file outside src/push/ imports the durable-log reader", () => {
    const offenders = sourceFiles(SRC_DIR)
      .filter((file) => !file.startsWith(`${ALLOWED_DIR}${sep}`))
      .filter(importsEventStore)
      .map((file) => relative(SRC_DIR, file));

    expect(
      offenders,
      `These files import ${PACKAGE} outside src/push/, which would put the entire ` +
        `private event log within reach of a render surface:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("guards a tree where the import actually occurs (assertion has teeth)", () => {
    // Guard against a false pass: if the push path stopped importing the reader
    // (or the scan stopped matching import syntax), the check above would pass
    // vacuously while proving nothing.
    const importers = sourceFiles(ALLOWED_DIR).filter(importsEventStore);
    expect(importers.length).toBeGreaterThan(0);
  });
});
