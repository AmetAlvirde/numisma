import type { ParsedToken } from "./tokens-file.ts";

/**
 * THE CONSUMER REGISTRY, and the generator that writes each consumer's tokens
 * file.
 *
 * The package owns the token NAMES and ships no CSS, so the grayscale defaults
 * cannot live in the package. They are written into each consumer instead, as a
 * generated stylesheet, by `ops/components/shadcn-add.ts` on every add.
 *
 * ─── HOW A CONSUMER REGISTERS ITSELF ───────────────────────────────────────
 *
 * Add one entry to `TOKEN_CONSUMERS` below, then run `pnpm components:add`
 * (with no component argument — it regenerates without touching the network):
 *
 *     { label: "apps/web", tokensFile: "apps/web/src/nms-tokens.generated.css" }
 *
 * `tokensFile` is repo-relative and the generator OWNS it: it is created if
 * absent and overwritten in full on every run. Point it at a path nothing else
 * writes, import it from the consumer's own stylesheet, and never edit it.
 *
 * A CONSUMER OVERRIDES BY DEFINING `--nms-*` AT ITS OWN `:root`, in its own
 * hand-written CSS, loaded after this file. It never edits the generated
 * defaults — an override is meant to be an intentional, greppable act in the
 * consumer's own source, and an edit here disappears on the next add with no
 * error.
 *
 * THE LIST IS LEGITIMATELY EMPTY. Nothing consumes the package yet; `apps/web`
 * mounts Tailwind in Slice 3 and `apps/workbench` does not exist until Slice 6.
 * The generator writes nothing and exits 0, because "no consumers" is the
 * project's real state rather than a fault.
 */

/** One consumer of the token spec, and the file the generator owns inside it. */
export interface TokenConsumer {
  /** How the consumer is named in the script's output. Usually its app path. */
  readonly label: string;
  /** Repo-relative path to the generated stylesheet. Overwritten every run. */
  readonly tokensFile: string;
}

/** Every consumer of `@numisma/components`. See the header to add one. */
export const TOKEN_CONSUMERS: readonly TokenConsumer[] = [];

/** The banner every generated tokens file carries. */
const HEADER = [
  "/*",
  " * GENERATED FILE — do not edit.",
  " *",
  " * Written by ops/components/shadcn-add.ts from the token spec in",
  " * packages/components/src/tokens.ts. Every hand edit here is lost, silently,",
  " * on the next component add.",
  " *",
  " * These are the package's grayscale defaults, its base mode. To override one,",
  " * define the same --nms-* name at your own :root in your own stylesheet,",
  " * loaded after this file. Do not change a value below.",
  " */",
].join("\n");

/** A `--nms-*` name defined in a CSS text, in source order. */
export function parseDefinedTokenNames(css: string): string[] {
  return [...css.matchAll(/^\s*(--nms-[\w-]+)\s*:/gm)].map((match) => match[1]!);
}

/** The full text of a consumer's generated tokens stylesheet. */
export function consumerTokensCss(tokens: readonly ParsedToken[]): string {
  const declarations = tokens
    .map((token) => `  ${token.name}: ${token.value};`)
    .join("\n");
  return `${HEADER}\n\n:root {\n${declarations}${declarations === "" ? "" : "\n"}}\n`;
}
