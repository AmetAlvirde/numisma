import { describe, expect, it } from "vitest";

import {
  customPropertyDeclarations,
  customPropertyNames,
  declarationMap,
  resolveVarChain,
} from "./css-custom-properties.ts";

/**
 * The shared CSS text parse, pinned with AUTHORED fixtures.
 *
 * Three guards read stylesheets through this module — the generator's consumer
 * report, `apps/web`'s token test, and `apps/workbench`'s drift test — and each
 * of them FAILS TOWARD GREEN if the parse quietly stops matching: a regex that
 * finds nothing turns every "is this token defined" question into an empty
 * result, and an empty `it.each` passes. So the parse gets its own red.
 *
 * The alias resolution is the half with real edges. `apps/web` writes its
 * overrides as `var(--bg)` on purpose, and a resolver that gave up quietly
 * would let the workbench's app mode agree with the app on the STRING
 * `var(--bg)` while disagreeing about every colour it stood for.
 */

describe("customPropertyNames", () => {
  it("finds declarations in source order, semicolon or not", () => {
    const css = `:root {\n  --a: 1;\n  --b-two: 2;\n  --c: 3\n}`;
    expect(customPropertyNames(css)).toEqual(["--a", "--b-two", "--c"]);
  });

  it("ignores READS, which are not declarations", () => {
    // The distinction the whole token contract rests on: `tokens.ts` reads
    // names it never defines, and a parse that conflated the two would report
    // the package as its own consumer.
    expect(customPropertyNames(`.x { color: var(--a); }`)).toEqual([]);
  });

  it("keeps a repeated name repeated", () => {
    // `apps/web`'s test counts declarations to prove its edit was additive — a
    // second `--bg:` further down the file is exactly what it is looking for,
    // so de-duplicating here would delete that assertion's evidence.
    expect(customPropertyNames(`--a: 1;\n--a: 2;`)).toEqual(["--a", "--a"]);
  });
});

describe("customPropertyDeclarations", () => {
  it("pairs each name with its trimmed value", () => {
    expect(customPropertyDeclarations(`  --a:   #fff ;\n  --b: var(--a);`)).toEqual([
      { name: "--a", value: "#fff" },
      { name: "--b", value: "var(--a)" },
    ]);
  });

  it("skips a final declaration with no semicolon", () => {
    // Stated as a test rather than left to be discovered: without a `;` there
    // is no way to know where the value ends, which is why `customPropertyNames`
    // exists separately and answers the name-only question completely.
    expect(customPropertyDeclarations(`--a: 1;\n--b: 2`)).toEqual([
      { name: "--a", value: "1" },
    ]);
  });
});

describe("resolveVarChain", () => {
  const lookup = declarationMap(
    customPropertyDeclarations(`--bg: #0f1115;\n--alias: var(--bg);\n--loop: var(--loop);`),
  );

  it("returns a literal unchanged", () => {
    expect(resolveVarChain("#0f1115", lookup)).toBe("#0f1115");
  });

  it("walks a single alias to its literal", () => {
    expect(resolveVarChain("var(--bg)", lookup)).toBe("#0f1115");
  });

  it("walks a chain of aliases", () => {
    expect(resolveVarChain("var(--alias)", lookup)).toBe("#0f1115");
  });

  it("gives up on an undefined name rather than inventing one", () => {
    // Returning the unresolved text is what lets the drift test SEE the
    // failure: it asserts no resolved value still contains `var(`, so a renamed
    // palette entry surfaces as a red instead of as a silent match.
    expect(resolveVarChain("var(--missing)", lookup)).toBe("var(--missing)");
  });

  it("gives up on a cycle instead of looping", () => {
    expect(resolveVarChain("var(--loop)", lookup)).toBe("var(--loop)");
  });

  it("leaves a compound value alone", () => {
    // Only a value that is ENTIRELY one `var()` is an alias. `min(var(--a),8px)`
    // is a computation, and substituting inside it here would be inventing a
    // second, worse CSS engine.
    expect(resolveVarChain("min(var(--bg),8px)", lookup)).toBe("min(var(--bg),8px)");
  });

  it("stops after the hop budget", () => {
    const deep = declarationMap(
      customPropertyDeclarations(
        Array.from({ length: 6 }, (_, i) => `--n${i}: var(--n${i + 1});`).join("\n"),
      ),
    );
    expect(resolveVarChain("var(--n0)", deep, 3)).toBe("var(--n3)");
  });
});
