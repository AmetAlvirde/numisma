import { describe, expect, it } from "vitest";

import {
  bareCustomPropertyDeclarations,
  customPropertyReads,
  namespaceCustomPropertyReads,
  relativizeAliasImports,
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

describe("namespaceCustomPropertyReads", () => {
  it("prefixes a bare shadcn custom property", () => {
    expect(namespaceCustomPropertyReads("var(--muted)")).toBe("var(--nms-muted)");
  });

  it("prefixes names that are not colors", () => {
    // `--radius-md` is a token and it sits in Tailwind's own `--radius-*`
    // namespace. A rewriter restricted to colour role names would miss the four
    // size variants that clamp against it.
    expect(namespaceCustomPropertyReads("rounded-[min(var(--radius-md),8px)]")).toBe(
      "rounded-[min(var(--nms-radius-md),8px)]",
    );
  });

  it("rewrites every read in a line, preserving the surrounding text", () => {
    expect(
      namespaceCustomPropertyReads(
        "bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]",
      ),
    ).toBe(
      "bg-[color-mix(in_oklch,var(--nms-secondary),var(--nms-foreground)_5%)]",
    );
  });

  it("preserves whitespace inside the var() call", () => {
    expect(namespaceCustomPropertyReads("var( --muted )")).toBe("var( --nms-muted )");
  });

  it("keeps a fallback argument", () => {
    expect(namespaceCustomPropertyReads("var(--muted, black)")).toBe(
      "var(--nms-muted, black)",
    );
  });

  it("is idempotent — no --nms-nms-*", () => {
    const once = namespaceCustomPropertyReads("var(--muted) var(--radius-md)");
    expect(namespaceCustomPropertyReads(once)).toBe(once);
    expect(namespaceCustomPropertyReads(once)).not.toContain("--nms-nms-");
  });

  it("leaves Tailwind's own internal properties alone", () => {
    expect(namespaceCustomPropertyReads("var(--tw-ring-color)")).toBe(
      "var(--tw-ring-color)",
    );
  });

  it("prefixes Tailwind 4's shorthand read, which never writes `var(`", () => {
    // `bg-(--muted)` compiles to `background-color: var(--muted)`. Verified
    // against the pinned tailwindcss 4.3.3. A rewriter anchored on the literal
    // `var(` no-ops here and the package ships a bare read of the consumer's
    // `--muted` — in `apps/web` a secondary TEXT grey, so a hovered ghost
    // button paints type colour and looks plausible.
    expect(namespaceCustomPropertyReads("hover:bg-(--muted)")).toBe(
      "hover:bg-(--nms-muted)",
    );
  });

  it("prefixes the shorthand's typed form", () => {
    // `base-vega`'s sidebar writes `w-(--sidebar-width)`; the data-type hint
    // (`length:`, `color:`) is the other half of the same syntax.
    expect(namespaceCustomPropertyReads("w-(length:--sidebar-width)")).toBe(
      "w-(length:--nms-sidebar-width)",
    );
    expect(namespaceCustomPropertyReads("bg-(color:--accent)")).toBe(
      "bg-(color:--nms-accent)",
    );
  });

  it("prefixes a shorthand read carrying an opacity modifier", () => {
    expect(namespaceCustomPropertyReads("bg-(--muted)/50")).toBe(
      "bg-(--nms-muted)/50",
    );
  });

  it("prefixes a shorthand read behind a variant chain", () => {
    expect(namespaceCustomPropertyReads("[&_svg]:size-(--icon-size)")).toBe(
      "[&_svg]:size-(--nms-icon-size)",
    );
  });

  it("is idempotent on the shorthand too", () => {
    const once = namespaceCustomPropertyReads(
      "bg-(--muted) w-(length:--sidebar-width)",
    );
    expect(namespaceCustomPropertyReads(once)).toBe(once);
    expect(namespaceCustomPropertyReads(once)).not.toContain("--nms-nms-");
  });

  it("leaves a shorthand read of Tailwind's own internals alone", () => {
    expect(namespaceCustomPropertyReads("shadow-(--tw-shadow)")).toBe(
      "shadow-(--tw-shadow)",
    );
  });
});

describe("customPropertyReads", () => {
  it("reports every custom property a file reads", () => {
    expect(customPropertyReads("var(--nms-a) and var( --b )")).toEqual([
      "--nms-a",
      "--b",
    ]);
  });

  it("reports a shorthand read, which the standing namespace guard runs on", () => {
    // `ops/components/nms-namespace.test.ts` filters this list for names
    // outside the namespace. A read this function cannot see is a read that
    // guard cannot report, whatever route the source arrived by.
    expect(
      customPropertyReads('cn("hover:bg-(--muted) text-(--nms-foreground)")'),
    ).toEqual(["--muted", "--nms-foreground"]);
  });

  it("reports both syntaxes in source order", () => {
    expect(customPropertyReads("w-(length:--a) var(--b) max-w-(--c)")).toEqual([
      "--a",
      "--b",
      "--c",
    ]);
  });
});

describe("bareCustomPropertyDeclarations", () => {
  it("finds a class that DEFINES a custom property outside the namespace", () => {
    // A declaration is not a read, so namespaceCustomPropertyReads cannot see it. Left
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

  it("finds a JSX inline-style declaration", () => {
    // The other route a component declares a property by, and the one
    // `base-vega`'s sidebar takes: `style={{ "--sidebar-width": w }}` beside a
    // `w-[var(--sidebar-width)]` class. Seen only through the Tailwind
    // arbitrary-property syntax, the declaration stays bare while the rewrite
    // namespaces the read — the script manufacturing the exact split its own
    // refusal message describes.
    expect(
      bareCustomPropertyDeclarations(
        '<div style={{ "--sidebar-width": width }} className="w-[var(--sidebar-width)]" />',
      ),
    ).toEqual(["--sidebar-width"]);
  });

  it("finds single-quoted and computed style keys", () => {
    expect(
      bareCustomPropertyDeclarations("style={{ '--skeleton-width': w }}"),
    ).toEqual(["--skeleton-width"]);
    expect(
      bareCustomPropertyDeclarations('style={{ ["--icon-size"]: size }}'),
    ).toEqual(["--icon-size"]);
  });

  it("ignores a namespaced or Tailwind-internal style key", () => {
    expect(
      bareCustomPropertyDeclarations(
        '{ "--nms-sidebar-width": w, "--tw-shadow": s }',
      ),
    ).toEqual([]);
  });
});
