import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * THE SCANNING CHANNEL (spec #412 §3, first silent failure; Seam E).
 *
 * `@source "../node_modules/@numisma/components/src"` in `tailwind.css` is the
 * only thing that makes Tailwind read the component package's class strings.
 * `source(none)` on the `utilities.css` import disables implicit scanning, so
 * without that line the package is not scanned at all — AND THE BUILD STILL
 * EXITS 0 WITH NO WARNING. Measured in the spike: deleting only that line took
 * the built stylesheet from 17,160 bytes to 5,690, with `13px`, `08em`,
 * `button-group` and `bg-primary` all falling to zero occurrences; restoring it
 * reproduced a byte-identical file. Nothing in the build log distinguishes the
 * two runs. A PASSING BUILD IS NOT EVIDENCE THAT SCANNING HAPPENED. This test
 * is, and it is the only thing in the suite that is.
 *
 * WHAT THIS TEST DOES NOT PROVE, and must not be read as proving: that the
 * token behind the utility has a VALUE. Scanning and theming are two different
 * channels, and conflating them is the mistake this file exists to prevent. The
 * selector asserted below emits from the scanned candidate string alone — its
 * `var(--nms-radius-md)` is passed through literally — so this rule ships
 * looking correct whether or not any consumer ever defines that property. The
 * theming channel is held by `nms-tokens.test.ts` at the text level and by the
 * documented browser computed-style procedure at the value level. Neither
 * substitutes for the other, and a green here says nothing about either.
 *
 * WHY THIS CLASS AND NOT `bg-primary`. The instrument has to be a utility no
 * OTHER scanned file can produce, and `bg-primary` fails that: it is written
 * out in `tailwind.css`'s own prose, which `@source "./"` scans, so it survives
 * the negative control with the package unscanned. The class below is an
 * arbitrary value with no default-theme entry, written in exactly one place in
 * the repo — `packages/components/src/ui/button.tsx` — so its selector is in
 * the output if and only if the package was scanned.
 *
 * WHY IT BUILDS ONLY THE STYLESHEET. The full `apps/web` production build drags
 * in TanStack Start, Nitro and React to answer a question about one CSS entry.
 * This runs Vite with the Tailwind plugin alone over `tailwind.css` — the same
 * compilation path with the same `@source` resolution — and costs about 100 ms.
 * NO BYTE COUNT AND NO BUILD HASH IS PINNED: both are content-derived and move
 * whenever either stylesheet changes.
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const PACKAGE_BUTTON = join(SRC, "../../../packages/components/src/ui/button.tsx");

/**
 * A class only `button.tsx` writes — ASSEMBLED FROM TWO HALVES ON PURPOSE.
 * `@source "./"` scans this directory, this test file included, and Tailwind
 * extracts candidates from any text it finds. Spelling the class out here would
 * put it in the APP's scanned surface, so the utility would be emitted from
 * this very file with the package `@source` line deleted: the test would pass
 * its own assertion and prove nothing. Verified — with the literal whole, the
 * negative control stays green. Neither half alone is a valid candidate.
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

describe("the built stylesheet scans the component package", () => {
  beforeAll(async () => {
    outDir = mkdtempSync(join(tmpdir(), "nms-tailwind-scan-"));
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
    // Guards the guard. A build that emitted nothing, or an empty file, is a
    // different defect from an unscanned package and should not be reported as
    // one — and an empty string would fail the assertion below for the wrong
    // reason.
    expect(builtCss.length).toBeGreaterThan(1_000);
  });

  it("emits the selector for the package's arbitrary-radius utility", () => {
    // The one assertion this file exists for. Deleting the package `@source`
    // line from `tailwind.css` turns this red while the build still exits 0.
    // Escapes are stripped before comparing: how Tailwind escapes `[`, `(` and
    // `,` in a selector is its business, not this contract's.
    expect(builtCss.replaceAll("\\", "")).toContain(`.${PACKAGE_ONLY_CLASS}`);
  });

  it("takes that class from the package and from nowhere the app scans", () => {
    // The instrument is only an instrument while nothing else scanned produces
    // it. Both halves are load-bearing: the class has to be IN the package (or
    // the assertion above pins a utility the package stopped writing) and OUT
    // of everything `@source "./"` reaches (or the app disarms the guard on its
    // own, the way `bg-primary` does).
    expect(readFileSync(PACKAGE_BUTTON, "utf8")).toContain(PACKAGE_ONLY_CLASS);
    const appWriters = allFiles(SRC).filter((path) =>
      readFileSync(path, "utf8").includes(PACKAGE_ONLY_CLASS),
    );
    expect(appWriters).toEqual([]);
  });
});
