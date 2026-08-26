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
 *
 * ── THE HOUSE VOCABULARY: TEN NAMES, DECIDED ONCE (spec #432 §4.2) ────────
 *
 * `apps/web` owns ten bare palette names. Each has exactly one counterpart in
 * this namespace, and the whole mapping is written here so a component crossing
 * into the package looks the name up rather than choosing it again. All ten are
 * declared below, and the vocabulary this table has carried since wave 1 is
 * closed.
 *
 *     house      package
 *     --bg       --nms-background
 *     --text     --nms-foreground
 *     --line     --nms-border
 *     --card     --nms-card
 *     --muted    --nms-muted-foreground
 *     --neg      --nms-neg
 *     --pos      --nms-pos
 *     --ok       --nms-ok
 *     --warn     --nms-warn
 *     --now      --nms-now
 *
 * NAMING BEFORE DECLARING WAS THE POINT, not a half-measure, and the status
 * column that recorded it has done its job and gone. Declaring a name early puts
 * a grayscale default and a distinct themed value in front of a reviewer for a
 * role nothing in this package renders, which is the state the rule above
 * refuses. All four names made the round trip in spec #439: three in S1, when
 * `SummaryCard` arrived reading them at once — `--nms-pos` on a rising P&L,
 * `--nms-ok` and `--nms-warn` on the two arms of its data-safety badge — and
 * `--nms-now` in S5, when `PriceDropPathChart` crossed reading it three times.
 * Naming them ahead of that cost nothing and settled the two mappings that are
 * genuinely hard, below, while the argument was still fresh.
 *
 * TWENTY NAMES, AND THE TWENTIETH HAS NO ROW IN THAT TABLE. `--nms-caution` is
 * spec #451 S3's mint, and the table above is closed because it maps the ten
 * bare names `apps/web` declared before the package existed. `--nms-caution`
 * has no such counterpart: the app had no colour for "the reading is withheld,
 * said as type", because it had been saying it in `--warn`, which is a fill.
 * `apps/web` mints `--caution` beside `--accent` and `--recess` and aliases onto
 * it, which is the same shape those two already have.
 *
 * SIX DEFAULTS BELOW MOVED IN THAT SLICE, and every one of them moved because
 * the guard measured it rather than because anyone looked at it. ADR-026 binds
 * this package as well as the app, `ops/components/contrast.test.ts` checks
 * these values as one of its two palettes, and the base mode is what an
 * unconfigured consumer renders on a real screen. `--nms-pos`, `--nms-now` and
 * `--nms-ok` failed SC 1.4.3 as type or under type; `--nms-ring` and
 * `--nms-input` failed SC 1.4.11 as a focus indicator and a field edge. Each row
 * records its own old value and its own reason. What did NOT change is what
 * grayscale mode is for: sign was never reviewable here and still is not, and
 * darkening a number's colour does not make it one.
 *
 * `--muted` MAPS TO `--nms-muted-foreground`, NEVER TO `--nms-muted`. The
 * English collides and the roles do not: `--nms-muted` is a recessed SURFACE
 * (Button's `ghost` and `outline` hover), the app's `--muted` is secondary TEXT.
 * A mechanical `--muted` → `--nms-muted` rewrite compiles, emits a rule, paints
 * the app's most-used grey wrong, and leaves every guard green, because the
 * package-side guard checks only that a read sits inside the namespace and never
 * that it is the right name in it. This row is the defence against that.
 *
 * `--nms-neg` IS DISTINCT FROM `--nms-destructive`, though `apps/web` resolves
 * both to the same red today. They are different kinds of thing: `--neg` is
 * data, the sign of a number, and `--nms-destructive` is intent, the affordance
 * of a button that destroys something. Welding them means the money-red cannot
 * soften, or pair colourblind-safely with `--nms-pos`, without dragging every
 * destructive affordance along. Two names at one value now is free; one name at
 * two meanings later is not.
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
    name: "--nms-card",
    value: "oklch(0.985 0 0)",
    note: "The raised surface a card is painted on, one step off the page. `CARD_SURFACE` fills with it, and eight elements in the app carry that string, three of which are not cards — they share the paint and nothing else. Off-white rather than the page's white on purpose: grayscale mode reviews hierarchy, and a card at the background's value has none to review.",
  },
  {
    name: "--nms-foreground",
    value: "oklch(0.145 0 0)",
    note: "Primary text. Also read bare in Button's secondary hover mix.",
  },
  {
    name: "--nms-muted-foreground",
    value: "oklch(0.556 0 0)",
    note: "Secondary TEXT — the quieter of the two type colours. `Absent`'s em dash and its stated cause. NOT `--nms-muted`, which is a surface: same English word, opposite roles, and the mechanical `--muted` rename that welds them is the defect this pair is written against.",
  },
  {
    name: "--nms-muted",
    value: "oklch(0.97 0 0)",
    note: "Recessed SURFACE — a well, never type colour. Button `ghost` and `outline` hover. See the row above before reaching for it as a text grey.",
  },
  {
    name: "--nms-border",
    value: "oklch(0.922 0 0)",
    note: "Hairline between surfaces. Button `outline`'s edge, where the visible label is what identifies the control. IT KEPT ITS VALUE while `--nms-input` below moved, and the split is ADR-026's sentence: a hairline drawn for texture is not a boundary, the line a control is identified by is. `contrast.ts` carries this pair as a named exclusion so the difference is written down rather than inferred from which name a value happened to land on. THE FILL PATH'S RUNG ROW LEFT THIS TOKEN for `--nms-input`: it is a `<button>` with no chrome and no fill step, so its edge was the identification, and at this value it measured 1.21:1 against the card behind it. A token may not be both jobs at once, and moving the control is the half that does not repaint eight surfaces.",
  },
  {
    name: "--nms-input",
    value: "oklch(0.6 0 0)",
    note: "Field edge, the fill path's rung-row edge, and dark-mode field fill on Button `outline`. LIFTED OFF THE HAIRLINE'S VALUE by spec #451 S3, which is the same edit `apps/web` makes to its own palette in the same slice: at the border's grey this token measured 1.21:1 against a card and SC 1.4.11 wants 3:1 for the boundary that tells a user where a control is. `--nms-border` keeps the old value because a hairline drawn for texture is not that boundary.",
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
    name: "--nms-neg",
    value: "oklch(0.45 0 0)",
    note: "The negative SIGN of a number — data, not intent. `SnapshotStaleNotice` paints its refusal with it. NOT `--nms-destructive`, the row above, which is the affordance of a button that destroys something: `apps/web` resolves both to one red today, and welding them means the day the money-red wants to soften, or wants a colourblind-safe pairing with `--nms-pos`, every destructive affordance moves with it. Grayscale here makes sign UNREVIEWABLE in grayscale mode, and that is correct: grayscale reviews hierarchy, spacing and state, and sign is reviewed in themed and app mode, which is what those modes are for.",
  },
  {
    name: "--nms-pos",
    value: "oklch(0.5 0 0)",
    note: "The positive SIGN of a number, and `--nms-neg`'s pair. `SummaryCard` paints a rising unrealized P&L with it, and `SectionTable` and `GlanceCard` render the same string through the constant it exports. It is data, exactly as the row above is — and the reason that row refused to weld with `--nms-destructive` was so the money-red could pair colourblind-safely with THIS name, which is why the pair only becomes checkable now that both halves exist. Grayscale here for the same reason `--nms-neg` is: sign is reviewed in themed and app mode. DARKENED by spec #451 S3: at the old value it measured 2.13:1 as type on the base mode's card and failed SC 1.4.3. Sign stays UNREVIEWABLE in grayscale, which was never what the old value bought — it only made the number hard to read as well.",
  },
  {
    name: "--nms-ok",
    value: "oklch(0.46 0 0)",
    note: "The all-clear FILL — a badge asserting that the fold excluded nothing and the marks arrived. `SummaryCard`'s data-safety badge, green arm. A fill rather than a type colour, which is what makes it the loudest thing in themed mode when nothing repaints. DARKENED by spec #451 S3: it is a fill under `text-white`, and white on the old value reached 3.64:1 where SC 1.4.3 wants 4.5. The badge's label is the thing being read, so the fill is what moves. RECORDED AND NOT FIXED: that move landed this token at L 0.46 while `--nms-destructive` and `--nms-neg` sit at 0.45, so in the base mode the all-clear and the destructive colour are one hundredth of L apart where they used to be 0.62 against 0.45. Both are states, and grayscale is the mode that reviews state. Nothing catches it: `app-token-drift.test.ts` asserts pairwise distinctness for `THEMED_TOKENS` and there is no equivalent for `GRAYSCALE_TOKENS`, so the collision is a fact written down here rather than a guard. Minting or moving a value for it is a separate slice.",
  },
  {
    name: "--nms-warn",
    value: "oklch(0.52 0 0)",
    note: "The withheld-or-excluded FILL, `--nms-ok`'s other arm on the same badge. NOT `--nms-destructive`: nothing is being destroyed, and nothing has failed — the card is naming what it could not state. Two arms of one branch, so a fixture has to stage both to show either. A FILL AND ONLY A FILL since spec #451 S3: white on it clears 4.5:1, the same colour as type on a card reached 2.91:1, and the text job left for the row below.",
  },
  {
    name: "--nms-caution",
    value: "oklch(0.48 0 0)",
    note: "The withheld-or-excluded reading, AS TYPE — `DcaCard`'s `unreadable` sidecar, the fill path's `unreadable` row tone, and the `inferred` pill with its dashed left rule. It is `--nms-warn`'s meaning at a value a card can carry, and it is in the `pos`/`neg`/`now` family, which is already \"a data colour that sits on a card as text\". NOT `--nms-warn-foreground`: under the shadcn convention `--nms-primary-foreground` and `--nms-secondary-foreground` follow, `X-foreground` is the text that sits ON an `X` fill, and here that colour is white. A name meaning \"warn used as text\" in that slot would read as its own opposite, inside a namespace whose whole argument is that a name may not mean two things.",
  },
  {
    name: "--nms-now",
    value: "oklch(0.54 0 0)",
    note: "WHERE PRICE IS NOW — the level a trading chart draws its last price at, and the third of the three state colours the Price Drop Path shares with the rung list beside it. `PriceDropPathChart` reads it three times: the horizontal spot rule, the end-anchored label that says what the rule is, and the `Now` legend swatch. It is the one name in this table with no near neighbour, chosen to collide with `--nms-pos` (the filled path), `--nms-muted-foreground` (the waiting path) and `--nms-neg` alike — a spot level is a neutral fact, and painting it in the loss colour would say something the price has not said. Grayscale here makes \"now\" unreviewable in grayscale mode, which is correct and is the same call `--nms-neg` records: grayscale reviews hierarchy, spacing and state. DARKENED by spec #451 S3 for the reason `--nms-pos` above is: 2.76:1 as type on the base mode's card fails SC 1.4.3, and a spot level nobody can read is a neutral fact nobody gets.",
  },
  {
    name: "--nms-ring",
    value: "oklch(0.62 0 0)",
    note: "Focus ring. The one token whose absence is a keyboard-accessibility defect. DARKENED by spec #451 S3: at the old value the ring measured 2.48:1 against a card and failed SC 1.4.11, so the row above was true in a second way nobody had measured — a ring that renders and cannot be seen is the same keyboard defect as a ring that does not render.",
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
