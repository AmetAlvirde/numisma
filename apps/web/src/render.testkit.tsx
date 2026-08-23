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
