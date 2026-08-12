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
 * ── THE HOLES IN THE FIRST STRUCTURAL SCAN, AND THE CHECK THAT CLOSED THEM ──────────
 * A review of PR #308 showed the scan above passing SIX spellings of a copy-driven branch
 * that the one baseline spelling had made look covered. Each was written into production
 * `FillPath.tsx`, the scan run, and the file reverted — before and after, one run each:
 *
 *  | spelling                                            | first scan | this scan |
 *  | `rung.stateCopy === "waiting"` (the baseline)        | caught     | caught    |
 *  | `switch (rung.stateCopy) { case "waiting": … }`      | MISSED     | caught    |
 *  | `["waiting", "partly filled"].includes(…stateCopy)`  | MISSED     | caught    |
 *  | `HIDE[rung.stateCopy]` (a map lookup)                | MISSED     | caught    |
 *  | `"waiting" === rung.stateCopy` (reversed)            | MISSED     | caught    |
 *  | `const s = rung.stateCopy; s === "partly filled · 40%"` | MISSED  | caught    |
 *  | `const doc = "https://x"; if (rung.stateCopy === …)` | MISSED     | caught    |
 *
 * The last row is not a spelling at all — it is the SCANNER: `code()` deleted from any `//`
 * to the end of the line, so a URL hid whatever followed it. The reversed comparison and the
 * alias are why the `stateCopy` check is now a whitelist of the legitimate reads rather than
 * a list of the offending operators, and the decorated phrase is why the copy backstop
 * matches `partly filled · 40%` as well as `partly filled`. See each helper's own note.
 *
 * WHAT A SOURCE SCAN STILL CANNOT SEE, stated rather than left implied: a value handed out
 * of the file (`hide(cond ? rung.stateCopy : "")`) — the read is legitimate in shape and no
 * regex follows it. It is covered only in the sense that the branch at the far end has to
 * compare against a phrase, which the second half of the scan finds. A component-test
 * toolchain (D1) is what would close it outright.
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
 * `stateCopy` DOING ANYTHING BUT RENDERING — A WHITELIST, NOT A LIST OF OPERATORS.
 *
 * THE FIRST VERSION ENUMERATED THE OFFENDING SHAPES (`stateCopy` followed by `==`, `.`, or
 * `[`) and five natural spellings of a copy-driven branch walked straight through it:
 * `switch (rung.stateCopy)`, `["waiting", …].includes(rung.stateCopy)`, a map lookup
 * `HIDE[rung.stateCopy]`, the reversed comparison `"waiting" === rung.stateCopy`, and an
 * alias (`const state = rung.stateCopy`) compared afterwards. An operator blacklist is the
 * wrong shape for this: the offending spellings are open-ended and the LEGITIMATE ones are
 * not, so the legitimate ones are what is enumerated.
 *
 * There are exactly two of those, and every read must be one of them:
 *
 *  1. A DECLARATION OR AN AUTHORING ASSIGNMENT — bare `stateCopy:`, no receiver. The
 *     field on `FillPathRungView`, and the one object literal that fills it in.
 *  2. A READ THAT ONLY EVER HANDS THE STRING ON — `rung.stateCopy` opened by `{`, `?` or
 *     `:` (rendered into JSX, or carried through a ternary the way `RowState` does) and
 *     closed by `}`, `;`, `:` or `,`. A branch cannot be spelled inside those bounds:
 *     every operator that asks a question, and every bracket that indexes or calls with
 *     it, changes one end or the other.
 *
 * THE RESIDUAL, NAMED. A read may still be handed to a function that branches
 * (`hide(cond ? rung.stateCopy : "")`), and no source scan can follow a value out of the
 * file. What closes that case is the OTHER half below: wherever the aliased value is finally
 * compared, it is compared against one of {@link COPY_ONLY_PHRASES}, and that comparison is
 * what {@link comparedPhrases} finds. The two halves cover each other; neither alone.
 */
function interrogations(source: string): boolean {
  const OPENS = new Set(["{", "?", ":"]);
  const CLOSES = new Set(["}", ";", ":", ","]);
  for (const match of source.matchAll(/\bstateCopy\b/g)) {
    const head = source.slice(0, match.index).trimEnd();
    const tail = source.slice(match.index + "stateCopy".length).trimStart();
    // The declaration and the authoring assignment: a key, with no receiver before it.
    if (!head.endsWith(".") && tail.startsWith(":")) continue;
    // …otherwise it is a read off a rung, and both of its ends are checked.
    const lead = head.replace(/\w+\.$/, "").trimEnd().slice(-1);
    if (OPENS.has(lead) && CLOSES.has(tail.slice(0, 1))) continue;
    return true;
  }
  return false;
}

/**
 * A COPY PHRASE USED AS A PREDICATE — in any of the shapes a branch on words comes in.
 *
 * The first version matched only `[!=]== "phrase"`, with the closing quote required
 * immediately after the phrase. So `"waiting" === state` (the comparison written the other
 * way round), `case "waiting":`, `["waiting", …].includes(…)` and — worst — the DECORATED
 * form `state === "partly filled · 40%"` all read as clean, the last one because the
 * percentage sits between the phrase and its quote.
 *
 * So the phrase may now carry a decoration (` · 40%`, and nothing else: a suffix must start
 * with the middot separator the copy itself uses, which is what keeps `"waitingDeclaredUsd"`
 * and `"nothing-waiting"` from matching), and it is flagged in FOUR contexts — compared from
 * either side, `case`-matched, or passed as a call argument or array member, which is how
 * membership is spelled. A phrase sitting in a `key: "value"` position is data, not a
 * predicate, and the fixtures author engine-side labels exactly that way.
 */
function comparedPhrases(source: string): string[] {
  const found: string[] = [];
  for (const phrase of COPY_ONLY_PHRASES) {
    const quoted = `["'\`]${phrase}(?: · [^"'\`]*)?["'\`]`;
    const predicate = new RegExp(
      `(?:[!=]==\\s*${quoted}` + // state === "waiting"
        `|${quoted}\\s*[!=]==` + // "waiting" === state
        `|case\\s+${quoted}` + // switch (state) { case "waiting":
        `|[[(,]\\s*${quoted}\\s*[\\])[,]` + // ["waiting", …].includes(state), f("waiting")
        `)`,
    );
    if (predicate.test(source)) found.push(phrase);
  }
  return found;
}

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
 *
 * STRING-AWARE, BECAUSE `//` LIVES IN STRINGS TOO. The first version was two regexes, and
 * the second one deleted from `//` to the end of the line without knowing whether the `//`
 * was code: one `"https://…"` anywhere on a line swallowed the rest of it, and a branch on
 * the far side of that URL scanned clean. So this walks the source instead, and a quoted
 * or backticked run is copied through untouched — which is also what lets the phrase scan
 * above read literals at all.
 */
function code(source: string): string {
  let out = "";
  let at = 0;
  while (at < source.length) {
    const char = source[at]!;
    const next = source[at + 1];
    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", at + 2);
      at = end < 0 ? source.length : end + 2;
      continue;
    }
    if (char === "/" && next === "/") {
      const end = source.indexOf("\n", at);
      // The newline is KEPT: a stripped comment must not join two lines of code.
      at = end < 0 ? source.length : end;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      const opened = at;
      at += 1;
      while (at < source.length) {
        if (source[at] === "\\") {
          at += 2;
          continue;
        }
        if (source[at] === char) {
          at += 1;
          break;
        }
        at += 1;
      }
      out += source.slice(opened, at);
      continue;
    }
    out += char;
    at += 1;
  }
  return out;
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
      if (interrogations(source)) {
        offenders.push(`${path}: reads stateCopy for something other than rendering`);
      }
      for (const copy of comparedPhrases(source)) {
        offenders.push(`${path}: compares the words "${copy}"`);
      }
    }
    expect(offenders).toEqual([]);
    // The exemption is one file. If a second module starts spelling state words, this
    // count is the thing that says so before the words are two homes deep.
    expect(authoringSites).toBe(1);
  });

  it("strips comments without being fooled by a slash inside a string", () => {
    // THE SCAN IS ONLY AS GOOD AS WHAT IT READS, and the first `code()` deleted from any
    // `//` to the end of the line. A URL therefore hid every branch written after it on
    // the same line — the one input where a clean scan proved nothing at all.
    const withUrl = 'const doc = "https://x"; if (rung.stateCopy === "waiting") drop();';
    expect(code(withUrl)).toBe(withUrl);
    expect(interrogations(code(withUrl))).toBe(true);
    // …while a real comment, and only the comment, still goes.
    expect(code('keep("a"); // rung.stateCopy === "waiting"\nkeep("b");')).toBe(
      'keep("a"); \nkeep("b");',
    );
    expect(code('keep(1); /* rung.stateCopy === "waiting" */ keep(2);')).toBe(
      "keep(1);  keep(2);",
    );
    // An apostrophe inside a comment must not open a string and swallow the code after it.
    expect(code("// the rung's state\nkeep(3);")).toBe("\nkeep(3);");
  });

  it("spells the filled predicate once on the render path (census)", () => {
    // `venueAxis === "filled"` IS A FACT COMPARISON, which is why the copy scan above
    // deliberately leaves bare `filled` alone. But it is a fact the picture, the legend and
    // the rung list all colour from, so it is spelled ONCE — `venueFilled` — and this is
    // the census that says so. It reads every remaining site, not zero of them, because
    // two are outside the render path and are meant to stay:
    //
    //  - `push/fixture-synthesis.ts` × 2: the three-way FALLBACK RATIO (filled→1,
    //    resting→0, else 0.5), which is not the predicate at all, and the synthesizer's own
    //    Σ of unfilled sizes. Both are on the PUBLISH path, which imports nothing from
    //    `ladder/` — routing the public-fixture synthesizer through the ladder page's view
    //    module to save a literal would buy the nit with a dependency pointing the wrong
    //    way. Recorded here instead, so the count is a decision rather than a leftover.
    const census = new Map<string, number>([
      [join("ladder", "fill-path-view.ts"), 1],
      [join("push", "fixture-synthesis.ts"), 2],
    ]);
    const found = new Map<string, number>();
    for (const { path, source } of productionSources()) {
      const hits = source.match(/venueAxis\s*[!=]==\s*["'`]filled["'`]/g)?.length ?? 0;
      if (hits > 0) found.set(path.slice(WEB_SRC.length + 1), hits);
    }
    expect(Object.fromEntries(found)).toEqual(Object.fromEntries(census));
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
