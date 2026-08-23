import { posix } from "node:path";

/**
 * THE TWO TEXT REWRITES the scripted `shadcn add` path applies to every file
 * the CLI places under `packages/components/src`. Pure functions on purpose:
 * the script that calls them touches the network, spawns a CLI and edits a
 * tsconfig, and none of that is testable, while these two are the part that is
 * actually easy to get wrong.
 *
 * Both are IDEMPOTENT. `ops/components/shadcn-add.ts` is re-runnable — a
 * component gets re-added whenever upstream changes — and a second pass that
 * double-prefixed a var read would emit `--nms-nms-muted`: a name no consumer
 * defines, no build reports, and that computes to transparent at runtime.
 */

/**
 * Import specifiers written against the `@/` alias, in every position the
 * shadcn registry emits: `import … from`, a bare side-effect `import`,
 * `export … from`, a dynamic `import()`, and `require()`.
 *
 * Anchored on the keyword rather than on the string alone, so a `@/`-looking
 * substring inside a class name or a comment is left where it is.
 */
const ALIAS_SPECIFIER =
  /((?:from|import|export)\s+|import\s*\(\s*|require\(\s*)(["'])@\/([^"']+)\2/g;

/** A `var()` read of a custom property, capturing the padding to preserve it. */
const VAR_READ = /var\(\s*--(?!nms-)(?!tw-)([\w-]+)/g;

/** Every `var()` read, namespaced or not. */
const ANY_VAR_READ = /var\(\s*(--[\w-]+)/g;

/**
 * A Tailwind arbitrary-property class that DEFINES a custom property —
 * `[--radius:0.5rem]`. Not a read, so the namespacing rewrite cannot see it.
 */
const CUSTOM_PROPERTY_DECLARATION = /\[\s*(--[\w-]+)\s*:/g;

/** The prefix every custom property this package reads must carry. */
export const NMS_PREFIX = "--nms-";

/**
 * Rewrite `@/…` specifiers to relative, extensionless ones.
 *
 * `dirWithinSrc` is the placed file's directory relative to
 * `packages/components/src` — `"ui"` for `src/ui/button.tsx`, `""` for a file
 * at the root of `src`. The alias base is `src` itself, so `@/lib/utils` from
 * `ui/` is `../lib/utils`.
 *
 * NO EXTENSION, EVER. The package is `moduleResolution: "Bundler"`, unlike
 * `@numisma/engine`'s NodeNext, so a `.js` specifier here is a typecheck
 * failure rather than the convention it is one package over.
 */
export function relativizeAliasImports(
  text: string,
  dirWithinSrc: string,
): string {
  return text.replace(
    ALIAS_SPECIFIER,
    (_match, keyword: string, quote: string, target: string) => {
      const relative = posix.relative(dirWithinSrc, target);
      const specifier = relative.startsWith(".") ? relative : `./${relative}`;
      return `${keyword}${quote}${specifier}${quote}`;
    },
  );
}

/**
 * Prefix every bare custom-property read into the `--nms-` namespace.
 *
 * NOT RESTRICTED TO COLOUR NAMES. `--radius-md` is a token — Button reads it in
 * four size variants — and it sits in Tailwind's own `--radius-*` namespace, so
 * a rewriter that matched a list of shadcn colour roles would leave four silent
 * holes behind. Anything that is not already ours and is not Tailwind's own
 * `--tw-*` internals gets the prefix.
 */
export function namespaceVarReads(text: string): string {
  return text.replace(VAR_READ, (match, name: string) =>
    match.replace(`--${name}`, `${NMS_PREFIX}${name}`),
  );
}

/** Every custom property read via `var()` in a file's text, in source order. */
export function varReads(text: string): string[] {
  return [...text.matchAll(ANY_VAR_READ)].map((match) => match[1]!);
}

/**
 * Custom properties a file DECLARES outside the namespace, via Tailwind's
 * arbitrary-property syntax.
 *
 * The script refuses on any hit rather than guessing. Namespacing a declaration
 * alongside its reads is one defensible answer and leaving both bare is
 * another; picking silently produces a component that declares `--radius` and
 * reads `--nms-radius`, which looks right in the built CSS and computes to
 * nothing. Nothing in the current set does this — it is the case the author of
 * the next component decides.
 */
export function bareCustomPropertyDeclarations(text: string): string[] {
  return [...text.matchAll(CUSTOM_PROPERTY_DECLARATION)]
    .map((match) => match[1]!)
    .filter((name) => !name.startsWith(NMS_PREFIX) && !name.startsWith("--tw-"));
}
