/**
 * THE INVERSION THE WHOLE SCRIPT IS BUILT AROUND. `shadcn add` needs a tsconfig
 * `paths` mapping to place files at the `@/` alias, and the shipped package must
 * not have one: with no `paths`, a stray `@/` specifier left behind by an add is
 * a typecheck failure rather than a silent bundler break, and the package proves
 * its own self-containment on every `pnpm typecheck` (Seam A).
 *
 * So the mapping exists for the duration of one CLI invocation and is stripped
 * again, byte-for-byte, whether the add succeeded or threw.
 *
 * TEXT, NOT `JSON.parse` + `JSON.stringify`. A round-trip through the parser
 * would reformat a hand-written config and drop the comments this repo puts in
 * its tsconfigs. These two functions are each other's exact inverse instead, and
 * a test holds that.
 */

/** The lines injected, verbatim. `withoutPaths` removes exactly this text. */
const BLOCK =
  '    "baseUrl": ".",\n    "paths": { "@/*": ["./src/*"] },\n';

/** Where the block goes: immediately inside `compilerOptions`. */
const ANCHOR = '"compilerOptions": {\n';

/** The package tsconfig with the alias mapping in place. Idempotent. */
export function withPaths(tsconfig: string): string {
  if (tsconfig.includes(BLOCK)) return tsconfig;
  if (tsconfig.includes('"paths"')) {
    throw new Error(
      "packages/components/tsconfig.json already declares `paths`, in a shape " +
        "this script did not write. The shipped package is meant to have none " +
        "(Seam A). Resolve that by hand before running an add.",
    );
  }
  const anchor = tsconfig.indexOf(ANCHOR);
  if (anchor === -1) {
    throw new Error(
      "packages/components/tsconfig.json has no `\"compilerOptions\": {` line to " +
        "inject the alias mapping after.",
    );
  }
  const at = anchor + ANCHOR.length;
  return tsconfig.slice(0, at) + BLOCK + tsconfig.slice(at);
}

/** The package tsconfig with the alias mapping gone. Idempotent. */
export function withoutPaths(tsconfig: string): string {
  return tsconfig.replace(BLOCK, "");
}
