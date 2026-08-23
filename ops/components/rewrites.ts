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

/**
 * A CUSTOM-PROPERTY READ HAS TWO SYNTAXES, AND ONLY ONE OF THEM WRITES `var(`.
 *
 * Tailwind 4 shortens `bg-[var(--muted)]` to `bg-(--muted)`, with an optional
 * data-type hint — `w-(length:--sidebar-width)`, `bg-(color:--accent)`. Both
 * compile to the same declaration; verified against the pinned tailwindcss
 * 4.3.3, `.bg-\(--muted\)` emits `background-color: var(--muted)`. No `var(`
 * appears anywhere in the source.
 *
 * ANYTHING HERE THAT MATCHES ONE FORM AND NOT THE OTHER IS A HOLE, not a
 * narrower guard: the rewrite silently no-ops, the standing namespace guard in
 * `nms-namespace.test.ts` reports nothing, and the package ships a bare read of
 * whatever the consumer happens to call `--muted` — which in `apps/web` is a
 * secondary TEXT grey, so the render looks plausible. Not hypothetical:
 * `base-vega`'s `sidebar` and `chart` ship the shorthand today, so
 * `pnpm components:add sidebar` reaches it.
 *
 * THE SHORTHAND IS ANCHORED ON `-(`, the utility separator, because that is the
 * only thing that distinguishes it from an ordinary parenthesis. The cost is
 * that JavaScript's `a-(--b)` — subtract a pre-decrement, written without
 * spaces — would be namespaced too. That has never appeared in placed shadcn
 * source and the alternative is missing the syntax entirely.
 */
const READ = String.raw`var\(\s*(NAME)|-\((?:[\w-]+:)?(NAME)\)`;

/** Both read syntaxes, restricted to names that are not already ours. */
const BARE_READ = new RegExp(
  READ.replaceAll("NAME", String.raw`--(?!nms-)(?!tw-)[\w-]+`),
  "g",
);

/** Both read syntaxes, namespaced or not. */
const ANY_READ = new RegExp(READ.replaceAll("NAME", String.raw`--[\w-]+`), "g");

/**
 * A file DECLARES a custom property by two routes as well, and the namespacing
 * rewrite can see neither:
 *
 *   1. Tailwind's arbitrary-property class — `[--radius:0.5rem]`.
 *   2. A JSX inline style object — `style={{ "--sidebar-width": w }}`, which is
 *      how `base-vega`'s sidebar declares all three of its widths.
 *
 * The second route was the gap. Read namespaced, declaration left bare, and the
 * script produced exactly the split its own refusal message describes.
 */
const CUSTOM_PROPERTY_DECLARATION =
  /\[\s*(--[\w-]+)\s*:|(["'])(--[\w-]+)\2\s*\]?\s*:/g;

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
 *
 * BOTH READ SYNTAXES, for the reason `READ` above gives at length: matching
 * `var(` alone leaves `bg-(--muted)` bare with every guard green.
 */
export function namespaceCustomPropertyReads(text: string): string {
  return text.replace(
    BARE_READ,
    (match, viaVar: string | undefined, viaShorthand: string | undefined) => {
      const name = (viaVar ?? viaShorthand)!;
      return match.replace(name, `${NMS_PREFIX}${name.slice("--".length)}`);
    },
  );
}

/**
 * Every custom property a file's text reads, by either syntax, in source order.
 *
 * The standing namespace guard runs on this list, so a read it cannot see is a
 * read nothing in the repo reports.
 */
export function customPropertyReads(text: string): string[] {
  return customPropertyReadMatches(text).map((read) => read.name);
}

/** One custom-property read, with where in the text it was found. */
export interface CustomPropertyRead {
  /** The property name, including the leading `--`. */
  readonly name: string;
  /** Offset of the match in the text, for callers that order by source. */
  readonly index: number;
}

/**
 * The same reads, positioned — `discoverTokenNames` interleaves them with theme
 * utilities and reports the merged list in source order, so it needs the offset
 * as well as the name. ONE PARSE FOR BOTH CALLERS: a second regex over this
 * syntax is a second chance to disagree about it, which is exactly how the
 * shorthand form came to be seen by neither.
 */
export function customPropertyReadMatches(text: string): CustomPropertyRead[] {
  return [...text.matchAll(ANY_READ)].map((match) => ({
    name: (match[1] ?? match[2])!,
    index: match.index,
  }));
}

/**
 * Custom properties a file DECLARES outside the namespace, by either route —
 * Tailwind's arbitrary-property class or a JSX inline style object.
 *
 * The script refuses on any hit rather than guessing. Namespacing a declaration
 * alongside its reads is one defensible answer and leaving both bare is
 * another; picking silently produces a component that declares `--radius` and
 * reads `--nms-radius`, which looks right in the built CSS and computes to
 * nothing. Nothing in the current set does this — it is the case the author of
 * the next component decides, and `base-vega`'s sidebar is the one that will
 * put it to them: three widths declared in `style={{…}}` and two of them read
 * back as `var()` inside class strings.
 */
export function bareCustomPropertyDeclarations(text: string): string[] {
  return [...text.matchAll(CUSTOM_PROPERTY_DECLARATION)]
    .map((match) => (match[1] ?? match[3])!)
    .filter((name) => !name.startsWith(NMS_PREFIX) && !name.startsWith("--tw-"));
}
