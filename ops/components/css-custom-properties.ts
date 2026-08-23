/**
 * READING CUSTOM PROPERTIES OUT OF CSS TEXT — the one parse, shared.
 *
 * Three places in this repo need to know what a stylesheet DECLARES: the
 * generator, which reports the names it wrote into a consumer's tokens file;
 * `apps/web`'s token test, which checks the app took a position on every name
 * the package declares; and `apps/workbench`'s drift test, which mirrors the
 * app's VALUES and has to resolve the aliases the app writes them as. Each of
 * them grew its own regex, and three regexes over the same syntax is three
 * chances to disagree about it.
 *
 * DELIBERATELY A TEXT PARSE, NOT A CSS PARSE. The question asked here is "what
 * does this file say", which is what the guards want: a real CSS parser would
 * resolve `@import`s and cascade order and start answering "what does the
 * browser see", and that is the question the computed-style procedure exists to
 * answer instead. The two must not be conflated — see `tokens.ts` on the two
 * silent failures and the opposite instruments they demand.
 *
 * WHAT IT THEREFORE DOES NOT DO: honour specificity, media queries, or which
 * selector a declaration sits under. Every declaration in the text counts, in
 * source order, and a later one wins in `declarationMap`. That is sound for the
 * files it is pointed at — a `:root` block and a generated defaults file — and
 * unsound the moment someone points it at a stylesheet with themed variants.
 */

/** One custom-property declaration as it appears in the text. */
export interface CustomPropertyDeclaration {
  /** The property name, including the leading `--`. */
  readonly name: string;
  /** The declared value, trimmed, exactly as written. May be a `var()`. */
  readonly value: string;
}

/**
 * Every custom property the text DECLARES, in source order.
 *
 * Name-only, and separate from `customPropertyDeclarations` on purpose: this
 * one matches a declaration whether or not it carries a terminating semicolon,
 * so the last declaration in a block is never missed. The value-bearing form
 * below cannot make that promise, because without a `;` it has no way to know
 * where the value ends.
 */
export function customPropertyNames(css: string): string[] {
  return [...css.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((match) => match[1]!);
}

/** Every custom property with its declared value, in source order. */
export function customPropertyDeclarations(
  css: string,
): CustomPropertyDeclaration[] {
  return [...css.matchAll(/^\s*(--[\w-]+)\s*:\s*([^;]+);/gm)].map((match) => ({
    name: match[1]!,
    value: match[2]!.trim(),
  }));
}

/** Declarations as a lookup, later declarations winning over earlier ones. */
export function declarationMap(
  declarations: readonly CustomPropertyDeclaration[],
): Map<string, string> {
  return new Map(declarations.map(({ name, value }) => [name, value]));
}

/**
 * Follow a value through its `var()` aliases until it is a literal.
 *
 * `apps/web` declares its `--nms-*` overrides as ALIASES — `var(--bg)`, never
 * `#0f1115` — so that `styles.css` stays the one place colour is defined. A
 * consumer of those values (the workbench's app mode) needs what they resolve
 * to, which means walking the chain rather than reading one hop.
 *
 * Returns the value unchanged when it is already a literal, and gives up rather
 * than looping on a cycle or an undefined name — both of which are broken CSS
 * the caller should be able to see and assert on, not silently normalised away.
 */
export function resolveVarChain(
  value: string,
  lookup: ReadonlyMap<string, string>,
  maxHops = 10,
): string {
  let current = value;
  for (let hop = 0; hop < maxHops; hop += 1) {
    const alias = /^var\(\s*(--[\w-]+)\s*\)$/.exec(current);
    if (alias === null) return current;
    const next = lookup.get(alias[1]!);
    if (next === undefined || next === current) return current;
    current = next;
  }
  return current;
}
