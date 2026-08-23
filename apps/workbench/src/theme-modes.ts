import { NMS_TOKENS } from "@numisma/components";

/**
 * THE THREE MODES, AS DATA (spec #412 §10 Q2; issue #418).
 *
 * A component-level review asks three different questions and they need three
 * different backdrops. One "theme" would answer whichever question its palette
 * happened to serve and quietly refuse the other two.
 *
 * WHY THIS IS DATA AND NOT CSS. App mode has to come from `apps/web` without
 * the workbench importing anything from `apps/web` — that is Seam D, and it is
 * what makes the workbench a diagnostic instrument rather than a second view of
 * the app. Tokens are data and cross that seam as a copy; the app's CSS is a
 * cascade with linked stylesheets and a `layer()` asymmetry in it, and does
 * not. `app-token-drift.test.ts` reads `styles.css` off disk on every run and
 * fails the moment the copy stops matching.
 *
 * HOW A MODE IS APPLIED: `cosmos.decorator.tsx` writes these names as INLINE
 * CUSTOM PROPERTIES ON THE RENDERER DOCUMENT'S ROOT ELEMENT. That placement is
 * load-bearing and the reason is subtle — see the decorator's header before
 * moving it to a wrapper element.
 */

/** Which question the mode answers. Ordered as the switcher offers them. */
export type ThemeModeId = "grayscale" | "themed" | "app";

/** One mode: what to call it, why it exists, and the tokens it sets. */
export interface ThemeMode {
  readonly id: ThemeModeId;
  /** How the mode reads in the Cosmos control panel. */
  readonly label: string;
  /** The question this mode is for, in one line. */
  readonly blurb: string;
  /** `--nms-*` name to value. Written verbatim onto the root element. */
  readonly tokens: Readonly<Record<string, string>>;
}

/**
 * GRAYSCALE — THE PACKAGE'S OWN DEFAULTS, READ OFF THE PACKAGE.
 *
 * Not "some greys", and not a copy: `NMS_TOKENS` is the package's base mode and
 * this is that array turned into a lookup. A hand-written copy here would be a
 * second source of truth for the one thing the package unambiguously owns, and
 * it would disagree the first time a default moved.
 */
export const GRAYSCALE_TOKENS: Readonly<Record<string, string>> =
  Object.fromEntries(NMS_TOKENS.map((token) => [token.name, token.value]));

/**
 * THEMED — A DEMO PALETTE, DELIBERATELY NOT A HOUSE THEME.
 *
 * Its whole job is to make an UNEXERCISED TOKEN VISIBLE. Every declared token
 * gets a distinct, loud value, so switching into this mode should repaint every
 * role at once: a token whose colour does not appear anywhere on screen is a
 * token nothing in the fixture renders, and that absence is the finding.
 *
 * DISTINCTNESS IS THE CONTRACT, NOT THE TASTE. Two tokens sharing a value would
 * hide exactly that signal for both of them, which is why
 * `app-token-drift.test.ts` asserts the values are pairwise distinct and says
 * nothing about which colours they are. Ugly is fine here. Ambiguous is not.
 *
 * SCOPED TO THE PACKAGE'S DECLARED TOKENS, unlike app mode. A name the package
 * never declared cannot be an unexercised declared token, so it is out of this
 * mode's scope by definition.
 */
export const THEMED_TOKENS: Readonly<Record<string, string>> = {
  "--nms-background": "#fdf6ec",
  "--nms-foreground": "#1b1a17",
  "--nms-muted": "#ead9c0",
  "--nms-border": "#c9a86a",
  "--nms-input": "#8f6f2a",
  "--nms-primary": "#7a3ea1",
  "--nms-primary-foreground": "#fffbf5",
  "--nms-secondary": "#2c8c78",
  "--nms-secondary-foreground": "#f0fff9",
  "--nms-destructive": "#c62828",
  "--nms-ring": "#f2a516",
  "--nms-radius-md": "14px",
};

/**
 * APP — WHAT `apps/web` ACTUALLY PAINTS, CARRIED ACROSS THE SEAM AS VALUES.
 *
 * `styles.css` writes these as ALIASES (`--nms-background: var(--bg)`) so that
 * file stays the one place the app defines colour. The workbench has no `--bg`,
 * so what it carries is the RESOLVED value — the drift test walks the app's
 * alias chain to meet these literals, rather than comparing alias text that
 * would keep matching while the palette moved underneath it.
 *
 * FOURTEEN NAMES, WHERE THE PACKAGE DECLARES TWELVE. `--nms-card` and
 * `--nms-muted-foreground` are in spec §4.2 and in `styles.css`, and nothing in
 * the package reads them yet. They are carried anyway: the drift test mirrors
 * the app's block name-for-name, so these two are held honest from today rather
 * than from the day a component starts reading them. See that test's header for
 * the full argument and the cost.
 */
export const APP_TOKENS: Readonly<Record<string, string>> = {
  "--nms-background": "#0f1115",
  "--nms-foreground": "#e7e9ee",
  "--nms-card": "#181b22",
  "--nms-muted": "#14161c",
  "--nms-muted-foreground": "#9aa1ad",
  "--nms-border": "#262a33",
  "--nms-input": "#262a33",
  "--nms-primary": "#3b6cf0",
  "--nms-primary-foreground": "#ffffff",
  "--nms-secondary": "#262a33",
  "--nms-secondary-foreground": "#e7e9ee",
  "--nms-destructive": "#f0736a",
  "--nms-ring": "#3b6cf0",
  "--nms-radius-md": "8px",
};

/**
 * The modes, in the order the switcher offers them.
 *
 * GRAYSCALE IS FIRST AND THEREFORE THE DEFAULT, deliberately. A component
 * opened cold should be judged on hierarchy, spacing and state — the things a
 * component-level review is actually about — before palette gets a vote.
 * Opening in app mode would make every review a review of the app.
 */
export const THEME_MODES: readonly ThemeMode[] = [
  {
    id: "grayscale",
    label: "grayscale — package defaults",
    blurb: "Hierarchy, spacing and state, with no palette to argue about.",
    tokens: GRAYSCALE_TOKENS,
  },
  {
    id: "themed",
    label: "themed — every token distinct",
    blurb:
      "Every declared token a different colour. A role that does not repaint is a role nothing renders.",
    tokens: THEMED_TOKENS,
  },
  {
    id: "app",
    label: "app — apps/web values",
    blurb: "The component as apps/web will show it. Values copied, drift tested.",
    tokens: APP_TOKENS,
  },
];

/** The mode a fixture opens in. See `THEME_MODES` for why it is grayscale. */
export const DEFAULT_THEME_MODE: ThemeModeId = "grayscale";

/** A mode by id, falling back to the default rather than rendering untokened. */
export function themeModeById(id: string): ThemeMode {
  return (
    THEME_MODES.find((mode) => mode.id === id) ??
    THEME_MODES.find((mode) => mode.id === DEFAULT_THEME_MODE)!
  );
}
