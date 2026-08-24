// @vitest-environment jsdom
/**
 * THE HARNESS'S OWN INSTRUMENT, PINNED — `classCensus` is shared by six test files and
 * nothing was checking it.
 *
 * A census is what makes "this card still emits the classes it emitted before" an
 * assertion rather than an inspection, so the whole class-string half of spec #403's
 * byte-identical-`styles.css` claim stands on this one function. An instrument that
 * quietly returns the wrong kind of value does not fail — it reports, in a diff, a thing
 * that is not a class.
 *
 * THE SVG CASE IS THE WHOLE REASON THIS FILE EXISTS. `Element.className` is a string on
 * an HTML element and an `SVGAnimatedString` object on an SVG one, and the static type at
 * the census is `Element`, so TypeScript accepts both and the declared `string[]` is a
 * lie for any subtree containing a chart. It is not hypothetical here: the fill path's
 * chart card carries `fp-chart-card` on a `Card` and a mounted `<svg>` beneath it, so the
 * obvious next census — "the chart card still emits the classes it emitted before" — is
 * exactly the one that would have reported `[{}, …]` and stopped deduping.
 *
 * Every fixture below is authored markup. No component and no product data is involved:
 * this is a test of the harness, and reaching for a real component would make it a test
 * of that component's markup instead.
 */
import { describe, expect, it } from "vitest";

import {
  appStyleSheet,
  classCensus,
  render,
  styleSheetClassSelectors,
} from "./render.testkit.tsx";

describe("classCensus", () => {
  it("reads SVG class attributes as strings, like every other element's", () => {
    const { container } = render(
      <div className="card">
        <svg className="chart-surface">
          <g className="chart-marks" />
        </svg>
      </div>,
    );

    const census = classCensus(container.firstElementChild!);

    // The kind first, because the value assertion below would pass on `["card"]` alone
    // and the SVG failure mode is a NON-STRING sitting in a `string[]`.
    expect(census.map((entry) => typeof entry)).toEqual([
      "string",
      "string",
      "string",
    ]);
    expect(census).toEqual(["card", "chart-marks", "chart-surface"]);
  });

  it("dedupes a class string repeated across the HTML and SVG namespaces", () => {
    // Two SVG elements carrying the SAME class deduped to one entry only once the census
    // reads a string: distinct `SVGAnimatedString` objects are distinct `Set` members.
    const { container } = render(
      <div className="card">
        <svg className="mark">
          <g className="mark" />
        </svg>
      </div>,
    );

    expect(classCensus(container.firstElementChild!)).toEqual(["card", "mark"]);
  });

  it("censuses the root itself, deduped, sorted, and whole attributes at a time", () => {
    const { container } = render(
      <section className="card fp-list">
        <p className="muted absent-why" />
        <p className="muted" />
        <p className="muted" />
      </section>,
    );

    // `"muted absent-why"` and `"muted"` stay two facts about two elements — the census
    // is over whole `class` attributes, never over tokens.
    expect(classCensus(container.firstElementChild!)).toEqual([
      "card fp-list",
      "muted",
      "muted absent-why",
    ]);
  });

  it("reports an unclassed root as an empty string rather than dropping it", () => {
    const { container } = render(
      <div>
        <span className="absent" />
      </div>,
    );

    expect(classCensus(container.firstElementChild!)).toEqual(["", "absent"]);
  });
});

/**
 * THE PARSE BEHIND THE TERMINAL ASSERTION (spec #420 Seam E, slice 9).
 *
 * The five structure tests intersect what they render against what this returns, and an
 * empty result makes all five pass no matter what is in the stylesheet. So the parse is
 * pinned against a sample that contains every shape the real file could take back:
 * a bare class, a compound, a descendant, a class quoted inside a comment, and a
 * declaration value with a dot in it.
 */
describe("styleSheetClassSelectors", () => {
  const SAMPLE = [
    "/* a comment naming .commented, which is not a selector */",
    ":root { --x: 1; }",
    ".plain { color: red; }",
    ".compound.state, .head .child { transition: opacity .25s; }",
    "@media (min-width: 380px) { .nested { margin: 0; } }",
  ].join("\n");

  it("collects every class a selector names, and nothing a comment or a value does", () => {
    expect([...styleSheetClassSelectors(SAMPLE)].sort()).toEqual([
      "child",
      "compound",
      "head",
      "nested",
      "plain",
      "state",
    ]);
  });

  it("reads the app's own stylesheet by default", () => {
    // Guards the guard from the other side: the default argument must reach a real file
    // with real content, or the five intersections below it are green by vacuum.
    expect(appStyleSheet()).toMatch(/:root\s*\{/);
  });
});
