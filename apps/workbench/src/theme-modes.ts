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
 * `--nms-neg` AND `--nms-destructive` ARE THE PAIR THIS RULE WAS WRITTEN FOR.
 * App mode resolves both to `#f0736a`, because `apps/web` aliases each onto
 * `--neg`, and a reviewer looking at app mode alone cannot tell whether a red
 * box read the sign token or the destructive one. Here they are a cyan and a
 * red, so the two roles come apart on screen in the one mode built to pull them
 * apart — which is the whole reason spec #432 §4.1 refused to weld the names.
 *
 * SCOPED TO THE PACKAGE'S DECLARED TOKENS, unlike app mode. A name the package
 * never declared cannot be an unexercised declared token, so it is out of this
 * mode's scope by definition.
 */
export const THEMED_TOKENS: Readonly<Record<string, string>> = {
  "--nms-background": "#fdf6ec",
  "--nms-card": "#ffd2f0",
  "--nms-foreground": "#1b1a17",
  "--nms-muted-foreground": "#5c7cff",
  "--nms-muted": "#ead9c0",
  "--nms-border": "#c9a86a",
  "--nms-input": "#8f6f2a",
  "--nms-primary": "#7a3ea1",
  "--nms-primary-foreground": "#fffbf5",
  "--nms-secondary": "#2c8c78",
  "--nms-secondary-foreground": "#f0fff9",
  "--nms-destructive": "#c62828",
  "--nms-neg": "#00e5ff",
  "--nms-pos": "#b026ff",
  "--nms-ok": "#00ff4c",
  "--nms-warn": "#ff00a8",
  "--nms-now": "#7cff00",
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
 * NINETEEN NAMES, MATCHING THE PACKAGE EXACTLY. Fifteen was wave 1's final
 * count; spec #439 S1 moved `SummaryCard` into the package reading `--nms-pos`,
 * `--nms-ok` and `--nms-warn`, and S5 moved `PriceDropPathChart` in reading
 * `--nms-now`. `styles.css` aliased each onto the house name it already had in
 * the same commit, so the two sides moved together every time. This
 * table carried fourteen once before, while `styles.css` defined `--nms-card`
 * and `--nms-muted-foreground`, two aliases spec #412 §4.2 minted for
 * components that had not arrived. Spec #420 S0 deleted both on the rule
 * `tokens.ts` already keeps: a token nothing reads is a token nothing can
 * verify, and app mode was carrying two values no fixture could ever show. Spec
 * #432 §4.1 then moved `Absent` into the package reading
 * `--nms-muted-foreground` and `Card` reading `--nms-card`, so both are back —
 * met precondition, not undone decision — and the snapshot notices minted
 * `--nms-neg` on top, which is a name this table never carried. The mirror is
 * what makes each of those a two-sided edit — the drift test below reads
 * `styles.css` off disk and reds if either side moves alone.
 *
 * `#9aa1ad` IS `--muted` RESOLVED, and it is the app's most-used grey. The alias
 * chain is `--nms-muted-foreground: var(--muted)` and `--muted: #9aa1ad`; the
 * drift test walks it. It is deliberately NOT `#14161c`, two rows below — that
 * is `--recess`, the recessed surface, and the two sitting near each other here
 * is the whole shape of the mistake that slice was cut to catch.
 *
 * `#181b22` IS `--card` RESOLVED, and it is the surface eight elements in the
 * app carry. It sits one step off `#0f1115`, the page, and the pair being that
 * close in app mode is the reason themed mode paints them nothing like each
 * other. The argument the drift test records as "the argument that lost" —
 * carry the alias early so app mode is already correct on arrival — stayed lost
 * for both names. What changed is the arrival, not the argument. Each name
 * landed in the slice that moved the component reading it, and the exact
 * spellings are reused on purpose, so the vocabulary stays one vocabulary
 * rather than growing a second name per role.
 *
 * `#46c98b`, `#1f7a4d` AND `#8a5a12` ARE THE CARD'S THREE, and the last two are
 * FILLS. `--nms-pos` is the rising P&L; `--nms-ok` and `--nms-warn` are the two
 * arms of the data-safety badge, which is why the fixture has to stage both
 * arms to show either. In themed mode they are a violet and two neons, loud on
 * purpose: a fill that does not change when the switcher moves is the loudest
 * possible way to say a token is not being read.
 *
 * `#e07a4f` IS `--now` RESOLVED, and it is the only value in this table that
 * belongs to one picture. The chart draws the spot rule, its end-anchored label
 * and the `Now` legend swatch with it, and nothing else in the app reads the
 * house colour it aliases. In themed mode it is a chartreuse, which is loud on
 * purpose for the reason the block above gives: this is the mint spec #439 S5
 * carried, and the gate check that cleared the chart for the workbench painted
 * these strokes INVISIBLE precisely because no `--nms-` name backed them yet.
 *
 * `#f0736a` IS `--neg` RESOLVED, AND IT APPEARS TWICE. `--nms-destructive` and
 * `--nms-neg` both alias onto `--neg` in `styles.css`, so app mode carries one
 * literal under two names and no guard objects: only themed mode asserts
 * pairwise distinctness, because only themed mode is the one whose job is
 * telling roles apart. Two names at one value is the state spec #432 §4.1 chose
 * on purpose — sign is data, destructive is intent — and it is the reason
 * themed mode paints them a cyan and a red.
 */
export const APP_TOKENS: Readonly<Record<string, string>> = {
  "--nms-background": "#0f1115",
  "--nms-card": "#181b22",
  "--nms-foreground": "#e7e9ee",
  "--nms-muted-foreground": "#9aa1ad",
  "--nms-muted": "#14161c",
  "--nms-border": "#262a33",
  "--nms-input": "#262a33",
  "--nms-primary": "#3b6cf0",
  "--nms-primary-foreground": "#ffffff",
  "--nms-secondary": "#262a33",
  "--nms-secondary-foreground": "#e7e9ee",
  "--nms-destructive": "#f0736a",
  "--nms-neg": "#f0736a",
  "--nms-pos": "#46c98b",
  "--nms-ok": "#1f7a4d",
  "--nms-warn": "#8a5a12",
  "--nms-now": "#e07a4f",
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
