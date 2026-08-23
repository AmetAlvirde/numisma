import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * SEAM D, HELD AS A TEST (spec #412 §5).
 *
 * The workbench's whole value is that it is a SECOND CONSUMER WITH NO SSR. A
 * class that renders here and fails in `apps/web` isolates the fault to the
 * client/SSR split — and that inference is only sound while the two apps share
 * nothing but the package. One import from `apps/web` and the workbench stops
 * being an independent instrument and becomes a mirror of the thing it is
 * meant to be measuring against.
 *
 * IF THE WORKBENCH EVER SEEMS TO NEED SOMETHING FROM `apps/web`, THE SEAM HAS
 * LEAKED. That is the signal to stop and move the thing into the package, not
 * to add the import. This test is what makes that a decision someone has to
 * take deliberately rather than a line that slides in during a hurry.
 *
 * READING A FILE IS NOT IMPORTING A MODULE. `app-token-drift.test.ts` reads the
 * TEXT of `apps/web/src/styles.css` from disk, on purpose — that is the drift
 * check, and it puts nothing from the app into the workbench's module graph or
 * its bundle. So this test looks at IMPORT SPECIFIERS ONLY. A grep for the
 * string `apps/web` would flag the drift test and the prose in this very file,
 * which is how a guard gets deleted for crying wolf.
 *
 * THE OTHER DIRECTION IS ALSO ASSERTED, and for a different reason: `apps/web`
 * must not reach INTO the workbench either, or the workbench would land in the
 * app's production bundle. Nothing in the app has any business importing a
 * fixture, and the day one does the app ships react-cosmos to users.
 */

const WORKBENCH_SRC = dirname(fileURLToPath(import.meta.url));
const WORKBENCH_ROOT = resolve(WORKBENCH_SRC, "..");
const APPS = resolve(WORKBENCH_ROOT, "..");
const WEB_ROOT = join(APPS, "web");

/** Every file under a directory, recursively, skipping installed packages. */
function allFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (entry === "node_modules" || entry.startsWith(".")) return [];
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? allFiles(path) : [path];
  });
}

/** Source files whose import specifiers are worth reading. */
function sourceFiles(root: string): string[] {
  return allFiles(root).filter((path) => /\.(m?[jt]sx?)$/.test(path));
}

/**
 * Every module specifier a file imports: static `from "…"`, bare side-effect
 * `import "…"`, dynamic `import("…")` and `require("…")`.
 */
function importSpecifiers(text: string): string[] {
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  return patterns.flatMap((pattern) => [...text.matchAll(pattern)].map((m) => m[1]!));
}

/** Where a specifier lands on disk, for the relative forms that have an answer. */
function resolvedTarget(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  return resolve(dirname(fromFile), specifier);
}

/** Each offending import, formatted so the failure is the whole diagnosis. */
function crossings(from: string, into: string, bareNames: string[]): string[] {
  return sourceFiles(from).flatMap((file) =>
    importSpecifiers(readFileSync(file, "utf8"))
      .filter((specifier) => {
        if (bareNames.includes(specifier.split("/").slice(0, 2).join("/")))
          return true;
        if (bareNames.includes(specifier)) return true;
        const target = resolvedTarget(file, specifier);
        return target !== null && (target === into || target.startsWith(`${into}/`));
      })
      .map(
        (specifier) =>
          `${relative(from, file)} imports "${specifier}"`,
      ),
  );
}

describe("the workbench is independent of apps/web", () => {
  it("imports no module from apps/web", () => {
    expect(crossings(WORKBENCH_ROOT, WEB_ROOT, ["@numisma/web"])).toEqual([]);
  });

  it("declares no dependency on the web app", () => {
    const manifest: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } =
      JSON.parse(readFileSync(join(WORKBENCH_ROOT, "package.json"), "utf8"));
    const declared = Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
    });
    expect(declared).not.toContain("@numisma/web");
  });
});

describe("the workbench adds nothing to the apps/web bundle", () => {
  it("is imported by no module in apps/web", () => {
    expect(crossings(WEB_ROOT, WORKBENCH_ROOT, ["@numisma/workbench"])).toEqual(
      [],
    );
  });

  it("is not a dependency of @numisma/web", () => {
    const manifest: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } =
      JSON.parse(readFileSync(join(WEB_ROOT, "package.json"), "utf8"));
    const declared = Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
    });
    expect(declared).not.toContain("@numisma/workbench");
  });

  it("keeps react-cosmos out of the app's dependency list entirely", () => {
    // The workbench's reason to exist is that its build has no SSR in it. The
    // mirror of that: the app's build has no cosmos in it. A shared devDep
    // would be the first step back toward one app doing both jobs.
    const manifest = readFileSync(join(WEB_ROOT, "package.json"), "utf8");
    expect(manifest).not.toContain("react-cosmos");
  });
});
