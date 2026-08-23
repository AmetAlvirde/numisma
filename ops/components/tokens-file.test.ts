import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { packageSourceFiles } from "./package-source.ts";
import {
  SHADCN_TOKEN_DEFAULTS,
  discoverTokenNames,
  discoverTokenNamesAcross,
  mergeTokenDeclarations,
  parseTokenDeclarations,
} from "./tokens-file.ts";

/**
 * Discovering which tokens a placed component needs, and folding them into
 * `packages/components/src/tokens.ts` without disturbing a hand-written file.
 *
 * The fixture below is authored, not lifted from the real `tokens.ts` — it
 * carries the shape the merge depends on and nothing else, so a prose edit to
 * the real file cannot turn this test red.
 */
const FIXTURE = `/** Header prose. */
export const NMS_TOKENS = [
  {
    name: "--nms-primary",
    value: "oklch(0.205 0 0)",
    note: "The one emphasised action.",
  },
] as const satisfies readonly NmsToken[];

export const NMS_PREFIX = "--nms-";
`;

describe("discoverTokenNames", () => {
  it("finds a token read bare through var()", () => {
    expect(discoverTokenNames("var(--nms-radius-md)")).toContain(
      "--nms-radius-md",
    );
  });

  it("finds a token reached only through a Tailwind theme utility", () => {
    // `bg-primary` produces no `var()` read at all, and it is still a name the
    // consumer must define — a theme variable that does not exist emits NO RULE
    // rather than an error. Scanning var reads alone would miss most of the set.
    expect(discoverTokenNames('cn("bg-primary text-primary-foreground")')).toEqual(
      ["--nms-primary", "--nms-primary-foreground"],
    );
  });

  it("reads the longest role, not its prefix", () => {
    expect(discoverTokenNames("bg-primary-foreground")).toEqual([
      "--nms-primary-foreground",
    ]);
  });

  it("survives modifiers and opacity suffixes", () => {
    expect(
      discoverTokenNames("dark:hover:bg-muted/50 focus-visible:ring-ring/50"),
    ).toEqual(["--nms-muted", "--nms-ring"]);
  });

  it("ignores a utility whose suffix is not a shadcn role", () => {
    expect(discoverTokenNames("bg-clip-padding text-xs shadow-xs")).toEqual([]);
  });

  it("reports each name once", () => {
    expect(discoverTokenNames("bg-muted hover:bg-muted var(--nms-muted)")).toEqual(
      ["--nms-muted"],
    );
  });
});

describe("mergeTokenDeclarations", () => {
  it("leaves the file byte-identical when nothing is new", () => {
    const merged = mergeTokenDeclarations(FIXTURE, ["--nms-primary"], "badge");
    expect(merged.text).toBe(FIXTURE);
    expect(merged.added).toEqual([]);
  });

  it("appends a new token with its grayscale default", () => {
    const merged = mergeTokenDeclarations(FIXTURE, ["--nms-muted"], "badge");
    expect(merged.added).toEqual(["--nms-muted"]);
    expect(parseTokenDeclarations(merged.text)).toEqual([
      { name: "--nms-primary", value: "oklch(0.205 0 0)" },
      { name: "--nms-muted", value: SHADCN_TOKEN_DEFAULTS["muted"] },
    ]);
  });

  it("names the component that brought the token in", () => {
    const merged = mergeTokenDeclarations(FIXTURE, ["--nms-muted"], "badge");
    expect(merged.text).toContain("badge");
  });

  it("is idempotent — a second run adds no duplicate entry", () => {
    const once = mergeTokenDeclarations(FIXTURE, ["--nms-muted"], "badge").text;
    const twice = mergeTokenDeclarations(once, ["--nms-muted"], "badge");
    expect(twice.text).toBe(once);
    expect(twice.added).toEqual([]);
  });

  it("refuses a name it has no default for rather than inventing one", () => {
    // A placeholder value would satisfy `tokens.test.ts`'s "every token has a
    // default" and ship a wrong colour. The script exits on `unknown` instead.
    const merged = mergeTokenDeclarations(FIXTURE, ["--nms-invented"], "badge");
    expect(merged.unknown).toEqual(["--nms-invented"]);
    expect(merged.added).toEqual([]);
    expect(merged.text).toBe(FIXTURE);
  });

  it("keeps the emitted entry parseable by the next run", () => {
    const once = mergeTokenDeclarations(FIXTURE, ["--nms-ring"], "badge").text;
    expect(parseTokenDeclarations(once).map((token) => token.name)).toEqual([
      "--nms-primary",
      "--nms-ring",
    ]);
  });
});

describe("SHADCN_TOKEN_DEFAULTS", () => {
  it("is grayscale throughout", () => {
    // A component reviewed against the package's own defaults is reviewed on
    // hierarchy, spacing and state. Chroma here would smuggle in a palette —
    // including upstream's red `--destructive`.
    const chromatic = Object.entries(SHADCN_TOKEN_DEFAULTS).filter(
      ([, value]) =>
        value.startsWith("oklch(") && !/^oklch\([\d.]+ 0 0\)$/.test(value),
    );
    expect(chromatic).toEqual([]);
  });

  it("covers the radius scale, which is not a colour", () => {
    expect(SHADCN_TOKEN_DEFAULTS["radius-md"]).toBe("0.375rem");
  });
});

describe("the declared spec and what the script would discover", () => {
  /**
   * The claim the scripted add path makes about the package as it stands: the
   * token spec was READ OFF COMPONENT SOURCE, and this module is what reads it.
   *
   * Slice 1 derived Button's twelve names by hand. If discovery and the
   * hand-written file disagree, one of them is wrong — either the script would
   * fail to declare a token the next component needs, or `tokens.ts` carries a
   * name nothing reads and every consumer is asked to define.
   */
  const files = packageSourceFiles();
  const declared = parseTokenDeclarations(
    readFileSync(
      files.find((file) => file.absolute.endsWith("tokens.ts"))!.absolute,
      "utf8",
    ),
  ).map((token) => token.name);

  it("walks a package that actually has source in it", () => {
    expect(files.some((file) => file.absolute.endsWith("button.tsx"))).toBe(true);
  });

  it("agrees, exactly", () => {
    const discovered = discoverTokenNamesAcross(
      files
        .filter((file) => !file.absolute.endsWith("tokens.ts"))
        .map((file) => readFileSync(file.absolute, "utf8")),
    );
    expect([...discovered].sort()).toEqual([...declared].sort());
  });
});
