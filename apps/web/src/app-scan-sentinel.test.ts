import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * THE APP-SIDE SCANNING CHANNEL (spec #420 §4 Seam D, §5 S0.1).
 *
 * `tailwind-scan.test.ts` beside this file proves that `@source
 * "../node_modules/@numisma/components/src"` is alive — that the PACKAGE gets
 * scanned. Nothing proved the other `@source` line. `@source "./"` is what makes
 * Tailwind read the class strings `apps/web` itself writes, and it fails exactly
 * as silently: delete it and every utility the app authors vanishes from the
 * built stylesheet WITH THE BUILD STILL EXITING 0. The whole `styles.css`
 * teardown is nine slices of moving declarations out of hand-written rules and
 * into app-authored utilities, so from slice 1 onward that line is load-bearing
 * on every surface. This test is the only thing that watches it.
 *
 * THE SENTINEL IS THE ARBITRARY-VALUE 320px MIN-WIDTH UTILITY ON `<body>` IN
 * `__root.tsx` — assembled below rather than spelled out here, and THAT
 * INCLUDES THIS PROSE, because Tailwind extracts candidates from comment text
 * as readily as from JSX. IT IS PARITY-NEUTRAL BY CONSTRUCTION. While `styles.css`'s own `body` rule still
 * stands, that file is unlayered and Tailwind's output sits in
 * `layer(utilities)`, so the hand-written 320px floor wins and this declaration
 * is a duplicate that moves no pixel. Slice 2 deletes that rule and the sentinel
 * becomes the real floor — the most load-bearing declaration in the file.
 * Choosing it now means the guard watches something that will matter rather than
 * a decoration nobody would miss.
 *
 * WHAT THIS TEST DOES NOT PROVE, and must not be read as proving: that any token
 * resolves. A PASSING BUILD IS NOT EVIDENCE OF SCANNING — that is what this
 * asserts — and A SCANNED CLASS IS NOT EVIDENCE IT COMPUTED. The sentinel emits from the candidate string alone; it would ship looking correct with the
 * whole palette missing. Theming is the other channel: `nms-tokens.test.ts` at
 * the text level, the per-slice Chrome checklist at the value level. Neither
 * substitutes for the other, and a green here says nothing about either.
 *
 * WHY IT BUILDS ONLY THE STYLESHEET: the same reason the package guard does. The
 * full TanStack Start / Nitro build drags in a router and React to answer a
 * question about one CSS entry; Vite with the Tailwind plugin alone over
 * `tailwind.css` is the same compilation path with the same `@source`
 * resolution. No byte count and no build hash is pinned — both are
 * content-derived and move whenever either stylesheet changes.
 */

const THIS_FILE = fileURLToPath(import.meta.url);
const SRC = dirname(THIS_FILE);
const ROOT_ROUTE = join(SRC, "routes", "__root.tsx");

/**
 * The sentinel class — ASSEMBLED FROM TWO HALVES ON PURPOSE, exactly as the
 * package guard assembles its own.
 *
 * `@source "./"` scans this directory, and that includes this test file.
 * Tailwind extracts candidates from any text it finds, so spelling the class out
 * here would put it in the app's scanned surface: the utility would then be
 * emitted FROM THIS VERY FILE with `@source "./"` deleted, and the test would
 * pass its own assertion while proving nothing. Neither half alone is a valid
 * candidate.
 */
const SENTINEL_CLASS = "min-w-[320" + "px]";

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

/** A test file, by this repo's one naming convention. */
const isTestFile = (path: string): boolean =>
  /\.test\.[cm]?[jt]sx?$/.test(basename(path));

let outDir = "";
let builtCss = "";

describe("the built stylesheet scans the app's own source", () => {
  beforeAll(async () => {
    outDir = mkdtempSync(join(tmpdir(), "nms-app-scan-sentinel-"));
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
    // an unscanned app tree and must not be reported as one.
    expect(builtCss.length).toBeGreaterThan(1_000);
  });

  it("emits the selector for the sentinel utility", () => {
    // The one assertion this file exists for. Removing `@source "./"` from
    // `tailwind.css` turns this red while the build still exits 0. Escapes are
    // stripped before comparing: how Tailwind escapes `[` and `]` in a selector
    // is its business, not this contract's.
    expect(builtCss.replaceAll("\\", "")).toContain(`.${SENTINEL_CLASS}`);
  });

  it("takes that class from exactly one non-test file, the root route", () => {
    // The instrument is only an instrument while ONE app file supplies it. Two
    // writers and a deletion in the wrong one leaves the guard green over a
    // surface that lost its sentinel; zero writers and the assertion above is
    // pinning a class nobody renders.
    const writers = allFiles(SRC)
      .filter((path) => !isTestFile(path))
      .filter((path) => readFileSync(path, "utf8").includes(SENTINEL_CLASS));
    expect(writers).toEqual([ROOT_ROUTE]);
  });

  it("is not written by this test file, which would disarm the guard", () => {
    // The halves above, asserted rather than trusted. A later edit that spells
    // the class out — a refactor, a copied line, a helpful constant — would make
    // the emission assertion self-satisfying and silently retire the guard.
    expect(readFileSync(THIS_FILE, "utf8")).not.toContain(SENTINEL_CLASS);
  });
});
