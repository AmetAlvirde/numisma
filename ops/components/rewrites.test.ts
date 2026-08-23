import { describe, expect, it } from "vitest";

import {
  bareCustomPropertyDeclarations,
  namespaceVarReads,
  relativizeAliasImports,
  varReads,
} from "./rewrites.ts";

/**
 * The two text rewrites the scripted add path applies to every file the shadcn
 * CLI places, held here because they are the whole reason the script exists.
 * Both are idempotent by construction: the script is re-runnable, and a
 * re-run that double-prefixed a var would produce `--nms-nms-muted`, a name
 * nothing defines and nothing reports.
 */

describe("relativizeAliasImports", () => {
  it("rewrites the utils alias to a relative, extensionless specifier", () => {
    const text = 'import { cn } from "@/lib/utils"\n';
    expect(relativizeAliasImports(text, "ui")).toBe(
      'import { cn } from "../lib/utils"\n',
    );
  });

  it("uses ./ for a sibling rather than a bare specifier", () => {
    // `lib/utils` from inside `lib` is `./utils`; emitting `utils` would
    // resolve as a package name.
    expect(relativizeAliasImports('from "@/lib/utils"', "lib")).toBe(
      'from "./utils"',
    );
  });

  it("never appends a .js extension", () => {
    // The package is moduleResolution Bundler, unlike @numisma/engine's
    // NodeNext. A `.js` specifier here would be a typecheck failure.
    expect(relativizeAliasImports('from "@/ui/button"', "ui")).not.toContain(
      ".js",
    );
  });

  it("rewrites side-effect imports, dynamic imports and re-exports", () => {
    const text = [
      'import "@/lib/side-effect"',
      'const mod = await import("@/hooks/use-thing")',
      'export { thing } from "@/lib/thing"',
    ].join("\n");
    expect(relativizeAliasImports(text, "ui")).toBe(
      [
        'import "../lib/side-effect"',
        'const mod = await import("../hooks/use-thing")',
        'export { thing } from "../lib/thing"',
      ].join("\n"),
    );
  });

  it("leaves a real package specifier alone", () => {
    const text = 'import { Button } from "@base-ui/react/button"';
    expect(relativizeAliasImports(text, "ui")).toBe(text);
  });

  it("is idempotent", () => {
    const once = relativizeAliasImports('from "@/lib/utils"', "ui");
    expect(relativizeAliasImports(once, "ui")).toBe(once);
  });
});

describe("namespaceVarReads", () => {
  it("prefixes a bare shadcn custom property", () => {
    expect(namespaceVarReads("var(--muted)")).toBe("var(--nms-muted)");
  });

  it("prefixes names that are not colors", () => {
    // `--radius-md` is a token and it sits in Tailwind's own `--radius-*`
    // namespace. A rewriter restricted to colour role names would miss the four
    // size variants that clamp against it.
    expect(namespaceVarReads("rounded-[min(var(--radius-md),8px)]")).toBe(
      "rounded-[min(var(--nms-radius-md),8px)]",
    );
  });

  it("rewrites every read in a line, preserving the surrounding text", () => {
    expect(
      namespaceVarReads(
        "bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]",
      ),
    ).toBe(
      "bg-[color-mix(in_oklch,var(--nms-secondary),var(--nms-foreground)_5%)]",
    );
  });

  it("preserves whitespace inside the var() call", () => {
    expect(namespaceVarReads("var( --muted )")).toBe("var( --nms-muted )");
  });

  it("keeps a fallback argument", () => {
    expect(namespaceVarReads("var(--muted, black)")).toBe(
      "var(--nms-muted, black)",
    );
  });

  it("is idempotent — no --nms-nms-*", () => {
    const once = namespaceVarReads("var(--muted) var(--radius-md)");
    expect(namespaceVarReads(once)).toBe(once);
    expect(namespaceVarReads(once)).not.toContain("--nms-nms-");
  });

  it("leaves Tailwind's own internal properties alone", () => {
    expect(namespaceVarReads("var(--tw-ring-color)")).toBe(
      "var(--tw-ring-color)",
    );
  });
});

describe("varReads", () => {
  it("reports every custom property a file reads", () => {
    expect(varReads("var(--nms-a) and var( --b )")).toEqual([
      "--nms-a",
      "--b",
    ]);
  });
});

describe("bareCustomPropertyDeclarations", () => {
  it("finds a class that DEFINES a custom property outside the namespace", () => {
    // A declaration is not a read, so namespaceVarReads cannot see it. Left
    // alone beside a namespaced read it produces a component that defines
    // `--radius` and reads `--nms-radius`: correct-looking and computing to
    // nothing. The script refuses rather than guessing.
    expect(bareCustomPropertyDeclarations('cn("[--radius:0.5rem] p-2")')).toEqual(
      ["--radius"],
    );
  });

  it("ignores Tailwind's own internal properties and the namespace", () => {
    expect(
      bareCustomPropertyDeclarations("[--tw-x:1] [--nms-gap:2px]"),
    ).toEqual([]);
  });
});
