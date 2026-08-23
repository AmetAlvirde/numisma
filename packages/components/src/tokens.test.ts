import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { NMS_PREFIX, NMS_TOKEN_NAMES, NMS_TOKENS } from "./tokens";

/**
 * THE PACKAGE SIDE OF THE TOKEN CONTRACT (Seam B), held here at the source-text
 * channel — the only channel this package has, since nothing consumes it yet
 * and neither of the two silent failures is visible from inside it.
 *
 * The contract runs in both directions. This file holds the direction the
 * package owes: it reads nothing outside the `--nms-` namespace, and every name
 * it reads is declared in `tokens.ts`. The other direction — every declared
 * token is DEFINED by every consumer — is a per-consumer test and belongs to
 * the slices that add consumers.
 *
 * NOT THE STANDING NAMESPACE GUARD. That one is a repo-level guard over the
 * whole package with a red that names the offending file, and it arrives with
 * the scripted add path it exists to police. This is narrower on purpose: it is
 * the claim THIS slice makes, that the token spec was read off component source
 * rather than pasted from an upstream theme.
 */

const SRC = fileURLToPath(new URL(".", import.meta.url));

/** Every `.ts`/`.tsx` file under `src`, tests excluded. */
function sourceFiles(dir: string = SRC): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (!/\.tsx?$/.test(entry)) return [];
    if (/\.test\.tsx?$/.test(entry)) return [];
    return [path];
  });
}

/**
 * Every custom property read in a file's text, BY EITHER OF TAILWIND 4'S TWO
 * SYNTAXES — `var(--muted)` and the shorthand `bg-(--muted)`, which compiles to
 * the same declaration and writes no `var(` anywhere in the source. Typed
 * shorthands (`w-(length:--sidebar-width)`) are the same form.
 *
 * Matching `var(` alone would let a hand edit or a merge put a bare read into
 * the package with this guard green — the capture bug the namespace exists to
 * close, reproduced through the syntax nobody checked. The ops-side twin is
 * `customPropertyReads` in `ops/components/rewrites.ts`; this file deliberately
 * does not import from `ops/`, and the two must agree about the syntax.
 */
function customPropertyReads(text: string): string[] {
  return [...text.matchAll(/var\(\s*(--[\w-]+)|-\((?:[\w-]+:)?(--[\w-]+)\)/g)].map(
    (match) => (match[1] ?? match[2])!,
  );
}

describe("the --nms-* token spec", () => {
  const files = sourceFiles();

  it("scans a package that actually has source in it", () => {
    // Guards the guard: an empty walk would make every assertion below pass
    // vacuously, which is exactly how a source-scan test fails toward green.
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((path) => path.endsWith("button.tsx"))).toBe(true);
  });

  it("declares no token outside its own namespace", () => {
    const stray = NMS_TOKEN_NAMES.filter((name) => !name.startsWith(NMS_PREFIX));
    expect(stray).toEqual([]);
  });

  it("gives every declared token a default", () => {
    const empty = NMS_TOKENS.filter((token) => token.value.trim() === "");
    expect(empty).toEqual([]);
  });

  it("declares each token exactly once", () => {
    expect([...new Set(NMS_TOKEN_NAMES)]).toEqual([...NMS_TOKEN_NAMES]);
  });

  it.each(files.map((path) => [path.slice(SRC.length), path] as const))(
    "reads only --nms- custom properties in %s",
    (_label, path) => {
      const stray = customPropertyReads(readFileSync(path, "utf8")).filter(
        (name) => !name.startsWith(NMS_PREFIX),
      );
      // A bare `var(--secondary)` is failure two: the rule ships looking
      // correct and computes to transparent against a consumer that never
      // defined it.
      expect(stray).toEqual([]);
    },
  );

  it.each(files.map((path) => [path.slice(SRC.length), path] as const))(
    "declares every custom property %s reads",
    (_label, path) => {
      const undeclared = customPropertyReads(readFileSync(path, "utf8")).filter(
        (name) => !NMS_TOKEN_NAMES.includes(name),
      );
      expect(undeclared).toEqual([]);
    },
  );

  it("declares nothing the components do not read", () => {
    // The spec is read OFF component source. A token pasted in from an upstream
    // theme — `--nms-card`, `--nms-popover` — is a name every consumer is asked
    // to define and nothing ever renders, so nothing can verify it.
    const text = files
      .filter((path) => !path.endsWith("tokens.ts"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    const unread = NMS_TOKEN_NAMES.filter((name) => {
      const role = name.slice(NMS_PREFIX.length);
      // Either read bare as `var(--nms-role)`, or reached through a Tailwind
      // theme utility naming the same role (`bg-primary`, `border-ring`).
      return !text.includes(name) && !new RegExp(`[-:\\[]${role}\\b`).test(text);
    });
    expect(unread).toEqual([]);
  });
});
