import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
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
