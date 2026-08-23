/**
 * THE TOKEN SPECIFICATION. The package owns the names; the consumer owns the
 * values.
 *
 * `@numisma/components` ships no CSS — no stylesheet, no `@theme` block, no
 * token file — because the consumer owns the palette. The cost of that is two
 * silent failures, and this file is what makes both of them testable.
 *
 * FAILURE ONE: a missing theme variable emits NO RULE AT ALL. Tailwind 4 emits
 * a utility only when its theme variable exists, so with no `--color-primary`
 * the class `bg-primary` is absent from the built stylesheet entirely. No
 * error, no warning, no empty rule, and the build exits 0.
 *
 * FAILURE TWO: a missing bare custom property emits a CORRECT-LOOKING RULE THAT
 * COMPUTES TO NOTHING. Components read bare custom properties inside arbitrary
 * values — Button's secondary hover is
 * `bg-[color-mix(in_oklch,var(--nms-secondary),var(--nms-foreground)_5%)]` —
 * and those `var()` lookups resolve against `--nms-secondary`, not
 * `--color-nms-secondary`. When one misses, `color-mix` gets an undefined
 * argument and the declaration computes to transparent while the rule sits
 * present and correct in the stylesheet.
 *
 * The two look nothing alike and demand opposite diagnostics: grepping built
 * CSS proves scanning and says nothing about theming, and only computed style
 * in a real browser separates them.
 *
 * WHY `--nms-` AND NOT THE BARE shadcn NAMES. A consumer that already defines
 * `--muted` for its own hand-written CSS would have a shadcn component read it
 * by accident — capture, not design, and it works right up until the day the
 * consumer's grey is not the shadcn grey. The prefix makes every read this
 * package performs land in a namespace no one else writes into, so an override
 * is an intentional act. It kills the whole collision class rather than the one
 * name that happens to collide today.
 *
 * WHY THE DEFAULTS ARE GRAYSCALE, ON PURPOSE. A component reviewed against the
 * package's own defaults is reviewed on hierarchy, spacing and state — not on
 * palette. These values are the package's base mode, never a house theme.
 *
 * HOW A CONSUMER WIRES IT. It defines every `--nms-*` name below at its own
 * `:root`, then maps Tailwind's namespace onto this one so a theme utility
 * (`bg-primary`) and a bare read (`var(--nms-primary)`) resolve to the same
 * value:
 *
 *     @theme {
 *       --color-primary: var(--nms-primary);
 *       --color-muted:   var(--nms-muted);
 *     }
 *
 * READ OFF COMPONENT SOURCE, NOT PASTED FROM AN UPSTREAM THEME. Every name here
 * is one this package's components actually read — as a Tailwind theme utility
 * (`bg-primary`, `border-ring`) or as a bare `var()` inside an arbitrary value.
 * A shadcn theme carries dozens more (`--card`, `--popover`, `--sidebar`, …);
 * none of them are here, because nothing in this package reads them, and a
 * token a consumer is asked to define but nothing renders is a token nobody can
 * verify. Add a name here when a component starts reading it, not before.
 */

/**
 * One declared token: the CSS custom property this package reads, the grayscale
 * default that defines it in the package's base mode, and what it is for.
 */
export interface NmsToken {
  /** The custom property name, always `--nms-`-prefixed. */
  readonly name: `--nms-${string}`;
  /** The package's grayscale default. Consumers override; nothing here does. */
  readonly value: string;
  /** What reads it, in one line. */
  readonly note: string;
}

/**
 * The specification. Ordered by role, not alphabetically: surfaces, then text,
 * then the interactive roles, then geometry.
 */
export const NMS_TOKENS = [
  {
    name: "--nms-background",
    value: "oklch(1 0 0)",
    note: "Page/base surface. Button `outline` sits on it.",
  },
  {
    name: "--nms-foreground",
    value: "oklch(0.145 0 0)",
    note: "Primary text. Also read bare in Button's secondary hover mix.",
  },
  {
    name: "--nms-muted",
    value: "oklch(0.97 0 0)",
    note: "Recessed surface. Button `ghost` and `outline` hover.",
  },
  {
    name: "--nms-border",
    value: "oklch(0.922 0 0)",
    note: "Hairline between surfaces. Button `outline`'s edge.",
  },
  {
    name: "--nms-input",
    value: "oklch(0.922 0 0)",
    note: "Field edge and dark-mode field fill on Button `outline`.",
  },
  {
    name: "--nms-primary",
    value: "oklch(0.205 0 0)",
    note: "The one emphasised action. Button `default` fill, `link` text.",
  },
  {
    name: "--nms-primary-foreground",
    value: "oklch(0.985 0 0)",
    note: "Text on `--nms-primary`.",
  },
  {
    name: "--nms-secondary",
    value: "oklch(0.97 0 0)",
    note: "The quieter action. Button `secondary` fill, read bare in its hover mix.",
  },
  {
    name: "--nms-secondary-foreground",
    value: "oklch(0.205 0 0)",
    note: "Text on `--nms-secondary`.",
  },
  {
    name: "--nms-destructive",
    value: "oklch(0.45 0 0)",
    note: "The destructive role. Button `destructive`, and every `aria-invalid` ring in the package. Grayscale here on purpose: upstream ships this red, and shipping the red would be the one place the package smuggled in a palette.",
  },
  {
    name: "--nms-ring",
    value: "oklch(0.708 0 0)",
    note: "Focus ring. The one token whose absence is a keyboard-accessibility defect.",
  },
  {
    name: "--nms-radius-md",
    value: "0.375rem",
    note: "Corner radius. Read bare by Button's small sizes, which clamp against it.",
  },
] as const satisfies readonly NmsToken[];

/** Every declared token name. The list a consumer's CSS is checked against. */
export const NMS_TOKEN_NAMES: readonly string[] = NMS_TOKENS.map(
  (token) => token.name,
);

/** The prefix every custom property this package reads must carry. */
export const NMS_PREFIX = "--nms-";
