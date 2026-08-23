import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * THE TWO TRAPS THE SCRIPT EXISTS TO CATCH, each one a failure that reports
 * success at the time and costs a session later.
 */

/**
 * TRAP ONE: `shadcn add` with no tsconfig `paths` mapping resolves the `@`
 * alias to a literal directory. It creates `packages/components/@/ui/thing.tsx`
 * and prints the same success it prints when it works.
 *
 * Returns the offending path, or null. Looks in the package root and in `src`,
 * the two places the CLI has been observed to root it.
 */
export function findAtDirectory(packageRoot: string): string | null {
  for (const candidate of [join(packageRoot, "@"), join(packageRoot, "src", "@")]) {
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      return candidate;
    }
  }
  return null;
}

/** What the operator is told when trap one fires. */
export function atDirectoryMessage(path: string): string {
  return [
    `A directory literally named \`@\` exists at ${path}.`,
    "",
    "That is `shadcn add` resolving the `@/…` alias as a relative path because",
    "the tsconfig `paths` mapping was not in place when it ran. The CLI reports",
    "success and the component is in the wrong place, importing specifiers that",
    "resolve to nothing.",
    "",
    "Delete the directory and re-run `pnpm components:add <component>`, which",
    "injects the mapping for the duration of the add and strips it again after.",
  ].join("\n");
}

/**
 * TRAP TWO: the wrong `style` in `components.json` pulls a different primitive
 * library into the package. The CLI's style families are `radix-*`, `base-*`
 * and `aria-*`; `new-york` is a radix style, and choosing it adds `radix-ui`
 * to the package's dependencies beside `@base-ui/react`.
 *
 * This package is `base-vega` and has exactly one primitive library. Any radix
 * dependency after an add means the pinned style did not take.
 */
export function radixDependencies(packageJson: unknown): string[] {
  const manifest = packageJson as Record<string, unknown>;
  const fields = ["dependencies", "devDependencies", "peerDependencies"];
  const names = fields.flatMap((field) => {
    const block = manifest[field];
    return block === null || typeof block !== "object" ? [] : Object.keys(block);
  });
  return [
    ...new Set(
      names.filter((name) => name === "radix-ui" || name.startsWith("@radix-ui/")),
    ),
  ].sort();
}

/** What the operator is told when trap two fires. */
export function radixDependencyMessage(names: readonly string[]): string {
  return [
    `The package now depends on ${names.join(", ")}.`,
    "",
    "@numisma/components is a `base-vega` package: Base UI, one primitive",
    "library. A radix dependency means the add ran against a radix style —",
    "check that `style` in packages/components/components.json is still",
    "`base-vega`, revert the manifest change, and re-run.",
  ].join("\n");
}
