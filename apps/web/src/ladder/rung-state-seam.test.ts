/**
 * SEAM C — THE ENGINE→WEB CROSSING CARRIES FACTS, NOT COPY (spec #302 slice D, #306).
 *
 * ── THE DEFECT THIS FILE IS THE GUARD FOR ───────────────────────────────────────────
 * `packages/engine/src/fill-path.ts` authors display copy (`waiting`, `declared — not
 * placed`, `partly filled · n%`) and it crosses the wire as `DcaWireRung.label`. Two web
 * components then BRANCHED on the literal — `rung.label === "waiting"` decided whether a
 * rung printed a state at all. Reword the engine's string and the web breaks in silence:
 * the engine's own tests move with the string, `tsc` is green, every test is green, and
 * the rung list resumes printing the default word down all eight rows.
 *
 * NOTHING ELSE WOULD HAVE CAUGHT IT. There is no component-test toolchain (D1, deferred —
 * `docs/coverage-rationale.md` §6), so the components' branches are only reachable through
 * the view they are handed. So the invariant is asserted here, at the crossing, in the two
 * forms that together close it:
 *
 *  1. BEHAVIORALLY — reword every `label` on the wire and the composed view is unchanged,
 *     field for field. The web's answer does not depend on the engine's words.
 *  2. STRUCTURALLY — no state copy is compared in the components (or anywhere in
 *     `apps/web`), read off the source the way `glance/row-view.test.ts` reads its own.
 *     A behavioral test cannot see a branch a component takes; this can.
 *
 * ── MUTATION CHECK (performed 2026-08-12) ───────────────────────────────────────────
 *  - restored the old coupling in `fill-path-view.ts` (`if (rung.label !== undefined)
 *    return rung.label` ahead of `rungStateCopy`) → "the composed view does not depend on
 *    the engine's words" red at the first reworded rung, `expected 'ZZ REWORDED …' to be
 *    'filled'`. Right reason: that IS the defect, in the one line it lived on.
 *  - reworded the engine's `"resting"` arm to `"resting at venue"` and ran the whole
 *    suite: green, and the fixture surface unchanged — which is the property, not a gap.
 *    Under the old code the same edit changed what every waiting row printed.
 *  - put `rung.stateCopy === "waiting"` back into `Pills` → "compares no state copy in a
 *    component" red on `FillPath.tsx`. Right reason: the structural half exists precisely
 *    because no test can render `Pills`.
 *
 * EVERY VALUE BELOW IS AUTHORED, or is one of the hand-authored fixtures; nothing here is
 * seeded from real output (`docs/local-data.md`).
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { composeFillPathPage, type FillPathView } from "./fill-path-view.ts";
import { rungStateCopy } from "./rung-state-copy.ts";
import { STARTED_LADDER_FIXTURES } from "./started-ladder.fixtures.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_SRC = join(HERE, "..");

/**
 * The state words, as the surface prints them — every one that is COPY AND NOTHING ELSE.
 *
 * BARE `filled` IS DELIBERATELY ABSENT: it is also the `venueAxis` literal, so
 * `venueAxis === "filled"` (`venueFilled`, one site) is a FACT comparison — the exact
 * thing this slice moved the branches ONTO. Everything below is a phrase no axis, no book
 * state and no wire enum can be, so a comparison against one can only be copy driving a
 * branch. `stateCopy` being touched at all is caught separately.
 */
const COPY_ONLY_PHRASES = [
  "waiting",
  "declared — not placed",
  "cancelled — fills recorded against it",
  "fill state unavailable",
  "filled at venue — not recorded",
  "filled at venue — partly recorded",
  "partly filled",
] as const;

/**
 * `stateCopy` DOING ANYTHING BUT RENDERING — compared, indexed, or asked a question with
 * a method (`.startsWith`, `.includes`). Rendering it reads `{rung.stateCopy}`, which this
 * does not match.
 */
const COPY_INTERROGATED = /\bstateCopy\s*(?:[!=<>]=|\.\w|\[)/;

function compose(
  fixture: (typeof STARTED_LADDER_FIXTURES)[number],
): FillPathView {
  const page = composeFillPathPage(fixture.anchor, fixture.planId, fixture.spot);
  expect(page.status, `${fixture.name} does not compose`).toBe("ok");
  return (page as { status: "ok"; view: FillPathView }).view;
}

/**
 * CODE ONLY, COMMENTS STRIPPED — this repo documents the branch it deleted, in prose, at
 * the site it deleted it from (`Pills` says what it used to compare and why that was the
 * bug). Scanning prose would make the record of the fix indistinguishable from the fix's
 * absence, so the record is removed before the scan and the comparison operators are what
 * is left to find.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** Every `.ts`/`.tsx` file under `apps/web/src`, code text, excluding tests. */
function productionSources(): { path: string; source: string }[] {
  const out: { path: string; source: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) {
        continue;
      }
      out.push({ path, source: code(readFileSync(path, "utf8")) });
    }
  };
  walk(WEB_SRC);
  return out;
}

describe("the state words are authored on the web, from the axes", () => {
  it("spells every arm, including both absences, and rewords none of them", () => {
    // THE RENDERED STRINGS ARE THE SHIPPED ONES. Copy moved house in #306; it was not
    // reworded, and this is the assertion that makes a rewording a visible decision.
    expect(rungStateCopy({ reconciled: true })).toBe("declared — not placed");
    // ABSENCE RULE 2 IS A DIFFERENT ABSENCE. The same missing axis on an unreconciled
    // row means "nobody checked", and saying `declared — not placed` there would state
    // a fact nobody established.
    expect(rungStateCopy({ reconciled: false })).toBe("fill state unavailable");
    expect(
      rungStateCopy({ reconciled: true, venueAxis: "resting", bookAxis: "not-recorded" }),
    ).toBe("waiting");
    expect(
      rungStateCopy({
        reconciled: true,
        venueAxis: "partly-filled",
        bookAxis: "recorded",
        filledPercent: 40,
      }),
    ).toBe("partly filled · 40%");
    // The percentage DECORATES the state. A wire rung carrying the axis without its
    // measured fraction still has a state to print, and prints it.
    expect(
      rungStateCopy({ reconciled: true, venueAxis: "partly-filled" }),
    ).toBe("partly filled");
    expect(
      rungStateCopy({ reconciled: true, venueAxis: "filled", bookAxis: "recorded" }),
    ).toBe("filled");
    expect(
      rungStateCopy({ reconciled: true, venueAxis: "filled", bookAxis: "not-recorded" }),
    ).toBe("filled at venue — not recorded");
    expect(
      rungStateCopy({
        reconciled: true,
        venueAxis: "filled",
        bookAxis: "partly-recorded",
      }),
    ).toBe("filled at venue — partly recorded");
    // A CANCELLED RUNG THE FUND BOOKED AGAINST is not an unplaced one — the two axes
    // together, which is the whole reason the copy is a function of both.
    expect(
      rungStateCopy({ reconciled: true, venueAxis: "not-placed", bookAxis: "recorded" }),
    ).toBe("cancelled — fills recorded against it");
    expect(
      rungStateCopy({
        reconciled: true,
        venueAxis: "not-placed",
        bookAxis: "not-recorded",
      }),
    ).toBe("declared — not placed");
  });

  it("the composed view does not depend on the engine's words", () => {
    // REWORD EVERY LABEL ON THE WIRE — the exact edit that used to break the web in
    // silence — and compare the whole view, field for field. `partly-walked` carries all
    // four venue axes plus a never-placed rung, so one fixture covers every arm.
    for (const fixture of STARTED_LADDER_FIXTURES) {
      const before = compose(fixture);
      const reworded = structuredClone(fixture);
      let count = 0;
      for (const position of reworded.anchor.report.dca.positions) {
        for (const rung of position.rungs ?? []) {
          if (rung.label === undefined) continue;
          rung.label = `ZZ REWORDED ${rung.label} ZZ`;
          count += 1;
        }
      }
      expect(count, `${fixture.name} carries no engine label to reword`).toBeGreaterThan(
        0,
      );
      expect(compose(reworded), `${fixture.name} reads the wire's label`).toEqual(before);
    }
  });

  it("compares no state copy in a component — copy renders, it never branches", () => {
    // THE STRUCTURAL HALF. `Pills` and `RowState` cannot be rendered by any test in this
    // repo, so nothing behavioral can see which branch they take. What CAN be seen is
    // whether the branch is spelled against words: a comparison of `stateCopy`, or of any
    // shipped state string, anywhere in production `apps/web` source.
    const offenders: string[] = [];
    let authoringSites = 0;
    for (const { path, source } of productionSources()) {
      if (path.endsWith(join("ladder", "rung-state-copy.ts"))) {
        // The ONE authoring site, exempt because it is the only file that may hold these
        // words at all — and it holds them as returns, never as comparisons.
        authoringSites += 1;
        continue;
      }
      if (COPY_INTERROGATED.test(source)) {
        offenders.push(`${path}: asks a question of stateCopy`);
      }
      for (const copy of COPY_ONLY_PHRASES) {
        const compared = new RegExp(`[!=]==\\s*["'\`]${copy}["'\`]`);
        if (compared.test(source)) {
          offenders.push(`${path}: compares the words "${copy}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
    // The exemption is one file. If a second module starts spelling state words, this
    // count is the thing that says so before the words are two homes deep.
    expect(authoringSites).toBe(1);
  });

  it("leaves the wire alone — the engine's label still crosses it (C1)", () => {
    // #306 is the PACKAGE boundary, not the schema. The label remains on the wire as the
    // convenience it was written to be (one spelling for the phone and the desk); what
    // changed is that this side no longer reads it. A contract test asserting the field's
    // absence would be this slice overreaching into a schema change nobody approved.
    const contract = readFileSync(
      join(WEB_SRC, "projection", "contract.ts"),
      "utf8",
    );
    expect(contract).toMatch(/label\?: string;/);
    const carried = STARTED_LADDER_FIXTURES.flatMap((fixture) =>
      fixture.anchor.report.dca.positions.flatMap((position) =>
        (position.rungs ?? []).filter((rung) => rung.label !== undefined),
      ),
    );
    expect(carried.length).toBeGreaterThan(0);
  });
});
