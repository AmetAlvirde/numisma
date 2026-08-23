import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * THE SCANNING CHANNEL, ON THE WORKBENCH SIDE (spec #412 §5, Seam D).
 *
 * The workbench compiles its OWN stylesheet from the same package source, and
 * `@source "../node_modules/@numisma/components/src"` in its `tailwind.css` is
 * the only thing that makes Tailwind read the package's class strings.
 * `source(none)` on the barrel import disables implicit scanning, so without
 * that line the package is not scanned at all AND THE BUILD STILL EXITS 0 —
 * the same silent failure `apps/web/src/tailwind-scan.test.ts` stands against
 * on the app's side, stated in the workbench entry's own header and, until
 * this file, held by nothing here. `fixture-coverage.test.ts` reads source
 * text and never builds a stylesheet.
 *
 * WHY IT IS WORTH A TEST WHEN THE FAILURE IS LOUD TO A HUMAN. Fixtures render
 * unstyled the moment you open the page, so nobody ships an unscanned
 * workbench for long. But the workbench is what the manual theming procedure
 * in `docs/component-package.md` runs against, and a silently unscanned
 * workbench makes that procedure report on the wrong artifact — a reviewer
 * judging tokens on a page that never got the utilities.
 *
 * A SIBLING, NOT A DUPLICATE, of the app's test. Two consumers, two Tailwind
 * entries, two `@source` blocks, and deleting either one is invisible to the
 * other's build. The whole point of the second consumer is that its build is
 * independent; a guard shared with the app would collapse them back together.
 *
 * WHAT THIS TEST DOES NOT PROVE: that the token behind the utility has a
 * VALUE. Scanning and theming are separate channels — the class asserted below
 * passes its `var(--nms-radius-md)` through literally and ships looking correct
 * whether or not anything ever defines that property. `app-token-drift.test.ts`
 * holds the theming half.
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const PACKAGE_BUTTON = join(SRC, "../../../packages/components/src/ui/button.tsx");

/**
 * A class only `button.tsx` writes — ASSEMBLED FROM TWO HALVES ON PURPOSE.
 * `@source "./"` scans this directory, this test file included, and Tailwind
 * extracts candidates from any text it finds. Spelling the class out here would
 * put it in the WORKBENCH's own scanned surface, so the utility would be
 * emitted from this very file with the package `@source` line deleted: the test
 * would pass its own assertion and prove nothing. Neither half alone is a valid
 * candidate.
 */
const PACKAGE_ONLY_CLASS = "rounded-[min(var(--nms-radius" + "-md),8px)]";

/** Every `.css` file under a directory, recursively. */
function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return cssFiles(path);
    return entry.endsWith(".css") ? [path] : [];
  });
}

/** Every file under a directory, recursively — the shape `@source "./"` sees. */
function allFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? allFiles(path) : [path];
  });
}

let outDir = "";
let builtCss = "";

describe("the workbench stylesheet scans the component package", () => {
  beforeAll(async () => {
    outDir = mkdtempSync(join(tmpdir(), "nms-workbench-scan-"));
    // Vite with the Tailwind plugin alone over the one CSS entry — the same
    // compilation path and the same `@source` resolution react-cosmos gets,
    // without dragging the Cosmos renderer in to answer a question about CSS.
    await build({
      root: SRC,
      configFile: false,
      logLevel: "warn",
      plugins: [tailwindcss()],
      build: {
        outDir,
        emptyOutDir: true,
        cssMinify: false,
        rollupOptions: { input: join(SRC, "tailwind.css") },
      },
    });
    builtCss = cssFiles(outDir)
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
  });

  afterAll(() => {
    if (outDir) rmSync(outDir, { recursive: true, force: true });
  });

  it("produces a stylesheet at all", () => {
    // Guards the guard. A build that emitted nothing is a different defect from
    // an unscanned package and must not be reported as one.
    expect(builtCss.length).toBeGreaterThan(1_000);
  });

  it("emits the selector for the package's arbitrary-radius utility", () => {
    // The one assertion this file exists for. Deleting the package `@source`
    // line from the workbench's `tailwind.css` turns this red while the build
    // still exits 0. Escapes are stripped before comparing: how Tailwind
    // escapes `[`, `(` and `,` is its business, not this contract's.
    expect(builtCss.replaceAll("\\", "")).toContain(`.${PACKAGE_ONLY_CLASS}`);
  });

  it("takes that class from the package and from nowhere the workbench scans", () => {
    // The instrument is only an instrument while nothing else scanned produces
    // it. Both halves are load-bearing: the class has to be IN the package, and
    // OUT of everything `@source "./"` reaches.
    expect(readFileSync(PACKAGE_BUTTON, "utf8")).toContain(PACKAGE_ONLY_CLASS);
    const workbenchWriters = allFiles(SRC).filter((path) =>
      readFileSync(path, "utf8").includes(PACKAGE_ONLY_CLASS),
    );
    expect(workbenchWriters).toEqual([]);
  });
});
