import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * THE 0.75rem TYPE FLOOR, AS A FROZEN CENSUS (spec #451 S7).
 *
 * The rule is written out over `STATE_BADGE` in `dca-card.tsx`: no shipped app surface
 * renders text below 0.75rem. It is a HOUSE rule and not a conformance one — WCAG 2.2 AA,
 * which ADR-026 adopts, sets no minimum font size — and the badge that started it was
 * failing on size while measuring 6.63:1 on contrast, so a ratio could never have caught
 * it.
 *
 * WHY A CENSUS AND NOT AN ALLOWLIST, WHICH IS THE ONLY REASON THIS FILE EXISTS. S7
 * declined to assert the floor because live type sizes already sit under it and lifting
 * the seven other components' worth of them is unbudgeted visible change; a list of the
 * survivors, it argued, is a suppression file. It is not. A suppression file says
 * "ignore these"; this says "there are exactly these", and the difference is what
 * happens on the NEXT literal: a suppression file stays green and this goes red. Lifting
 * one of the survivors only makes the census shorter, which is the direction the rule
 * wants and the one that cannot be reached by accident. The repo already runs the
 * pattern three times — `theme-color-utilities.test.ts`'s scanned-file floor, and the
 * two false-pass floors this same wave added to `started-ladder.fixtures.test.ts` and
 * `client-bundle.integration.test.ts` — and a rule that lives only as a number in a
 * docblock is a rule the next slice has to remember, which is the state §3 gate 3 argues
 * against for palettes and which applies here unchanged.
 *
 * WHAT IS NOT IN SCOPE. Lifting the survivors is a separate slice. This file freezes
 * them and says nothing about whether they should stay.
 *
 * TWO SPELLINGS, BECAUSE THE CHART DOES NOT SPEAK IN UTILITIES. `text-[0.72rem]` is the
 * Tailwind arbitrary value every card uses; `fontSize: 10` is an SVG label's inline
 * number, in px, and 10px is 0.625rem. A scan that read only the first spelling would
 * report the chart clean while it painted the two smallest strings in the package.
 */

const UI = dirname(fileURLToPath(import.meta.url));
const PACKAGE_SRC = join(UI, "..");

/** The floor, in rem, and the px root every browser here starts from. */
const FLOOR_REM = 0.75;
const ROOT_PX = 16;

/** One literal type size the package writes, wherever it wrote it. */
interface TypeSize {
  /** Path relative to the package's `src`, so a red names a component. */
  readonly file: string;
  /** The size in rem, whichever spelling it arrived in. */
  readonly rem: number;
  /** The text as authored, so a red can be grepped for. */
  readonly literal: string;
}

/** Every non-test source file the package ships. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (entry === "node_modules" || entry.startsWith(".")) return [];
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (/\.test\.tsx?$/.test(path)) return [];
    return /\.tsx?$/.test(path) ? [path] : [];
  });
}

/** Every type size in the package, in both spellings. */
function typeSizes(): TypeSize[] {
  const rem = /text-\[(\d*\.?\d+)rem\]/g;
  const px = /fontSize:\s*(\d*\.?\d+)\b/g;
  return sourceFiles(PACKAGE_SRC).flatMap((path) => {
    const source = readFileSync(path, "utf8");
    const file = relative(PACKAGE_SRC, path);
    return [
      ...[...source.matchAll(rem)].map(([literal, value]) => ({
        file,
        rem: Number(value),
        literal,
      })),
      ...[...source.matchAll(px)].map(([literal, value]) => ({
        file,
        rem: Number(value) / ROOT_PX,
        literal,
      })),
    ];
  });
}

/**
 * THE CENSUS. Every literal under the floor, verified site by site.
 *
 * NINE OCCURRENCES, WHICH THE REVIEW COUNTED AS EIGHT SITES: the chart's two SVG
 * labels are the same `fontSize: 10` on two axes and read as one decision, and this
 * list counts what the scan can see instead, which is occurrences.
 *
 * Each line is `file · literal · how many times that exact literal appears in it`. The
 * count is per literal rather than per line, so two identical sizes in one file are two
 * entries in one row and a third is a red.
 */
const CENSUS: readonly { file: string; literal: string; count: number }[] = [
  { file: "ui/absent.tsx", literal: "text-[0.72rem]", count: 1 },
  { file: "ui/fill-path.tsx", literal: "text-[0.65rem]", count: 1 },
  { file: "ui/fill-path.tsx", literal: "text-[0.68rem]", count: 1 },
  { file: "ui/fill-path.tsx", literal: "text-[0.7rem]", count: 2 },
  { file: "ui/fill-path.tsx", literal: "text-[0.72rem]", count: 1 },
  { file: "ui/price-drop-path-chart.tsx", literal: "text-[0.72rem]", count: 1 },
  { file: "ui/price-drop-path-chart.tsx", literal: "fontSize: 10", count: 2 },
];

describe("the 0.75rem type floor", () => {
  it("reads a type size at all, in both spellings", () => {
    // FALSE-PASS FLOOR. A scan that found nothing would report an empty offender list
    // and an empty census and agree with itself, which is what a moved `src` or a
    // renamed utility looks like. Both spellings are counted separately, because a
    // regex that stopped matching one of them is the specific failure that leaves this
    // file green while the chart's labels go anywhere they like.
    const sizes = typeSizes();
    expect(sizes.filter(({ literal }) => literal.startsWith("text-")).length)
      .toBeGreaterThan(20);
    expect(sizes.filter(({ literal }) => literal.startsWith("fontSize")).length)
      .toBeGreaterThan(0);
  });

  it("has exactly the sub-floor literals S7 counted, and not one more", () => {
    const under = typeSizes().filter(({ rem }) => rem < FLOOR_REM);
    const tally = new Map<string, number>();
    for (const { file, literal } of under) {
      const key = `${file} · ${literal}`;
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }

    const expected = new Map(
      CENSUS.map(({ file, literal, count }) => [`${file} · ${literal}`, count]),
    );
    // ONE ASSERTION OVER THE WHOLE MAP, so a red prints the census beside the source
    // rather than the first row that disagreed. A new sub-floor literal shows up as an
    // extra key; a lifted one shows up as a missing key or a smaller count; either way
    // the fix is to edit this list deliberately, which is the whole point of freezing it.
    expect(Object.fromEntries([...tally].sort())).toEqual(
      Object.fromEntries([...expected].sort()),
    );
    expect(under.length).toBe(9);
  });

  it("keeps the badge that started the rule on the floor rather than under it", () => {
    // `STATE_BADGE` was 0.72rem and is 0.75rem, which is why it is NOT in the census
    // above. Asserting it here is what keeps the census honest about which literal the
    // slice actually moved.
    const source = readFileSync(join(PACKAGE_SRC, "ui", "dca-card.tsx"), "utf8");
    expect(source).toMatch(
      /const STATE_BADGE = "text-\[0\.75rem\] font-semibold uppercase/,
    );
  });
});
