import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PACKAGE_ROOT } from "./package-source.ts";
import { withPaths, withoutPaths } from "./tsconfig-paths.ts";

const REAL = readFileSync(join(PACKAGE_ROOT, "tsconfig.json"), "utf8");

describe("the temporary alias mapping", () => {
  it("puts the mapping inside compilerOptions", () => {
    const injected = withPaths(REAL);
    expect(injected).toContain('"paths": { "@/*": ["./src/*"] }');
    expect(injected.indexOf('"paths"')).toBeGreaterThan(
      injected.indexOf('"compilerOptions"'),
    );
  });

  it("restores the file byte-for-byte", () => {
    // The strip runs in a `finally`. If it were not the exact inverse, a failed
    // add would leave the shipped package carrying `paths` — and the package
    // would stop proving its own self-containment on typecheck, quietly.
    expect(withoutPaths(withPaths(REAL))).toBe(REAL);
  });

  it("is idempotent in both directions", () => {
    expect(withPaths(withPaths(REAL))).toBe(withPaths(REAL));
    expect(withoutPaths(REAL)).toBe(REAL);
  });

  it("refuses a paths block it did not write", () => {
    const foreign = REAL.replace(
      '"compilerOptions": {\n',
      '"compilerOptions": {\n    "paths": { "~/*": ["./elsewhere/*"] },\n',
    );
    expect(() => withPaths(foreign)).toThrow(/already declares/);
  });

  it("ships with no paths of its own", () => {
    // Seam A, asserted against the real file: this is the property the whole
    // inject/strip dance exists to preserve.
    expect(REAL).not.toContain('"paths"');
    expect(REAL).not.toContain('"baseUrl"');
  });
});
