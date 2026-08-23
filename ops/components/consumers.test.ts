import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  TOKEN_CONSUMERS,
  consumerTokensCss,
  parseDefinedTokenNames,
} from "./consumers.ts";
import { PACKAGE_ROOT, REPO_ROOT } from "./package-source.ts";
import { parseTokenDeclarations } from "./tokens-file.ts";

const TOKENS = [
  { name: "--nms-primary", value: "oklch(0.205 0 0)" },
  { name: "--nms-radius-md", value: "0.375rem" },
];

describe("consumerTokensCss", () => {
  it("defines every declared token at :root", () => {
    expect(parseDefinedTokenNames(consumerTokensCss(TOKENS))).toEqual([
      "--nms-primary",
      "--nms-radius-md",
    ]);
  });

  it("says it is generated, and by what", () => {
    // The file is rewritten on every add. A hand edit to it is lost silently,
    // so the header is the only place a reader finds that out in time.
    const css = consumerTokensCss(TOKENS);
    expect(css).toContain("ops/components/shadcn-add.ts");
    expect(css.toLowerCase()).toContain("generated");
    expect(css).toContain("lost");
  });

  it("is byte-stable for the same token list", () => {
    expect(consumerTokensCss(TOKENS)).toBe(consumerTokensCss(TOKENS));
  });

  it("emits a file even with no tokens, rather than nothing at all", () => {
    // An empty `:root` is a visible, diffable "there is nothing here yet"; a
    // missing file reads as "the generator never ran".
    expect(consumerTokensCss([])).toContain(":root");
  });
});

describe("TOKEN_CONSUMERS", () => {
  it("is the one place a consumer registers, and empty is a legal state", () => {
    // Slice 3 adds `apps/web` here; Slice 6 adds `apps/workbench`. Until then
    // the generator has nothing to write and must not treat that as a failure.
    expect(Array.isArray(TOKEN_CONSUMERS)).toBe(true);
  });

  it("gives every registered consumer a label and a generated-file path", () => {
    for (const consumer of TOKEN_CONSUMERS) {
      expect(consumer.label).not.toBe("");
      expect(consumer.tokensFile).toMatch(/^(apps|packages)\/.+\.css$/);
    }
  });

  it("registers each consumer path once", () => {
    const paths = TOKEN_CONSUMERS.map((consumer) => consumer.tokensFile);
    expect([...new Set(paths)]).toEqual(paths);
  });
});

/**
 * THE REGENERATION CHECK — the generated files are committed, and this is the
 * only thing that says they are still what the generator would write.
 *
 * The cases above pin `consumerTokensCss` against an authored fixture, which
 * says the generator is correct and nothing about the bytes on disk. Between
 * the two sits a step no test covered: RE-RUNNING `pnpm components:add`. Hand
 * editing `packages/components/src/tokens.ts` is sanctioned — `shadcn-add.ts`
 * tells the operator to declare unknown names there by hand — so a grayscale
 * default can move with no add in the same commit, and both consumers go on
 * shipping the old value with the suite green.
 *
 * NAME drift is already caught, per consumer: `apps/web/src/nms-tokens.test.ts`
 * demands an override for every declared name. VALUE drift was caught nowhere,
 * and in the workbench the value is what paints before the decorator's effect
 * runs — the surface `docs/component-package.md`'s manual theming procedure
 * judges.
 *
 * Asserted against the REAL files, in the shape `tsconfig-paths.test.ts` uses
 * for the real tsconfig. The red is `pnpm components:add` was not re-run.
 */
describe("every committed consumer tokens file", () => {
  const tokens = parseTokenDeclarations(
    readFileSync(join(PACKAGE_ROOT, "src", "tokens.ts"), "utf8"),
  );
  const expected = consumerTokensCss(tokens);

  it("is generated from a token spec that actually parsed", () => {
    // Guards the guard. An empty parse would compare every consumer against an
    // empty `:root` and report the drift as agreement.
    expect(tokens.length).toBeGreaterThan(0);
    expect(TOKEN_CONSUMERS.length).toBeGreaterThan(0);
  });

  it.each(TOKEN_CONSUMERS.map((consumer) => [consumer.tokensFile] as const))(
    "%s is byte-identical to what the generator writes today",
    (tokensFile) => {
      expect(readFileSync(join(REPO_ROOT, tokensFile), "utf8")).toBe(expected);
    },
  );
});
