import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CONTRAST_PAIRS,
  EXCLUDED_CONTRAST_PAIRS,
  NON_TEXT_CONTRAST,
  TEXT_CONTRAST,
  type ContrastForeground,
  type ContrastPair,
} from "../../packages/components/src/contrast.ts";

import {
  customPropertyDeclarations,
  declarationMap,
  resolveVarChain,
} from "./css-custom-properties.ts";
import { PACKAGE_ROOT, REPO_ROOT } from "./package-source.ts";
import { parseTokenDeclarations } from "./tokens-file.ts";

/**
 * THE CONTRAST GUARD (spec #451 §4.1 and §6, issue #455, ADR-026).
 *
 * `packages/components/src/contrast.ts` is the claim: which foreground this
 * package's components put on which surface, and under which WCAG clause. This
 * file is what measures it, against palettes read OFF DISK rather than imported,
 * because a palette is a consumer's property and the package must not hold a
 * copy of one.
 *
 * WHY THE PACKAGE SHIPS THIS AND NOT EACH CONSUMER. A consumer supplying values
 * cannot know the pairs without reading package source, which is the coupling
 * ADR-023 exists to prevent. The pairs live with the components that render
 * them; the values stay with whoever owns them. That split is the whole seam,
 * and it is why the alternative — each consumer polices its own theme — would
 * have "fixed" the login field's boundary by repainting `--line` and silently
 * moving eight surfaces to reach one input.
 *
 * TWO PALETTES, NOT THREE CONSUMERS. Reading `apps/workbench/src/theme-modes.ts`
 * collapses the count, and `PALETTES` below is where that collapse is written
 * down rather than assumed.
 *
 * WHAT WENT RED FIRST, AND WHY IT MATTERS. On arrival this guard failed three
 * rows of the app palette and five of the package's own defaults, and every one
 * of them was a real defect a screenshot had never caught: `--nms-warn` as text
 * on a card at 2.91, the login field's boundary at 1.20, and `--nms-warn` as a
 * mark at 2.91, plus a focus ring, a field edge and three data colours in the
 * grayscale base mode. A guard authored after the fixes would have arrived green
 * and unfalsifiable, and the slice that wrote it recorded the red instead.
 */

/**
 * A palette this guard checks, or declines to, with the reason attached.
 *
 * THE EXEMPTION IS A FIELD, NOT AN ABSENCE. The workbench's themed mode is the
 * one palette here that would fail on purpose, and leaving it out of the list
 * would be indistinguishable from forgetting it. `exempt` carries the argument
 * so the next reader finds out why the mode is skipped without rediscovering
 * it, and the case at the bottom of this file asserts the field is there.
 */
interface Palette {
  /** How the palette is named in a failure message. */
  readonly label: string;
  /** `--nms-*` name to a resolved colour literal, or `undefined` when exempt. */
  readonly resolve?: () => Map<string, string>;
  /** Why this palette is not measured. Present exactly when `resolve` is not. */
  readonly exempt?: string;
}

/**
 * THE PACKAGE'S GRAYSCALE DEFAULTS, parsed out of `tokens.ts` as text.
 *
 * Parsed rather than imported, for the reason every other guard in this
 * directory parses it: the generator writes each consumer's stylesheet from
 * these same bytes, and two readings of one file cannot disagree about it. This
 * is also the workbench's grayscale mode, which builds `GRAYSCALE_TOKENS`
 * straight off `NMS_TOKENS`, so checking the array covers that mode.
 *
 * IT IS WHAT AN UNCONFIGURED CONSUMER RENDERS, which is the whole reason it is
 * in scope. A consumer that adopts the package and forgets to theme it gets
 * these values on a real screen, and ADR-026 binds the package as well as the
 * app.
 */
function grayscaleDefaults(): Map<string, string> {
  const tokensTs = readFileSync(join(PACKAGE_ROOT, "src", "tokens.ts"), "utf8");
  const parsed = parseTokenDeclarations(tokensTs);
  expect(parsed.length, "tokens.ts parsed to nothing").toBeGreaterThan(0);
  return new Map(parsed.map((token) => [token.name, token.value]));
}

/**
 * `apps/web`'s PALETTE, resolved one `var()` level.
 *
 * `styles.css` holds two `:root` blocks: hex literals in the first, `--nms-*`
 * aliases onto them in the second. `resolveVarChain` walks the alias to the
 * literal, which is the same walk `app-token-drift.test.ts` performs, over the
 * same file, through the same helper. Comparing alias TEXT instead would pass
 * while the palette moved underneath it.
 *
 * The workbench's app mode is a copy of this, already pinned by that test, so
 * one read here covers both.
 */
function appPalette(): Map<string, string> {
  const stylesCss = readFileSync(
    join(REPO_ROOT, "apps", "web", "src", "styles.css"),
    "utf8",
  );
  const declared = declarationMap(customPropertyDeclarations(stylesCss));
  const resolved = new Map(
    [...declared.entries()]
      .filter(([name]) => name.startsWith("--nms-"))
      .map(([name, value]) => [name, resolveVarChain(value, declared)] as const),
  );
  expect(resolved.size, "styles.css declared no --nms-* names").toBeGreaterThan(0);
  return resolved;
}

const PALETTES: readonly Palette[] = [
  { label: "the package's grayscale defaults", resolve: grayscaleDefaults },
  { label: "apps/web's palette", resolve: appPalette },
  {
    label: "the workbench's themed mode",
    exempt:
      "Its contract is pairwise distinctness, not taste. Every declared token gets a loud, deliberately clashing value so a token that repaints nothing becomes visible when the switcher moves, and `app-token-drift.test.ts` asserts exactly that distinctness and nothing about the colours. Measuring it for legibility would fail it on purpose and would push the one mode built to tell roles apart back toward a palette that looks pleasant, which is the signal it exists to give up.",
  },
];

/* ── COLOUR, AND THE TWO NOTATIONS THE TWO PALETTES ARE WRITTEN IN ──────────
 *
 * `apps/web` writes hex; `tokens.ts` writes `oklch()`. Both have to reach the
 * same place, which is linear-light sRGB, because WCAG's relative luminance is
 * defined there and nowhere else. There is no colour library in this repo and
 * this is not the place to add one: the conversion below is the published OKLab
 * matrix and it is anchored by the self-check cases at the bottom of this file
 * against three numbers written down outside it.
 */

/** sRGB channels in 0..1, which is the only form anything below accepts. */
type Rgb = readonly [number, number, number];

function parseHex(text: string): Rgb | undefined {
  const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(text.trim());
  if (match === null) return undefined;
  const digits = match[1]!;
  const full =
    digits.length === 3
      ? digits
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : digits;
  return [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16) / 255) as unknown as Rgb;
}

/** `oklch(L C H)`, with `L` as a number in 0..1 or a percentage. */
function parseOklch(text: string): Rgb | undefined {
  const match = /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*\)$/.exec(
    text.trim(),
  );
  if (match === null) return undefined;
  const lightness = match[1]!.endsWith("%")
    ? Number.parseFloat(match[1]!) / 100
    : Number.parseFloat(match[1]!);
  const chroma = Number.parseFloat(match[2]!);
  const hue = (Number.parseFloat(match[3]!) * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const encode = (channel: number): number =>
    channel <= 0.0031308
      ? 12.92 * channel
      : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055;
  return linear.map((channel) =>
    Math.min(1, Math.max(0, encode(channel))),
  ) as unknown as Rgb;
}

function parseColor(text: string): Rgb | undefined {
  if (text.trim() === "white") return [1, 1, 1];
  return parseHex(text) ?? parseOklch(text);
}

/** WCAG 2.2 relative luminance. */
function luminance([red, green, blue]: Rgb): number {
  const linear = (channel: number): number =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

/** WCAG 2.2 contrast ratio, lighter over darker. */
function contrastRatio(one: Rgb, other: Rgb): number {
  const first = luminance(one);
  const second = luminance(other);
  const [lighter, darker] = first > second ? [first, second] : [second, first];
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * A pair's colour, out of a palette. `"white"` resolves to itself, which is
 * what makes the badges measurable at all.
 */
function colorFor(
  palette: Map<string, string>,
  name: ContrastForeground,
): string | undefined {
  return name === "white" ? "white" : palette.get(name);
}

/**
 * The message a failure prints: the clause, both names, the required ratio and
 * the measured one.
 *
 * NAMING THE CLAUSE IS THE POINT (spec #451 §4.1). A red that says only "2.91"
 * tells a reader which number moved. This says which rule broke, and ADR-026 is
 * where that rule is written down.
 */
function verdict(pair: ContrastPair, measured: number): string {
  return [
    `${pair.criterion.id} (${pair.criterion.title}):`,
    `${pair.foreground} on ${pair.surface}`,
    `needs ${pair.criterion.ratio}:1 and measures ${measured.toFixed(2)}:1.`,
    pair.renders,
  ].join(" ");
}

const MEASURED = PALETTES.filter(
  (palette): palette is Palette & { resolve: () => Map<string, string> } =>
    palette.resolve !== undefined,
);

describe.each(MEASURED.map((palette) => [palette.label, palette] as const))(
  "%s clears every declared pair",
  (_label, palette) => {
    const values = palette.resolve();

    it.each(
      CONTRAST_PAIRS.map(
        (pair) => [`${pair.foreground} on ${pair.surface}`, pair] as const,
      ),
    )("%s", (_pairLabel, pair) => {
      const foreground = colorFor(values, pair.foreground);
      const surface = values.get(pair.surface);
      // A pair naming a token the palette does not define is a hole in the
      // palette, not a passing row. `nms-tokens.test.ts` holds the same line
      // from the app's side; this one keeps the guard from going green over a
      // name nobody supplied.
      expect(foreground, `${pair.foreground} is undefined`).toBeDefined();
      expect(surface, `${pair.surface} is undefined`).toBeDefined();

      const parsedForeground = parseColor(foreground!);
      const parsedSurface = parseColor(surface!);
      // And a colour notation nothing here can read would compute to a silent
      // pass for every pair that touched it.
      expect(parsedForeground, `cannot read ${foreground}`).toBeDefined();
      expect(parsedSurface, `cannot read ${surface}`).toBeDefined();

      const measured = contrastRatio(parsedForeground!, parsedSurface!);
      // The verdict sentence IS the received value, so the diff a red prints is
      // the failure message rather than a bare number beside a bare number.
      expect(measured >= pair.criterion.ratio ? "clears" : verdict(pair, measured)).toBe(
        "clears",
      );
    });
  },
);

describe("the pair list itself", () => {
  it("carries a criterion, a threshold and a renderer on every entry", () => {
    for (const pair of CONTRAST_PAIRS) {
      expect(pair.criterion.id, `${pair.foreground} on ${pair.surface}`).toMatch(
        /^SC \d\.\d\.\d+$/,
      );
      expect(pair.criterion.ratio).toBeGreaterThan(1);
      expect(pair.renders.length).toBeGreaterThan(20);
    }
  });

  it("uses only the two clauses ADR-026 names", () => {
    // ADR-026 binds four things; two of them are ratios and the other two are
    // keyboard operability and announced state, which no colour pair can
    // answer. A third ratio appearing here would be a threshold from outside
    // the document this list is judged against.
    const criteria = new Set(CONTRAST_PAIRS.map((pair) => pair.criterion.id));
    expect([...criteria].sort()).toEqual(
      [TEXT_CONTRAST.id, NON_TEXT_CONTRAST.id].sort(),
    );
    expect(TEXT_CONTRAST.ratio).toBe(4.5);
    expect(NON_TEXT_CONTRAST.ratio).toBe(3);
  });

  it("names every surface, and every token foreground, inside the namespace", () => {
    for (const pair of CONTRAST_PAIRS) {
      expect(pair.surface.startsWith("--nms-")).toBe(true);
      expect(
        pair.foreground === "white" || pair.foreground.startsWith("--nms-"),
      ).toBe(true);
    }
  });

  it("holds no pair twice under one criterion", () => {
    // Two identical rows would double a red without adding a claim, and would
    // hide a typo in one of them behind the other.
    const seen = CONTRAST_PAIRS.map(
      (pair) => `${pair.criterion.id} ${pair.foreground} ${pair.surface}`,
    );
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("gives every exclusion a reason rather than a silence", () => {
    // The list is only trustworthy if what is missing from it is missing on
    // purpose. An exclusion with no argument is an oversight with a name.
    expect(EXCLUDED_CONTRAST_PAIRS.length).toBeGreaterThan(0);
    for (const excluded of EXCLUDED_CONTRAST_PAIRS) {
      expect(
        excluded.reason.length,
        `${excluded.foreground} on ${excluded.surface}`,
      ).toBeGreaterThan(80);
    }
  });

  it("excludes nothing it also asserts", () => {
    const asserted = new Set(
      CONTRAST_PAIRS.map((pair) => `${pair.foreground} ${pair.surface}`),
    );
    for (const excluded of EXCLUDED_CONTRAST_PAIRS) {
      expect(
        asserted.has(`${excluded.foreground} ${excluded.surface}`),
        `${excluded.foreground} on ${excluded.surface} is both asserted and excluded`,
      ).toBe(false);
    }
  });
});

describe("the palette registration", () => {
  it("checks two palettes and declares why the third is skipped", () => {
    expect(PALETTES.length).toBe(3);
    expect(MEASURED.length).toBe(2);
  });

  it("gives the themed mode an exemption that is a field and not an absence", () => {
    // The claim spec #451 §6 asks for, asserted rather than inferred. A themed
    // palette silently dropped from the list above would leave this file
    // looking identical to one that had never considered it.
    const themed = PALETTES.find((palette) =>
      palette.label.includes("themed"),
    );
    expect(themed).toBeDefined();
    expect(themed!.exempt).toBeDefined();
    expect(themed!.exempt!.length).toBeGreaterThan(120);
    expect(themed!.resolve).toBeUndefined();
  });

  it("gives every measured palette a resolver and no exemption", () => {
    // The other direction: an exemption smuggled onto a palette that still has
    // a resolver would read as checked and skipped at once.
    for (const palette of MEASURED) {
      expect(palette.exempt, palette.label).toBeUndefined();
    }
  });
});

describe("the measurement itself", () => {
  // Guards the guard. Every assertion above is a comparison between two numbers
  // this file computed, so a conversion that returned a constant would report
  // the strongest possible green. These three anchors are written down outside
  // this file: 21:1 is WCAG's own maximum, and 4.58 is the ratio
  // `apps/web/src/styles.css` has recorded for `--accent` in its own comment
  // since the accent was minted.
  const ratio = (one: string, other: string): number =>
    contrastRatio(parseColor(one)!, parseColor(other)!);

  it("puts white on black at WCAG's maximum", () => {
    expect(ratio("#ffffff", "#000000")).toBeCloseTo(21, 5);
  });

  it("agrees with the one ratio styles.css writes down", () => {
    expect(ratio("white", "#3b6cf0")).toBeCloseTo(4.58, 2);
  });

  it("reads oklch and hex onto the same scale", () => {
    // `oklch(1 0 0)` is white and `oklch(0 0 0)` is black, so the two notations
    // must meet at the same maximum. A matrix transcribed wrong lands elsewhere.
    expect(ratio("oklch(1 0 0)", "oklch(0 0 0)")).toBeCloseTo(21, 2);
    expect(ratio("oklch(1 0 0)", "#000000")).toBeCloseTo(21, 2);
  });

  it("refuses a notation it cannot read", () => {
    expect(parseColor("color-mix(in srgb, var(--pos) 12%, var(--bg))")).toBeUndefined();
    expect(parseColor("var(--line)")).toBeUndefined();
  });
});
