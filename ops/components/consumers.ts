import { customPropertyNames } from "./css-custom-properties.ts";
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
 * hand-written CSS, which must WIN THE CASCADE against this file — either by
 * loading after it, or by staying unlayered while this file is imported into a
 * cascade layer, which is how `apps/web` does it. It never edits the generated
 * defaults — an override is meant to be an intentional, greppable act in the
 * consumer's own source, and an edit here disappears on the next add with no
 * error.
 *
 * AN EMPTY LIST IS STILL A LEGAL STATE. The generator writes nothing and exits
 * 0 rather than treating "no consumers" as a fault — that was the project's
 * real state until `apps/web` mounted Tailwind, and `apps/workbench` does not
 * exist until Slice 6.
 */

/** One consumer of the token spec, and the file the generator owns inside it. */
export interface TokenConsumer {
  /** How the consumer is named in the script's output. Usually its app path. */
  readonly label: string;
  /** Repo-relative path to the generated stylesheet. Overwritten every run. */
  readonly tokensFile: string;
}

/** Every consumer of `@numisma/components`. See the header to add one. */
export const TOKEN_CONSUMERS: readonly TokenConsumer[] = [
  // Imported by `apps/web/src/tailwind.css`, the app's Tailwind entry, which
  // `__root.tsx` links as a SECOND stylesheet AFTER `styles.css`. That order is
  // why the import carries `layer(theme)`: `styles.css` is unlayered, unlayered
  // beats every cascade layer, and so the app's own `--nms-*` aliases win from
  // `styles.css`'s `:root` in Slice 5 even though they are declared earlier in
  // document order. Unlayered here would make the defaults beat the app.
  { label: "apps/web", tokensFile: "apps/web/src/nms-tokens.generated.css" },

  // Imported by `apps/workbench/src/tailwind.css`, the workbench's own Tailwind
  // entry. THE SECOND CONSUMER, and Seam D: react-cosmos, no SSR, and no import
  // from `apps/web`. The layering story is simpler here than above — the
  // workbench has no hand-written stylesheet to lose to — but the import still
  // carries `layer(theme)`, because the three-mode decorator overrides these
  // names as INLINE style on the root element and inline beats every layer.
  { label: "apps/workbench", tokensFile: "apps/workbench/src/nms-tokens.generated.css" },
];

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
  " * define the same --nms-* name at your own :root in your own stylesheet, and",
  " * make sure that stylesheet WINS THE CASCADE against this one — it loads after",
  " * this file, or this file is imported into a cascade layer and yours is not.",
  " * Do not change a value below.",
  " */",
].join("\n");

/**
 * A `--nms-*` name defined in a CSS text, in source order.
 *
 * The syntax parse lives in `./css-custom-properties.ts` and is shared with the
 * consumer-side guards, which ask the same question of the same files. Three
 * regexes over one syntax is three chances to disagree about it.
 */
export function parseDefinedTokenNames(css: string): string[] {
  return customPropertyNames(css).filter((name) => name.startsWith("--nms-"));
}

/** The full text of a consumer's generated tokens stylesheet. */
export function consumerTokensCss(tokens: readonly ParsedToken[]): string {
  const declarations = tokens
    .map((token) => `  ${token.name}: ${token.value};`)
    .join("\n");
  return `${HEADER}\n\n:root {\n${declarations}${declarations === "" ? "" : "\n"}}\n`;
}
