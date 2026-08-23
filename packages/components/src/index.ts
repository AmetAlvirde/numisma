/**
 * The curated public surface of `@numisma/components`.
 *
 * Named here one at a time, deliberately, rather than by a blanket `export *` —
 * the same discipline `@numisma/engine` keeps. What is absent is absent on
 * purpose.
 *
 * THE PACKAGE SHIPS UNBUILT TSX. There is no `dist`, no build script, and no
 * `main`. Consumers import this source and transform it with their own
 * toolchain, which is what lets a component's utility classes be scanned by
 * each consumer's Tailwind build. Adding a build step here would break that.
 *
 * THE PACKAGE SHIPS NO CSS. Not a stylesheet, not a `@theme` block, not a token
 * file. The consumer owns the palette.
 */

export { Button, buttonVariants } from "./ui/button";
export { cn } from "./lib/utils";
