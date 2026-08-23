import { NMS_PREFIX, varReads } from "./rewrites.ts";

/**
 * WHICH TOKENS A PLACED COMPONENT NEEDS, and how they get folded into
 * `packages/components/src/tokens.ts` — a hand-written file with load-bearing
 * prose that this module must edit without disturbing.
 *
 * A COMPONENT REACHES A TOKEN TWO WAYS, and only one of them is visible as a
 * `var()` read:
 *
 *   1. Bare, inside an arbitrary value — `rounded-[min(var(--nms-radius-md),8px)]`.
 *   2. Through a Tailwind theme utility — `bg-primary`, `border-ring`. No
 *      `var()` appears anywhere in the source, and the name is every bit as
 *      required: Tailwind 4 emits a utility only when its theme variable
 *      exists, so a missing one emits NO RULE and the build exits 0.
 *
 * Scanning for `var()` alone would therefore discover three of Button's twelve
 * tokens. The utility side has to be read off class names, which is why this
 * module carries a closed list of shadcn's role names rather than a pattern:
 * `bg-clip-padding` and `bg-primary` are the same shape, and only a list
 * separates them.
 *
 * That same list carries the grayscale defaults, which is deliberate — a role
 * this module cannot name is a role it has no default for, and the script
 * refuses on it rather than writing a placeholder value that would satisfy
 * `tokens.test.ts` and ship the wrong colour.
 */

/**
 * shadcn's role names, each with THE PACKAGE'S grayscale default — not
 * upstream's. Upstream's `neutral` base is already grayscale for every colour
 * role except `--destructive`, which ships red; shipping that red would be the
 * one place the package smuggled in a palette, so it is grey here too.
 *
 * The radius scale is in the same table because it is reached the same way and
 * needs a default the same way, and because `--radius-md` is the token that
 * proves the rewriter must not restrict itself to colours.
 */
export const SHADCN_TOKEN_DEFAULTS: Readonly<Record<string, string>> = {
  background: "oklch(1 0 0)",
  foreground: "oklch(0.145 0 0)",
  card: "oklch(1 0 0)",
  "card-foreground": "oklch(0.145 0 0)",
  popover: "oklch(1 0 0)",
  "popover-foreground": "oklch(0.145 0 0)",
  primary: "oklch(0.205 0 0)",
  "primary-foreground": "oklch(0.985 0 0)",
  secondary: "oklch(0.97 0 0)",
  "secondary-foreground": "oklch(0.205 0 0)",
  muted: "oklch(0.97 0 0)",
  "muted-foreground": "oklch(0.556 0 0)",
  accent: "oklch(0.97 0 0)",
  "accent-foreground": "oklch(0.205 0 0)",
  destructive: "oklch(0.45 0 0)",
  "destructive-foreground": "oklch(0.985 0 0)",
  border: "oklch(0.922 0 0)",
  input: "oklch(0.922 0 0)",
  ring: "oklch(0.708 0 0)",
  "chart-1": "oklch(0.646 0 0)",
  "chart-2": "oklch(0.6 0 0)",
  "chart-3": "oklch(0.398 0 0)",
  "chart-4": "oklch(0.828 0 0)",
  "chart-5": "oklch(0.769 0 0)",
  sidebar: "oklch(0.985 0 0)",
  "sidebar-foreground": "oklch(0.145 0 0)",
  "sidebar-primary": "oklch(0.205 0 0)",
  "sidebar-primary-foreground": "oklch(0.985 0 0)",
  "sidebar-accent": "oklch(0.97 0 0)",
  "sidebar-accent-foreground": "oklch(0.205 0 0)",
  "sidebar-border": "oklch(0.922 0 0)",
  "sidebar-ring": "oklch(0.708 0 0)",
  "radius-sm": "0.25rem",
  "radius-md": "0.375rem",
  "radius-lg": "0.5rem",
  "radius-xl": "0.75rem",
};

/** The Tailwind utility families that take a theme colour role as their value. */
const COLOUR_UTILITIES = [
  "bg",
  "text",
  "border",
  "ring",
  "outline",
  "fill",
  "stroke",
  "from",
  "via",
  "to",
  "divide",
  "placeholder",
  "decoration",
  "caret",
  "accent",
  "shadow",
];

/** `role` alternation, longest first so `primary-foreground` beats `primary`. */
const ROLES = Object.keys(SHADCN_TOKEN_DEFAULTS).sort(
  (a, b) => b.length - a.length,
);

/**
 * A theme utility naming a known role. The lookaround on each side keeps
 * `bg-primary-foreground` from reading as `bg-primary`, and keeps the family
 * from matching mid-word.
 */
const THEME_UTILITY = new RegExp(
  `(?<![\\w-])(?:${COLOUR_UTILITIES.join("|")})-(${ROLES.join("|")})(?![\\w-])`,
  "g",
);

/** The end of the `NMS_TOKENS` array literal — where a new entry is inserted. */
const ARRAY_CLOSE = "] as const satisfies readonly NmsToken[];";

/** One declared token, as parsed back out of `tokens.ts`. */
export interface ParsedToken {
  readonly name: string;
  readonly value: string;
}

/**
 * Every `--nms-*` token a file needs, in source order, each reported once.
 *
 * Runs AFTER the namespacing rewrite, so a bare `var(--muted)` is already
 * `var(--nms-muted)` by the time it is seen here.
 */
export function discoverTokenNames(text: string): string[] {
  const found: { index: number; name: string }[] = [];

  for (const match of text.matchAll(/var\(\s*(--[\w-]+)/g)) {
    const name = match[1]!;
    if (name.startsWith(NMS_PREFIX)) {
      found.push({ index: match.index, name });
    }
  }
  for (const match of text.matchAll(THEME_UTILITY)) {
    found.push({ index: match.index, name: `${NMS_PREFIX}${match[1]!}` });
  }

  found.sort((a, b) => a.index - b.index);
  return [...new Set(found.map((entry) => entry.name))];
}

/** The `--nms-*` names a whole set of files needs, deduplicated. */
export function discoverTokenNamesAcross(texts: readonly string[]): string[] {
  return [...new Set(texts.flatMap(discoverTokenNames))];
}

/** The name/value pairs currently declared in a `tokens.ts` source text. */
export function parseTokenDeclarations(tokensTs: string): ParsedToken[] {
  return [
    ...tokensTs.matchAll(
      /name:\s*"(--nms-[\w-]+)",\s*\n\s*value:\s*"([^"]*)"/g,
    ),
  ].map((match) => ({ name: match[1]!, value: match[2]! }));
}

/** What a merge did, so the script can report it and refuse on `unknown`. */
export interface TokenMerge {
  /** The new `tokens.ts` text. Byte-identical to the input when nothing is new. */
  readonly text: string;
  /** Names appended by this merge. */
  readonly added: readonly string[];
  /** Names with no known grayscale default. Written nowhere; the script exits. */
  readonly unknown: readonly string[];
}

/**
 * Fold newly discovered names into `tokens.ts`, leaving every existing entry
 * and every line of the file's prose untouched.
 *
 * Idempotent: a name already declared is not re-added, which is what keeps a
 * second `shadcn add` of the same component from growing the array.
 *
 * `origin` names what brought the token in — the component argument the script
 * was run with. The generated `note` says so, because a note is the one field a
 * human has to finish and the file's own header demands it say what reads it.
 */
export function mergeTokenDeclarations(
  tokensTs: string,
  names: readonly string[],
  origin: string,
): TokenMerge {
  const declared = new Set(
    parseTokenDeclarations(tokensTs).map((token) => token.name),
  );
  const missing = names.filter((name) => !declared.has(name));
  const unknown = missing.filter(
    (name) => SHADCN_TOKEN_DEFAULTS[name.slice(NMS_PREFIX.length)] === undefined,
  );
  const added = missing.filter((name) => !unknown.includes(name));

  if (added.length === 0) return { text: tokensTs, added: [], unknown };

  const entries = added
    .map((name) => {
      const value = SHADCN_TOKEN_DEFAULTS[name.slice(NMS_PREFIX.length)]!;
      return [
        `  {`,
        `    name: "${name}",`,
        `    value: "${value}",`,
        `    note: "Added with ${origin} by ops/components/shadcn-add.ts. Say what reads it.",`,
        `  },`,
        ``,
      ].join("\n");
    })
    .join("");

  const close = tokensTs.lastIndexOf(ARRAY_CLOSE);
  if (close === -1) {
    throw new Error(
      `tokens.ts does not end its NMS_TOKENS array with \`${ARRAY_CLOSE}\`, ` +
        `so there is nowhere to insert ${added.join(", ")}. Add the names by hand.`,
    );
  }

  return {
    text: tokensTs.slice(0, close) + entries.trimEnd() + "\n" + tokensTs.slice(close),
    added,
    unknown,
  };
}
