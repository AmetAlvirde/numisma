import { describe, expect, it } from "vitest";

import {
  TOKEN_CONSUMERS,
  consumerTokensCss,
  parseDefinedTokenNames,
} from "./consumers.ts";

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
