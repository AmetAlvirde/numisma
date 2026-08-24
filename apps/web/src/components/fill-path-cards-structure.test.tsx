// @vitest-environment jsdom
/**
 * THE FILL PATH'S CARD SHELL, PINNED ACROSS THE PRIMITIVE SWAP (spec #403, S6).
 *
 * S6 rewrites this file's five `<section className="card…">` openers into `Card` and
 * their headings into `Card.Title`. That conversion has exactly two ways to go wrong
 * silently, and both are invisible in a screenshot:
 *
 *   1. THE HEADING LEVEL. `CardTitle` defaults to `2`, and the fill path's header is one
 *      of only two cards in the layer whose heading is its page's `<h1>`. Forgetting
 *      `level={1}` renders identically for a sighted reader and turns the page into a
 *      document with no title for everything that navigates by headings.
 *   2. THE CLASS SET. `Card` composes `card` with what the caller passes, so a caller
 *      that passes `card fp-header` emits `card card fp-header` and a caller that drops
 *      a word emits a card the stylesheet does not recognise. `styles.css` is required
 *      to be byte-identical across this whole increment, which makes the class strings
 *      the contract rather than an implementation detail. Spec #412 Slice 5 later spent
 *      that file's one sanctioned edit on a `:root` block of `--nms-*` overrides — custom
 *      properties only, so not one selector below changed meaning.
 *
 * This is a CHARACTERIZATION test: it was written green against the pre-swap markup, and
 * its job is to still be green afterwards. That is the whole oracle for a
 * behavior-preserving conversion — a red-first test here would have to assert markup
 * nobody wants changed.
 *
 * The fixture is authored. `started-ladder.fixtures.ts` is hand-written and its own tests
 * say so; no ledger output has been near this file.
 */
import { describe, expect, it } from "vitest";

import {
  DELETED_IN_SLICE_7,
  classTokens,
  render,
  renderedClassNames,
  screen,
} from "../render.testkit.tsx";
import { FillPath, FillPathCards, FillPathProvider } from "./FillPath.tsx";
import { composeFillPathPage } from "../ladder/fill-path-view.ts";
import type { FillPathView } from "../ladder/fill-path-view.ts";
import { ladderFixture } from "../ladder/started-ladder.fixtures.ts";
import { CARD_SURFACE } from "./ui/Card.tsx";

/** One fixture, composed through the real view module — never a hand-built view object. */
function viewOf(name: "partly-walked" | "day-zero"): FillPathView {
  const fixture = ladderFixture(name);
  if (fixture === undefined) throw new Error(`fixture \`${name}\` is gone`);
  const page = composeFillPathPage(fixture.anchor, fixture.planId, fixture.spot);
  if (page.status !== "ok") {
    throw new Error(`fixture composed to \`${page.status}\`, not a page`);
  }
  return page.view;
}

/** The widest fixture: filled rungs, waiting rungs and a live spot, so every card draws. */
function partlyWalkedView(): FillPathView {
  return viewOf("partly-walked");
}

/** The header alone, so an assertion about it names one card's markup and not four. */
function renderHeader(view: FillPathView) {
  return render(
    <FillPathProvider view={view}>
      <FillPath.Header />
    </FillPathProvider>,
  );
}

/**
 * The same view with an optional field GENUINELY ABSENT.
 *
 * `exactOptionalPropertyTypes` is on, so `{ ...view, spotUsd: undefined }` is not the
 * same thing as a view that never had the key and the compiler says so. Deleting the key
 * is what the composer's own absent arm produces, which is the state these arms render
 * against.
 */
function without(view: FillPathView, keys: (keyof FillPathView)[]): FillPathView {
  const copy: Record<string, unknown> = { ...view };
  for (const key of keys) delete copy[key as string];
  return copy as unknown as FillPathView;
}

/** `toContain` per class, never the whole string — spec #420 Seam E. */
function expectClasses(element: Element | null | undefined, classes: string[]): void {
  expect(element).not.toBeNull();
  const tokens = classTokens(element as Element);
  for (const wanted of classes) expect(tokens).toContain(wanted);
}

describe("the fill path's card shell", () => {
  it("titles the page with an `h1` and every section with an `h2`", () => {
    const view = partlyWalkedView();
    const { container } = render(<FillPathCards view={view} />);

    // The page heading, by level rather than by lookup: `getByRole` with `level` is the
    // query that fails when a card silently drops to the primitive's default of 2.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(view.title);
    expect(container.querySelectorAll("h1")).toHaveLength(1);

    const sectionHeadings = [...container.querySelectorAll("h2")].map(
      (heading) => heading.textContent,
    );
    // The panel opens on the NEXT rung, not on the first one, so the expectation is
    // derived from the view rather than counted off the fixture by hand.
    const opensOn = view.rungs.find((rung) => rung.isNext);
    expect(opensOn).toBeDefined();
    expect(sectionHeadings).toEqual([
      "Price Drop Path",
      `Rung ${opensOn?.ladderIndex} of ${view.rungs.length}next`,
      "Rungs",
    ]);
  });

  it("emits the same four card class strings, once each, on `section` elements", () => {
    const { container } = render(<FillPathCards view={partlyWalkedView()} />);

    // The four names are still asserted in order and once each; what each section
    // carries beside its name is now the shared surface, by reference rather than as a
    // pinned string (spec #420 Seam E). THE HEADER'S NAME IS NOW A UTILITY: slice 7
    // deleted `.fp-header`, whose whole body was the container declaration, and the
    // named container utility emits that same shorthand. The other three still name
    // rules this file's later halves have yet to delete, so their strings are unchanged.
    const sections = [...container.querySelectorAll("section")].map(
      (section) => section.className,
    );
    expect(sections).toEqual([
      `${CARD_SURFACE} @container/fp-header`,
      `${CARD_SURFACE} fp-chart-card`,
      `${CARD_SURFACE} @container/fp-selected`,
      `${CARD_SURFACE} fp-list`,
    ]);
    expect(sections.join(" ").split(/\s+/)).not.toContain("card");
  });

  it("keeps the selected-rung panel's live region on the card element itself", () => {
    // `aria-live` is announced from the element that carries it, so it cannot move to a
    // child without changing what a screen reader reads when selection changes. This is
    // the one card whose element is more than `card` plus a class string.
    const { container } = render(<FillPathCards view={partlyWalkedView()} />);

    // Found by the attribute rather than by a class name, because the class is what
    // slice 8 deleted and the attribute is the thing being asserted anyway.
    const panel = container.querySelector("section[aria-live]");
    expect(panel?.tagName).toBe("SECTION");
    expect(panel?.getAttribute("aria-live")).toBe("polite");
  });
});

/**
 * THE CENSUS SUCCESSOR FOR THE HEADER CARD (spec #420 slice 7, Seam E and gate line 3).
 *
 * ONE OF THREE PASSES OVER THIS FILE. Slice 7 owns the header, the tiles, the progress
 * bar and day zero's block; the ladder is slice 8's and the chart is slice 9's, and the
 * assertions above are deliberately untouched because their rules are still in
 * `styles.css`. Converting an assertion before its rule is deleted asserts a utility that
 * is losing to an unlayered rule — the lose-the-cascade failure wearing a green test.
 *
 * WHAT IT CAN AND CANNOT SEE. It proves the element REFERENCES the declaration: per
 * class, with `toContain`, never full-string equality, so Prettier's class sort is not a
 * contract. That the rule is EMITTED is `tailwind-scan.test.ts`'s job and that it WON the
 * cascade and computed to the right value is Chrome's — three channels, no overlap.
 *
 * THE SUBSET IS LOAD-BEARING, NOT COMPLETE. Every class listed below is one whose loss
 * changes the rendered card: a size, a colour, a rail, a reflow arm. Utilities that
 * merely restate a default are left out, so a later edit that drops one is caught here
 * rather than argued about.
 */
describe("the header card carries its section as utilities", () => {
  it("puts the container on the card and the deleted heading rule on the `h1`", () => {
    const { container } = renderHeader(partlyWalkedView());

    // `container: fp-header / inline-size` — one name, which is exactly what Tailwind's
    // named container utility emits. Both `@container fp-header` blocks answer to it.
    expectClasses(container.querySelector("section"), ["@container/fp-header"]);
    // `.fp-header h1` overrode the app's base `h1` size. `m-0` rides along because
    // preflight is off and the UA's own heading margin is live.
    expectClasses(container.querySelector("h1"), [
      "m-0",
      "text-[1.15rem]",
      "wrap-anywhere",
    ]);
  });

  it("reflows the identity row and the head at 380px of card width", () => {
    const { container } = renderHeader(partlyWalkedView());
    const head = container.querySelector("h1")?.parentElement?.parentElement;
    const id = container.querySelector("h1")?.parentElement;

    // Both deleted `@container fp-header` blocks reached this pair: the head goes from
    // `block` to a spread row, and the identity block takes a flex basis inside it.
    expectClasses(head, ["block", "@[380px]/fp-header:flex", "@[380px]/fp-header:gap-x-4"]);
    expectClasses(id, ["flex", "mb-[10px]", "@[380px]/fp-header:flex-[1_1_180px]"]);
  });

  it("paints the state chip from a total map, one colour per state", () => {
    // All four arms, not only the one this fixture is in. Two of the four never had a
    // rule of their own and were painted by the base; the base is gone, so each arm has
    // to name its colour or the chip renders in the inherited text colour.
    const base = partlyWalkedView();
    const tones: [FillPathView["state"], string][] = [
      ["pending", "text-[var(--muted)]"],
      ["active", "text-[var(--pos)]"],
      ["ended", "text-[var(--muted)]"],
      ["unreadable", "text-[var(--warn)]"],
    ];
    for (const [state, tone] of tones) {
      const { container, unmount } = renderHeader({ ...base, state });
      const chip = container.querySelector("h1")?.nextElementSibling;
      expectClasses(chip, [
        "rounded-[999px]",
        "border",
        "border-current",
        "text-[0.65rem]",
        "uppercase",
        "tracking-[0.05em]",
        tone,
      ]);
      unmount();
    }
  });

  it("keeps spot on the rail at 320px and in the corner at 380px", () => {
    const { container } = renderHeader(partlyWalkedView());
    const spot = container.querySelector("section > div > p");

    // The rule under spot is the thing the wide arm removes, together with the padding
    // that made room for it — both edges, because a half-reproduced border is a hairline
    // that never goes away.
    expectClasses(spot, [
      "justify-end",
      "pb-[10px]",
      "border-b",
      "border-b-[var(--line)]",
      "mb-3",
      "@[380px]/fp-header:flex-col",
      "@[380px]/fp-header:items-end",
      "@[380px]/fp-header:pb-0",
      "@[380px]/fp-header:border-b-0",
      "@[380px]/fp-header:text-right",
    ]);
    // Spot reads muted so that Waiting is the one accented figure on the card.
    expectClasses(spot?.querySelector("strong"), [
      "text-[1.05rem]",
      "tabular-nums",
      "text-[var(--muted)]",
    ]);
    expectClasses(spot?.querySelector("span:last-of-type"), [
      "m-0",
      "mt-1",
      "text-[0.7rem]",
      "text-[var(--muted)]",
    ]);
  });

  it("carries the tile grid, the label rail and the figure rail", () => {
    const { container } = renderHeader(partlyWalkedView());
    const tiles = container.querySelectorAll("section > div")[1];
    const tile = tiles?.firstElementChild;

    expectClasses(tiles, [
      "grid",
      "grid-cols-1",
      "gap-2",
      "mb-[14px]",
      "@[380px]/fp-header:grid-cols-[repeat(auto-fit,minmax(130px,1fr))]",
      "@[380px]/fp-header:gap-3",
    ]);
    expectClasses(tile, [
      "flex",
      "justify-end",
      "gap-x-[10px]",
      "@[380px]/fp-header:flex-col",
      "@[380px]/fp-header:items-stretch",
    ]);
    // The zero basis is what lets a two-word label wrap instead of pushing its figure
    // off the rail, so it is asserted rather than left to read as decoration.
    expectClasses(tile?.querySelector("span"), [
      "text-[0.7rem]",
      "uppercase",
      "tracking-[0.04em]",
      "text-[var(--muted)]",
      "flex-[1_1_0]",
      "min-w-0",
      "@[380px]/fp-header:flex-none",
      "@[380px]/fp-header:text-left",
    ]);
    expectClasses(tile?.querySelector("strong"), [
      "flex-none",
      "text-right",
      "text-[1.05rem]",
      "tabular-nums",
      "@[380px]/fp-header:text-left",
    ]);
  });

  it("draws the progress track and its fill, and the count under them", () => {
    const { container } = renderHeader(partlyWalkedView());
    const track = container.querySelector('[role="img"]');

    expectClasses(track, [
      "h-1.5",
      "overflow-hidden",
      "rounded-[3px]",
      "bg-[var(--line)]",
    ]);
    expectClasses(track?.firstElementChild, ["h-full", "bg-[var(--pos)]"]);
    // THE WIDTH IS AN INLINE STYLE AND STAYS ONE. It is a measurement, and there is no
    // utility for "whatever fraction this ladder happens to be at".
    expect(track?.firstElementChild?.getAttribute("style")).toMatch(/width:/);
    // 6px, not 4px: the deleted `.fp-progress p` rule beat the muted line's own margin
    // while it stood, and losing that step is invisible in every other channel.
    expectClasses(track?.parentElement?.querySelector("p"), [
      "m-0",
      "mt-1.5",
      "text-[0.78rem]",
      "text-[var(--muted)]",
    ]);
  });

  it("keeps the waiting block on the rail, rule above it", () => {
    const { container } = renderHeader(partlyWalkedView());
    const waiting = container.querySelector("section")?.lastElementChild;

    expectClasses(waiting, [
      "flex",
      "justify-end",
      "gap-x-[10px]",
      "border-t",
      "border-t-[var(--line)]",
      "pt-3",
      "@[380px]/fp-header:flex-col",
      "@[380px]/fp-header:items-stretch",
    ]);
  });

  it("breaks the unreadable-sidecar sentence to its own full-width line", () => {
    // `figures` absent means the orders sidecar could not be read. The sentence is the
    // cause attached to its own em dash, and `flex-[1_0_100%]` is what stops it trying to
    // share the rail with the number it explains.
    const { container } = renderHeader(
      without(partlyWalkedView(), ["expected", "figures"]),
    );
    const sub = container.querySelector("section")?.lastElementChild?.querySelector("p");

    expectClasses(sub, [
      "flex-[1_0_100%]",
      "m-0",
      "mt-1",
      "text-[0.78rem]",
      "text-pretty",
      "text-[var(--muted)]",
    ]);
  });

  it("gives day zero its hero and its two quieter projections", () => {
    const { container } = renderHeader(viewOf("day-zero"));
    const expected = container.querySelectorAll("section > div")[1];
    const hero = expected?.firstElementChild;
    const quiet = expected?.lastElementChild;

    expectClasses(expected, ["mb-[14px]"]);
    // Out of the rail entirely — label above the figure, at the card's largest type.
    expectClasses(hero, ["flex", "flex-col", "gap-px", "mb-3"]);
    expectClasses(hero?.querySelector("strong"), [
      "text-[1.75rem]",
      "font-bold",
      "leading-[1.15]",
      "tracking-[-0.01em]",
      "tabular-nums",
    ]);
    // The quiet grid is the same grid with its bottom margin taken back off, which is
    // what the deleted `.fp-expected .fp-tiles` context rule did.
    expectClasses(quiet, ["grid", "grid-cols-1", "mb-0"]);
    // A projection reads quieter in two ways at once, and the size is the half that had
    // been a descendant selector rather than a class of its own.
    expectClasses(quiet?.firstElementChild?.querySelector("strong"), [
      "text-[0.95rem]",
      "text-[var(--muted)]",
      "tabular-nums",
    ]);
  });

  it("wraps an absent figure under its em dash at the rail it sits on", () => {
    // The two arms differ on purpose. A tile's cause follows the tile back to the left
    // edge when the card reflows; spot's does not, because spot's own reflow keeps the
    // whole block right-aligned.
    //
    // FOUND BY THE EM DASH, NOT BY A CLASS. `absent` was a bare hook kept alive for the
    // three contextual rules that selected through it, and slice 8 deleted the last of
    // them along with the hook. The decorative glyph is the primitive's own marker and
    // is what `absent-contract.test.tsx` pins, so it is the stable handle.
    const absentIn = (root: Element) =>
      [...root.querySelectorAll('span[aria-hidden="true"]')]
        .filter((dash) => dash.textContent === "—")
        .map((dash) => dash.parentElement!);
    const spotOut = renderHeader({
      ...without(partlyWalkedView(), ["spotUsd"]),
      spotLoading: false,
    });
    const spotAbsent = absentIn(spotOut.container)[0];
    expectClasses(spotAbsent, ["flex-wrap", "justify-end", "text-right"]);
    expect(classTokens(spotAbsent!)).not.toContain("@[380px]/fp-header:text-left");
    spotOut.unmount();

    const base = partlyWalkedView();
    const { container } = renderHeader({
      ...base,
      deployed: { known: false, why: "the orders sidecar could not be read" },
    });
    const tileAbsent = absentIn(container).at(-1);
    expectClasses(tileAbsent, [
      "flex-wrap",
      "justify-end",
      "text-right",
      "@[380px]/fp-header:justify-start",
      "@[380px]/fp-header:text-left",
    ]);
  });

  it("renders none of the twenty-five class names slice 7 deleted", () => {
    // THE WHOLE PAGE, not the header alone: the assertion that catches the carrier
    // nobody remembered is a claim about the subtree, and `fp-tile-label` in particular
    // was rendered by the CHART card's inspect label as well as by the header's tiles.
    const { container } = render(<FillPathCards view={partlyWalkedView()} />);
    const rendered = renderedClassNames(container);
    for (const deleted of DELETED_IN_SLICE_7) expect(rendered).not.toContain(deleted);

    // And the ladder and the chart still carry theirs, which is what makes the line
    // above a claim about slice 7 rather than about the file having been emptied. The
    // list shrinks as slice 8 works down the ladder; the chart's names are slice 9's and
    // are the last to go.
    for (const surviving of ["fp-list", "fp-chart-card", "fp-row"]) {
      expect(rendered).toContain(surviving);
    }
  });

  it("renders both day-zero blocks free of those names too", () => {
    // Day zero draws the hero, the projections and the expected wrapper — three of the
    // deleted names' carriers that `partly-walked` never reaches.
    const { container } = render(<FillPathCards view={viewOf("day-zero")} />);
    const rendered = renderedClassNames(container);
    for (const deleted of DELETED_IN_SLICE_7) expect(rendered).not.toContain(deleted);
  });
});

/**
 * THE CENSUS SUCCESSOR FOR THE THREE BLOCKS ABOVE THE CHART (spec #420 slice 8, Seam E).
 *
 * The banner, the two warnings and the unchecked line render on VIEWS THIS FIXTURE IS
 * NOT IN, so each arm is reached by overriding the one field of the composed view that
 * decides it. That is the same move `renderHeader` makes for the state chip's four tones
 * — the fixture decides the layout, the field decides the arm — and it is what lets a
 * torn banner be asserted at all: no `started-ladder` fixture carries an outstanding
 * torn act, by design, because every one of them is a ladder that reconciled.
 */
describe("the torn banner and the two warnings carry their rules as utilities", () => {
  /** The view with an outstanding torn count, which no fixture composes to. */
  function tornView(): FillPathView {
    return { ...partlyWalkedView(), tornActs: { status: "outstanding", count: 2 } };
  }

  it("paints the banner in `--neg` and keeps it an alert", () => {
    const { container } = render(<FillPathCards view={tornView()} />);
    const banner = container.querySelector('[role="alert"]');

    // The surface is spelled out on this one element rather than composed from
    // `CARD_SURFACE`, because the banner's border is `--neg` and the shared string's is
    // `--line`: two unvariant `border-color` utilities would race. Asserted from both
    // ends — the colour that must be there, and the one that must not.
    expectClasses(banner, [
      "rounded-xl",
      "border",
      "border-[var(--neg)]",
      "bg-[var(--card)]",
      "p-4",
      "text-[var(--neg)]",
    ]);
    expect(classTokens(banner!)).not.toContain("border-[var(--line)]");
    expect(banner?.tagName).toBe("DIV");
    expect(banner?.getAttribute("role")).toBe("alert");

    // The sentence under the heading steps back to `--text`: it is prose inside a block
    // painted `--neg`, and reading it in the alarm colour makes the whole card shout.
    expectClasses(banner?.querySelector("p"), [
      "m-0",
      "mt-1.5",
      "text-[0.85rem]",
      "text-[var(--text)]",
    ]);
  });

  it("zeroes every edge of the unchecked line's margin", () => {
    // `.fp-unchecked` declared `margin: 0`, and while it stood it BEAT the `mt-1` this
    // paragraph carried from slice 2's `.muted` conversion — an unlayered rule outranks
    // every utility. Reproducing the rule therefore means dropping that `mt-1`, which is
    // the quietest way this conversion could have moved a pixel.
    const view = partlyWalkedView();
    const { container } = render(
      <FillPathCards view={{ ...view, tornActs: { status: "unchecked" } }} />,
    );
    const line = [...container.querySelectorAll("p")].find((paragraph) =>
      paragraph.textContent?.includes("were not checked for this snapshot"),
    );

    expectClasses(line, ["m-0", "text-[0.8rem]", "text-[var(--muted)]"]);
    expect(classTokens(line!)).not.toContain("mt-1");
  });

  it("keeps the certain warning solid and the inferred one dashed", () => {
    const view = partlyWalkedView();
    const { container } = render(
      <FillPathCards
        view={{
          ...view,
          warnings: { filledNotRecorded: 1, pricePassedNoFill: 2 },
        }}
      />,
    );
    const paragraphs = [...container.querySelectorAll("p")];
    const certain = paragraphs.find((paragraph) =>
      paragraph.textContent?.includes("filled at the venue"),
    );
    const inferred = paragraphs.find((paragraph) =>
      paragraph.textContent?.includes("had price pass through"),
    );

    // Both are card-surfaced paragraphs, so the shared string rides along and only the
    // left edge differs. The width and colour are LONGHANDS on purpose: `border-l-4`
    // beats `border`'s shorthand width, and `border-l-[…]` beats its shorthand colour,
    // which is the ordering Tailwind guarantees between the two.
    for (const warning of [certain, inferred]) {
      expectClasses(warning, [
        ...CARD_SURFACE.split(" "),
        "m-0",
        "text-[0.85rem]",
        "leading-[1.45]",
        "border-l-4",
      ]);
    }
    expectClasses(certain, ["border-l-[var(--neg)]"]);
    expect(classTokens(certain!)).not.toContain("[border-left-style:dashed]");

    // THE DASH IS ONE EDGE, NOT FOUR. `border-dashed` would dash the card's other three
    // sides too, so the style is set as an arbitrary property on the left edge alone —
    // the difference between the two certainties is the whole reason these paragraphs
    // look different, and it must not spill onto the surface they share.
    expectClasses(inferred, [
      "border-l-[var(--warn)]",
      "[border-left-style:dashed]",
      "text-[var(--muted)]",
    ]);
  });

  it("renders none of the five class names the banner and warnings carried", () => {
    const { container } = render(
      <FillPathCards
        view={{
          ...tornView(),
          warnings: { filledNotRecorded: 1, pricePassedNoFill: 2 },
        }}
      />,
    );
    const rendered = renderedClassNames(container);
    for (const deleted of [
      "fp-torn",
      "fp-unchecked",
      "fp-warn",
      "fp-warn-certain",
      "fp-warn-inferred",
    ]) {
      expect(rendered).not.toContain(deleted);
    }
  });
});

/**
 * THE CENSUS SUCCESSOR FOR THE SELECTED-RUNG CARD (spec #420 slice 8, Seam E).
 *
 * TWO OF THE ARMS BELOW HAVE NO FIXTURE, so the view is patched at the one rung the
 * panel opens on. `Order placed at` needs a declared join sitting at a different price,
 * which no `started-ladder` fixture composes to — every one of them reconciles cleanly —
 * and the four pill tones need four rungs no single fixture happens to hold at once.
 * Patching the rung is what makes the arms reachable without inventing a fifth fixture
 * whose only purpose would be to be looked at by this file.
 */
describe("the selected-rung card carries its section as utilities", () => {
  /** The panel opens on the `next` rung, so that is the one a patch has to land on. */
  function withSelectedRung(
    view: FillPathView,
    patch: Partial<FillPathView["rungs"][number]>,
  ): FillPathView {
    return {
      ...view,
      rungs: view.rungs.map((rung) => (rung.isNext ? { ...rung, ...patch } : rung)),
    };
  }

  function panelOf(view: FillPathView) {
    const { container } = render(<FillPathCards view={view} />);
    return container.querySelector("section[aria-live]")!;
  }

  it("makes the card the query container and sizes both ladder headings", () => {
    const panel = panelOf(partlyWalkedView());

    // `container: fp-selected / inline-size` — one name, which is what Tailwind's named
    // container utility emits, exactly as the header card's does.
    expectClasses(panel, [...CARD_SURFACE.split(" "), "@container/fp-selected"]);
    // The deleted rule sized three cards' headings from one grouped selector; the chart's
    // arm is slice 9's and stays. `m-0 mb-2.5` is the preflight-off pattern — the UA's own
    // `h2` margin is live, so three edges are zeroed and one is set.
    expectClasses(panel.querySelector("h2"), [
      "m-0",
      "mb-2.5",
      "text-[0.95rem]",
      // The heading carries the `next` badge, so it is a baseline row and not a block.
      "flex",
      "items-center",
      "gap-[10px]",
    ]);
  });

  it("demotes the size, the unit and the joining word beneath the price", () => {
    const panel = panelOf(partlyWalkedView());
    const price = panel.querySelector("h2 + p");

    expectClasses(price, ["m-0", "mb-2", "text-[1.3rem]", "tabular-nums"]);
    const size = price?.querySelector("span");
    expectClasses(size, ["text-[var(--muted)]"]);
    // `0.75em`, not `0.75rem`: the unit steps down from the FIGURE it belongs to, so it
    // has to be relative to the price's own size rather than to the root's.
    expectClasses(size?.querySelector("span"), ["text-[0.75em]"]);
    expectClasses(
      [...(price?.children ?? [])].find((child) => child.textContent === "@"),
      ["text-[var(--muted)]", "opacity-70"],
    );
  });

  it("paints each pill from a total map, one tone per exception", () => {
    // FOUR TONES, NOT A BASE PLUS THREE OVERRIDES. The deleted rules were exactly that,
    // and as utilities it is a cascade the class string cannot express: two unvariant
    // `border-color` utilities on one element are resolved by Tailwind's emitted order.
    // `BADGE_TONE` made the same move one card up, for the same reason.
    const base = partlyWalkedView();
    const shape = [
      "rounded-[10px]",
      "border",
      "px-[7px]",
      "py-[2px]",
      "text-[0.68rem]",
      "font-semibold",
      "uppercase",
      "tracking-[0.03em]",
    ];

    const ordinary = panelOf(withSelectedRung(base, { venueResting: false }));
    expectClasses(ordinary.querySelector("p:nth-of-type(2) span"), [
      ...shape,
      "border-[var(--line)]",
      "text-[var(--muted)]",
    ]);

    // Greyed AND dashed, per G-D12: a declared rung with no order is not a state the
    // ladder is in, it is one it never entered.
    const unplaced = panelOf(withSelectedRung(base, { notPlaced: true }));
    expectClasses(unplaced.querySelector("p:nth-of-type(2) span"), [
      ...shape,
      "border-[var(--line)]",
      "text-[var(--muted)]",
      "border-dashed",
      "opacity-[0.55]",
    ]);

    // Dashed in `--warn`, matching the inferred warning above the chart — the same
    // certainty, the same visual language.
    const inferred = panelOf(withSelectedRung(base, { pricePassedUnconfirmed: true }));
    const inferredPill = [...inferred.querySelectorAll("p:nth-of-type(2) span")].find(
      (pill) => pill.textContent?.includes("unconfirmed"),
    );
    expectClasses(inferredPill, [
      ...shape,
      "border-[var(--warn)]",
      "text-[var(--warn)]",
      "border-dashed",
    ]);

    // `--now`, never `--pos`: the next rung is where price is HEADING, and green is the
    // colour that means FILLED.
    expectClasses(panelOf(base).querySelector("h2 span"), [
      ...shape,
      "border-[var(--now)]",
      "text-[var(--now)]",
    ]);
  });

  it("rails the detail row's value right at 320px and left once the card reflows", () => {
    const panel = panelOf(withSelectedRung(partlyWalkedView(), { placedAtUsd: 1 }));

    // The TERMS are sized to content and the value column takes the remainder, which is
    // the opposite of the header card's `dl` and is in the deleted rule's own comment:
    // one value on this list is a sentence rather than a figure.
    expectClasses(panel.querySelector("dl"), [
      "grid",
      "grid-cols-[auto_minmax(0,1fr)]",
      "gap-x-3",
      "gap-y-1.5",
      "m-0",
      "mt-2.5",
      "text-[0.85rem]",
      "@[380px]/fp-selected:grid-cols-[auto_1fr]",
      "@[380px]/fp-selected:gap-y-1",
    ]);
    expectClasses(panel.querySelector("dt"), ["text-[var(--muted)]"]);
    // `m-0` because the UA indents a `dd` by 40px and preflight is off.
    expectClasses(panel.querySelector("dd"), [
      "m-0",
      "text-right",
      "tabular-nums",
      "@[380px]/fp-selected:text-left",
    ]);
  });

  it("rules the completeness line off from the fact above it", () => {
    const panel = panelOf(partlyWalkedView());
    const recorded = [...panel.querySelectorAll("p")].find((paragraph) =>
      paragraph.textContent?.startsWith("Fills recorded at"),
    );

    // 12px, not the 4px this paragraph carried from slice 2's `.muted` conversion: the
    // deleted rule set its own top margin and, being unlayered, won. Both edges of the
    // hairline are here — a half-reproduced border is a rule that never goes away.
    expectClasses(recorded, [
      "m-0",
      "mt-3",
      "pt-2.5",
      "border-t",
      "border-t-[var(--line)]",
      "text-[0.75rem]",
      "leading-[1.5]",
      "text-[var(--muted)]",
    ]);
    expect(classTokens(recorded!)).not.toContain("mt-1");
  });

  it("renders none of the class names the selected-rung card carried", () => {
    const view = withSelectedRung(partlyWalkedView(), {
      placedAtUsd: 1,
      notPlaced: true,
      pricePassedUnconfirmed: true,
    });
    const { container } = render(<FillPathCards view={view} />);
    const rendered = renderedClassNames(container);

    for (const deleted of [
      "fp-selected",
      "fp-selected-price",
      "fp-selected-size",
      "fp-selected-at",
      "fp-unit",
      "fp-detail",
      "fp-pills",
      "fp-pill",
      "fp-pill-unplaced",
      "fp-pill-inferred",
      "fp-pill-next",
      "fp-pill-caption",
      "fp-recorded",
    ]) {
      expect(rendered).not.toContain(deleted);
    }
    // THE HOOK IS GONE TOO. `.fp-detail .absent` was the last contextual rule selecting
    // through `absent`, and it left with this card; the primitive stopped writing the
    // name in the same commit.
    expect(rendered).not.toContain("absent");
  });
});
