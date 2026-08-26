import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import * as components from "@numisma/components";

/**
 * FIXTURE COVERAGE, ASSERTED RATHER THAN INSPECTED (spec #412 §5 Seam D).
 *
 * The workbench is only a diagnostic instrument for the components it actually
 * renders. A component added to `@numisma/components` and never given a fixture
 * is invisible here — and invisible in the one place a human is supposed to be
 * able to see every state of every component. Nothing about that failure is
 * loud: the workbench still starts, every existing fixture still renders, and
 * the gap is a file that does not exist.
 *
 * WHY THE PACKAGE'S PUBLIC SURFACE IS THE SOURCE OF TRUTH, and not a hand-kept
 * list. `src/index.ts` names its exports one at a time on purpose; this reads
 * that same surface at runtime, so the day a component is exported is the day
 * this test starts demanding a fixture for it. A list here would go stale in
 * the one direction that matters and stay green while it did.
 *
 * WHAT COUNTS AS A COMPONENT. An exported binding that is a function and whose
 * name starts with a capital letter — React's own rule, and the same one JSX
 * enforces at the call site. `cn` and `buttonVariants` are functions too and
 * are deliberately excluded by it: they are helpers with no rendered form, so a
 * fixture for either would render nothing and prove nothing. `NMS_TOKENS` and
 * friends are data and are not functions at all.
 */

const SRC = dirname(fileURLToPath(import.meta.url));

/** Every file under a directory, recursively. */
function allFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? allFiles(path) : [path];
  });
}

/** Every `*.fixture.tsx` in the workbench, with its source text. */
function fixtureSources(): { readonly path: string; readonly text: string }[] {
  return allFiles(SRC)
    .filter((path) => path.endsWith(".fixture.tsx"))
    .map((path) => ({
      path: relative(SRC, path),
      text: readFileSync(path, "utf8"),
    }));
}

/** The exported names that React would accept as components. */
const exportedComponents = Object.entries(components)
  .filter(
    ([name, value]) =>
      typeof value === "function" && /^[A-Z]/.test(name.charAt(0)),
  )
  .map(([name]) => name);

describe("every exported component has a fixture", () => {
  const fixtures = fixtureSources();

  it("finds at least one fixture at all", () => {
    // Guards the direction the per-component cases cannot: a `src` tree with no
    // fixtures in it would pass an empty `it.each` for a package that exported
    // nothing, and the two failures would cancel out silently.
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it("finds at least one exported component to demand a fixture for", () => {
    expect(exportedComponents.length).toBeGreaterThan(0);
  });

  it.each(exportedComponents)("renders %s in a fixture", (name) => {
    // Imported BY NAME from the package, not merely mentioned: a fixture that
    // names the component in a comment would otherwise satisfy this.
    const importsIt = fixtures.filter(({ text }) =>
      new RegExp(
        `import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*"@numisma/components"`,
      ).test(text),
    );
    expect(importsIt.map(({ path }) => path).length).toBeGreaterThan(0);
  });
});

/**
 * THE WITHDRAWAL OF `useFillPath`, ASSERTED RATHER THAN ASSUMED (spec #451 §4.5).
 *
 * `useFillPath` was published at S6 of spec #439 because the four fill-path parts
 * still lived in `apps/web` and read the provider across the package boundary.
 * Wave 2 moved them in, which left a published hook with no caller outside the
 * package, and wave 3 withdrew it. What makes that safe is the pair of claims
 * below, and neither survives on inspection alone.
 *
 * WHY THE ASSERTION LIVES HERE. This file already declares the package's public
 * surface the source of truth and reads it at runtime, so it is where the surface
 * shrinking is visible. The capitalization filter above cannot see the change:
 * `useFillPath` is lowercase, so it was never a fixture obligation and no count in
 * this file moved when it came out. That is the reason to state the withdrawal
 * outright — with nothing counting it, the surface could grow the hook back and
 * every test in the repo would stay green.
 *
 * THE SCAN IS THE HALF `pnpm typecheck` CANNOT MAKE. An app importing
 * `useFillPath` from `@numisma/components` is a type error the day the index stops
 * naming it, so typecheck holds that door. It does NOT hold the deep subpath:
 * `@numisma/components/ui/fill-path.tsx` still exports the hook and would resolve
 * for anyone, which is exactly the route a consumer takes when the index says no.
 * So the scan reads import specifiers across every workspace source tree and asks
 * the question the compiler will not.
 *
 * THE SUBPATH ITSELF IS NOT THE TARGET AND MUST NOT BECOME ONE. `fill-path.fixture.tsx`
 * beside this file crosses it for nine internal names on purpose (see the docblock
 * in the package's `index.ts`). What is asserted is one name, not the crossing.
 */
const REPO_ROOT = resolve(SRC, "..", "..", "..");

/** The package's own tree, where the hook is defined and read internally. */
const PACKAGE_SRC = join(REPO_ROOT, "packages", "components", "src");

/** Every workspace source file outside the package, skipping installed deps. */
function consumerFiles(dir: string): string[] {
  if (dir === PACKAGE_SRC) return [];
  return readdirSync(dir).flatMap((entry) => {
    if (entry === "node_modules" || entry.startsWith(".")) return [];
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return consumerFiles(path);
    return /\.(m?[jt]sx?)$/.test(path) ? [path] : [];
  });
}

describe("the package no longer publishes `useFillPath`", () => {
  it("keeps it off the runtime surface, and keeps its two neighbours on", () => {
    const surface = Object.keys(components);
    expect(surface).not.toContain("useFillPath");
    // The neighbours are named so a withdrawal that overshot is a failure here
    // rather than a type error somewhere downstream: `useFillPathSelection` is
    // the workbench's selection probe, `FillPathProvider` is what mounts it.
    expect(surface).toContain("useFillPathSelection");
    expect(surface).toContain("FillPathProvider");
  });

  it("has no consumer outside the package importing it, through any import form", () => {
    // TWO ARMS, BECAUSE ONE FORM IS NOT THE FORM. The braced arm catches
    // `import { useFillPath } from "…"`, and `\buseFillPath\b` rather than a substring
    // match, because `useFillPathSelection` contains the withdrawn name and is a
    // legitimate import in this very directory. The namespace arm catches the route the
    // first one cannot see: a star import of the package bound to a local name, followed
    // by a member read of the withdrawn hook off that binding, which reaches the same
    // function through a path the braced pattern never looks at. The form is not spelled
    // out here, because this file is itself inside the sweep and a worked example in a
    // comment IS an offender, which is how the arm was first seen red. The docblock
    // above says "any specifier" and used to mean "any module path"; it means both now.
    const braced =
      /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']([^"']*@numisma\/components[^"']*)["']/g;
    const namespaced =
      /import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s*from\s*["']([^"']*@numisma\/components[^"']*)["']/g;
    const files = consumerFiles(REPO_ROOT);
    // FALSE-PASS FLOOR. An empty file list produces an empty offender list and this case
    // reports green having read nothing, which is how a moved workspace or a broken
    // `REPO_ROOT` would look. Both sibling sweeps written in this wave carry one:
    // `started-ladder.fixtures.test.ts` for its routes directory, and
    // `client-bundle.integration.test.ts` for its token list. The number is a floor and
    // not a census: it may be raised, and it goes red rather than drifting quietly down.
    expect(files.length).toBeGreaterThan(20);

    const offenders = files.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      const where = relative(REPO_ROOT, file);
      return [
        ...[...source.matchAll(braced)]
          .filter(([, names]) => /\buseFillPath\b/.test(names!))
          .map(([, , specifier]) => `${where} imports it from "${specifier}"`),
        ...[...source.matchAll(namespaced)]
          .filter(([, binding]) =>
            new RegExp(`\\b${binding!}\\s*\\.\\s*useFillPath\\b`).test(source),
          )
          .map(
            ([, binding, specifier]) =>
              `${where} reads it as \`${binding}.useFillPath\` off "${specifier}"`,
          ),
      ];
    });
    expect(offenders).toEqual([]);
  });

  it("still reaches the hook internally, which is what makes the withdrawal free", () => {
    // The four parts read it directly. If the withdrawal had deleted the hook
    // rather than unpublishing it, the package would not compile — but a test
    // that only checks the index is absent would report success either way.
    const module = readFileSync(join(PACKAGE_SRC, "ui", "fill-path.tsx"), "utf8");
    expect(module).toMatch(/export function useFillPath\(/);
    const index = readFileSync(join(PACKAGE_SRC, "index.ts"), "utf8");
    expect(index).not.toMatch(/^\s*useFillPath,\s*$/m);
  });
});
