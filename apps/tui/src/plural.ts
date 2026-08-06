/**
 * COUNT AND NOUN, AGREEING — the one place this app spells the `-s`.
 *
 * It is here rather than inline because the shape had already been written three times
 * (`spine.ts`'s ingest line twice, the orders refusal once) and every copy is a chance for
 * one operator-facing line to read "1 rungs". The output is byte-identical to the inline
 * form it replaces: `count`, a space, the noun, and an `s` unless the count is exactly one.
 *
 * IRREGULAR PLURALS ARE OUT OF SCOPE, deliberately. This app's countable nouns are
 * `rung`, `reserve`, `transaction`, `duplicate` — all regular — and a lookup table for
 * plurals nobody counts would be machinery guarding nothing. A caller that needs one
 * should write the literal rather than teach this function a rule with one user.
 */
export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
