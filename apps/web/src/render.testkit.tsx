/**
 * THE RENDER-TEST HARNESS — Seam A of spec #403, bought by ADR-022.
 *
 * ── ONE MODULE OWNS REACT TESTING LIBRARY ────────────────────────────────────────────
 * Every render test imports `render`, the queries and `userEvent` FROM HERE and from
 * nowhere else. RTL is imported at exactly one path in this repo, so the day the harness
 * changes — a provider wrapper, a different cleanup rule, another browser stub — there is
 * one file to change and no sweep to run.
 *
 * ── CLEANUP IS THIS MODULE'S JOB, NOT A SETUP FILE'S ─────────────────────────────────
 * The root vitest config does not enable `globals`, so RTL's own auto-cleanup — which
 * arms itself off a global `afterEach` — never arms. Registering it here, at import time
 * of the one module every render test already imports, gets the same guarantee without a
 * root `setupFiles` entry, which would load RTL into every Node suite in the repo (the
 * engine, event-store, price-feed and tui suites spawn real subprocesses; they must not
 * pay for this).
 *
 * ── JSDOM IS NOT ATTACHED HERE ───────────────────────────────────────────────────────
 * It attaches PER FILE, through a `// @vitest-environment jsdom` docblock at the top of
 * each `*.test.tsx`. Not at the root, and not through a projects split — see spec #403 §3
 * and ADR-022. `jsdom-docblock-guard.test.ts` is what makes that claim checkable: a
 * missing docblock is otherwise a `document is not defined` at the first `render()`.
 *
 * ── THIS FILE IS PRODUCTION SOURCE TO THE SCANS ──────────────────────────────────────
 * `route-move.test.ts` and `rung-state-seam.test.ts` exclude `*.test.tsx` only, so a
 * `.testkit.tsx` file is a source file as far as they are concerned. Nothing here may
 * spell rung-state copy or the venue-axis predicate they census. Keep this module free of
 * domain vocabulary: it knows about the DOM, not about ladders.
 */
import type { ReactElement } from "react";
import { afterEach } from "vitest";
import {
  cleanup,
  fireEvent,
  render as rtlRender,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * THE BROWSER MEASUREMENT APIS JSDOM DOES NOT IMPLEMENT.
 *
 * The charting adapter observes its container to size itself. jsdom ships no
 * `ResizeObserver` and no `matchMedia`, and every element it lays out measures zero, so a
 * chart mounted here draws at 0×0 — which is exactly right for these tests: they assert
 * the accessibility contract of the chart's subtree, never a pixel. The stubs are the
 * smallest thing that lets a real mount happen.
 *
 * THE CHART IS NOT MOCKED, DELIBERATELY. A stand-in cannot answer "is anything inside the
 * chart focusable", and that assertion is the one that catches a library upgrade mounting
 * a focusable surface. Stubbing the browser is honest; stubbing the component under test
 * is not.
 */
function installBrowserMeasurementStubs(): void {
  const target = globalThis as typeof globalThis & {
    ResizeObserver?: unknown;
    matchMedia?: unknown;
  };

  target.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };

  target.matchMedia ??= (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  });
}

if (typeof document !== "undefined") {
  installBrowserMeasurementStubs();
  // The one registration that replaces RTL's un-armed auto-cleanup. Guarded by the same
  // `document` check so importing this module from a Node suite is inert rather than a
  // crash — the docblock guard is what actually stops that mistake.
  afterEach(cleanup);
}

/** Render into a fresh container. The single render entry point for this repo. */
export function render(ui: ReactElement) {
  return rtlRender(ui);
}

/**
 * EVERY CLASS STRING IN A SUBTREE, DEDUPED AND SORTED — the instrument that makes "this
 * card still emits the classes it emitted before" an assertion instead of an inspection.
 *
 * Spec #403 requires `styles.css` to be byte-identical and forbids a new class name
 * anywhere, while moving five cards onto a shared primitive that builds their root class
 * string for them. A census over the rendered subtree is what catches the one failure a
 * reviewer cannot see: a primitive that drops, reorders or invents a token, on a page
 * that still looks plausible in a diff.
 *
 * Whole `class` ATTRIBUTES, not individual tokens: `"muted absent-why"` and `"muted"` are
 * different facts about different elements, and splitting them would let one turn into
 * the other silently.
 *
 * READ OFF THE ATTRIBUTE, NEVER OFF `element.className`. On an HTML element the property
 * is a string; on an SVG element it is an `SVGAnimatedString` object, and the static type
 * here is `Element`, so TypeScript accepts the object and the declared `string[]` becomes
 * a lie the moment a subtree contains a chart. Measured: a census over
 * `<div class="card"><svg class="chart-surface"/></div>` returned `[{}, "card"]`, the
 * `Set` stopped deduping (every SVG element contributes a distinct object) and a failing
 * diff printed `{}` instead of the class that broke. `getAttribute` answers the same
 * question for both namespaces. `render.testkit.test.tsx` pins it.
 */
export function classCensus(root: Element): string[] {
  const attributes = [root, ...root.querySelectorAll("[class]")].map(
    (element) => element.getAttribute("class") ?? "",
  );
  return [...new Set(attributes)].sort();
}

/**
 * ONE ELEMENT'S CLASS NAMES, SPLIT — half of the census successor's instrument
 * (spec #420 Seam E).
 *
 * The census above asserts whole attributes and that is exactly right while a surface
 * is UNCONVERTED: `"muted absent-why"` and `"muted"` are different facts and full-string
 * equality catches a primitive that drops or invents a token. It is exactly wrong once
 * the surface carries utilities. A converted element's class attribute is a dozen
 * ordered utilities, and pinning the whole string makes every test in this repo depend
 * on Prettier's class sort order — a formatter upgrade would then read as a regression
 * on nine surfaces at once.
 *
 * So the successor asserts PER CLASS, with `toContain`, over these tokens: the
 * load-bearing utilities are present, the deleted class names are not, and a utility
 * added later for a reason this test has no opinion about does not fail it.
 *
 * Read off the attribute for the same reason `classCensus` is — an SVG element's
 * `className` is an object, not a string.
 */
export function classTokens(element: Element): string[] {
  return (element.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

/**
 * EVERY CLASS NAME IN A SUBTREE, as a set — the other half.
 *
 * "None of the slice's deleted class names is present anywhere in this render" is a
 * claim about the whole subtree rather than about one element, and it is the assertion
 * that catches the carrier nobody remembered: a `muted` span three components down that
 * the conversion missed and that no per-element assertion is looking at.
 */
export function renderedClassNames(root: Element): Set<string> {
  return new Set(
    classCensus(root).flatMap((attribute) => attribute.split(/\s+/).filter(Boolean)),
  );
}

/**
 * THE CLASS NAMES SLICE 2 DELETED, spelled once for the five structure tests and the
 * `ui/` contracts that all assert their absence.
 *
 * One list rather than five copies, because the failure this guards against is a carrier
 * nobody remembered, and five copies drift into five different ideas of what was
 * deleted. Each of these had a rule in `styles.css` and has none now; every declaration
 * they carried is a utility on the elements that used to reference them.
 *
 * `absent` IS NOT ON THE LIST AND MUST NOT BE. Its own rule is deleted, but three
 * contextual rules still select through it — `.metrics dd .absent` (slice 3),
 * `.fp-tile .absent` (slice 7), `.fp-detail .absent` (slice 8), two with `@container`
 * arms. It is a bare hook until the last of those goes. `sr-only` is not on the list
 * either, for the opposite reason: the name stays and Tailwind's own utility took it
 * over.
 */
export const DELETED_IN_SLICE_2 = [
  "card",
  "dashboard",
  "muted",
  "absent-why",
  "crumb",
  "notice",
  "error",
];

/**
 * THE CLASS NAMES SLICE 3 DELETED — the summary card, the badges, the shared metrics
 * grid and the two sign colours.
 *
 * Kept beside slice 2's list rather than folded into it, because the two answer
 * different questions on a red: a `muted` that reappears is a shell regression, a
 * `metrics` that reappears is a summary one, and a single merged list would make the
 * failure message name the wrong slice's contract.
 *
 * Three surfaces assert this one: the summary card owns the rules, and the glance card
 * and the section table carry `metrics` and `pos`/`neg` respectively (spec #420 Seam B —
 * the slice that deletes a shared rule converts every carrier of it).
 *
 * `absent` IS STILL NOT ON THE LIST. `.metrics dd .absent` — one of the three contextual
 * rules named in slice 2's note — goes here, and the other two (`.fp-tile .absent`,
 * `.fp-detail .absent`) do not. The hook stays until slice 8 takes the last of them.
 */
export const DELETED_IN_SLICE_3 = [
  "summary",
  "summary-head",
  "badge",
  "badge-ok",
  "badge-warn",
  "metrics",
  "pos",
  "neg",
];

/**
 * THE CLASS NAMES SLICE 4 DELETED — the table surface's two, and only two.
 *
 * The section this slice deleted was mostly ELEMENT rules (`table`, `th`/`td`,
 * `thead th`), and an element cannot stop being written; what a render can prove is that
 * the two CLASS hooks those rules hung off are gone. `table-scroll` was the scroller and
 * the query container; `num` was the right-alignment hook on every figure cell in both
 * tables. Both are utilities on the elements now, so either name reappearing means a
 * carrier was converted back to a rule that no longer exists.
 *
 * Kept beside slices 2 and 3 rather than folded in, for the reason those two are kept
 * apart: a merged list makes a failure name the wrong slice's contract.
 *
 * Two surfaces assert this one. `SectionTable` owns the rules and `DcaCard`'s rung
 * ladder carries them (spec #420 Seam B).
 */
export const DELETED_IN_SLICE_4 = ["table-scroll", "num"];

/**
 * THE CLASS NAMES SLICE 5 DELETED — the glance card's own four, and only its own.
 *
 * One surface asserts this one. Nothing outside `GlanceCard` ever carried these, which is
 * why the list is short: slices 2 and 3 had already taken every class that card shares
 * with anything else (spec #420 Seam B).
 *
 * `glance` IS ON THE LIST AND THAT IS THE POINT. Its rule was the card's query container,
 * and the name it carried on this element is now spelled by two utilities instead — the
 * bare container type and an arbitrary `container-name` holding BOTH names. A `glance`
 * reappearing on the section would mean someone reached for the class again; Tailwind's
 * NAMED container utility appearing instead of the pair is the failure no assertion in
 * this repo can see, because it is a live container with one name too few. Chrome holds
 * that one, by binary-searching the width the metrics list reflows at.
 *
 * Kept beside slices 2, 3 and 4 rather than folded in, for the reason those are kept
 * apart: a merged list makes a failure name the wrong slice's contract.
 */
export const DELETED_IN_SLICE_5 = ["glance", "verdict", "verdict-no", "verdict-yes"];

/**
 * THE CLASS NAMES SLICE 6 DELETED — the DCA card's plan block, head, state badge and
 * alert line.
 *
 * One surface asserts this one, for the reason slice 5's list has one: slices 2, 3 and 4
 * had already taken every class this card shares with anything else (spec #420 Seam B),
 * so what is left is the card's own and renders nowhere but inside it.
 *
 * THE STATE BADGE CONTRIBUTES FOUR NAMES, NOT THREE. Only two of the state suffixes ever
 * had a rule; the card assembled the class from a template, so `pending` and `ended` were
 * always emitted and always styled by the base alone. All four are listed because the
 * template is what is being deleted, and a template rebuilt later would put back the two
 * that never had a rule first — which is the same mistake arriving in its quietest form.
 *
 * `dca` IS NOT ON THE LIST AND MUST NOT BE. It is the card root's hook, it never had a
 * rule in `styles.css` and this slice does not remove it; asserting its absence would
 * fail on a card that is behaving exactly as intended.
 */
export const DELETED_IN_SLICE_6 = [
  "dca-plan",
  "dca-head",
  "dca-state",
  "dca-state-pending",
  "dca-state-active",
  "dca-state-ended",
  "dca-state-unreadable",
  "dca-alert",
  "dca-alert-warn",
];

/**
 * THE CLASS NAMES SLICE 7 DELETED — the fill path's header card, top to bottom.
 *
 * The longest list of the seven, because the section it names was the longest in
 * `styles.css`: an identity row, a state chip, a spot reading, three tiles and their
 * grid, a progress bar, a waiting block, day zero's hero, and two container blocks
 * reflowing most of it. One card, thirteen names.
 *
 * THE FOUR BADGE SUFFIXES ARE ALL HERE, and only two of them ever had a rule. The chip's
 * class was assembled from a template, so `pending` and `ended` were always emitted and
 * always painted by the base alone; the template is what is being deleted, and a template
 * rebuilt later would put back the two that never had a rule first. Slice 6's list is
 * shaped the same way for the same reason.
 *
 * `absent` IS STILL NOT ON THE LIST. `.fp-tile .absent` and `.fp-spot .absent` — two of
 * the three contextual rules slice 2's note named — go here, and the hook survives for
 * the last of them, `.fp-detail .absent`, which is slice 8's. `fp-chart-card`,
 * `fp-selected`, `fp-list` and every ladder name are likewise absent from this list and
 * must stay absent: they still have rules, and this same render still carries them.
 */
export const DELETED_IN_SLICE_7 = [
  "fp-header",
  "fp-header-head",
  "fp-header-id",
  "fp-badge",
  "fp-badge-pending",
  "fp-badge-active",
  "fp-badge-ended",
  "fp-badge-unreadable",
  "fp-spot",
  "fp-spot-value",
  "fp-spot-note",
  "fp-tile",
  "fp-tiles",
  "fp-tiles-quiet",
  "fp-tile-label",
  "fp-tile-value",
  "fp-progress",
  "fp-progress-track",
  "fp-progress-fill",
  "fp-waiting",
  "fp-waiting-sub",
  "fp-expected",
  "fp-expected-value",
  "fp-hero",
  "fp-hero-value",
];

/**
 * Everything a render test is allowed to reach for, re-exported from one place.
 *
 * `fireEvent` RIDES ALONGSIDE `userEvent`, NOT INSTEAD OF IT. Spec #403 §3.4 bought
 * `user-event` because a Tab walk is the only honest way to assert a keyboard path, and
 * that remains the default for every interaction. `fireEvent` is here for the controls
 * jsdom does not implement the keyboard behavior of — a range input steps for no arrow
 * key — where dispatching the event the browser would dispatch is the accurate stand-in
 * and driving it through `user-event` would assert nothing at all.
 */
export { screen, within, userEvent, fireEvent };
