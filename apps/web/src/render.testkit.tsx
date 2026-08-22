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

/** Everything a render test is allowed to reach for, re-exported from one place. */
export { screen, within, userEvent };
