/**
 * THE PUSH↔READER SUPPRESSION SEAM (audit finding 7).
 *
 * `glance.suppressed` is a list of KEYS: the push names a number it refuses to stand
 * behind, and the reader recognises the name and leaves the slot empty. The key is a
 * bare `string` on the wire, so the compiler cannot relate the writer's spelling to
 * the reader's — see the {@link SUPPRESSION_KEYS} docstring in
 * `../projection/contract.ts` for the full rationale and why one declared home fixes
 * it.
 *
 * This suite is what keeps it the ONLY home, in three parts that fail for three
 * different reasons:
 *
 *  1. the declared set is pinned, so a rename is a deliberate, visible edit;
 *  2. no production module hand-types a key — a new bare literal fails here even
 *     though it compiles;
 *  3. the keys the push emits really do empty the reader's slots, end to end, ONE KEY
 *     AT A TIME, so each key is proven load-bearing rather than merely imported.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { SnapshotAnchor } from "../projection/contract.ts";
import { SUPPRESSION_KEYS } from "../projection/contract.ts";
import { loadAnchorFixture } from "../push/anchor-fixture.ts";
import { computeVerdict } from "./verdict.ts";
import { composeBigPicture } from "./row-view.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
/** `apps/web/src` — the tree the textual guard below walks. */
const SRC = resolve(HERE, "..");

describe("the declared suppression keys", () => {
  it("pins the closed set of three header keys", () => {
    // Exhaustive by construction: `toEqual` on an object literal fails both on a
    // changed value and on a fourth key arriving, so a rename cannot be silent.
    expect(SUPPRESSION_KEYS).toEqual({
      fundValue: "summary.fundValueUsd",
      change: "summary.change",
      reserve: "summary.reserve",
    });
  });

  it("is DECLARED in the pg-free contract, not re-exported from somewhere else", () => {
    // `contract.test.ts` proves the contract stays pg-free from the module graph; this
    // proves the constant's declaration is the thing standing on that property. A
    // `export { SUPPRESSION_KEYS } from "../push/glance.ts"` would satisfy every other
    // test in this file while putting the real home back on the push side.
    const contract = readFileSync(resolve(SRC, "projection/contract.ts"), "utf-8");
    expect(contract).toContain("export const SUPPRESSION_KEYS");
  });
});

/**
 * The one declared home, enforced against the source rather than trusted to review.
 *
 * A hand-typed literal compiles and passes every behavioural test in the repo while
 * being wrong in exactly the way finding 7 describes, so the only guard that can catch
 * it is a textual one — and it scans the WHOLE tree rather than a hardcoded list of
 * today's spellers, because the next drift will be in a file that does not exist yet.
 *
 * Comments are stripped before matching (whitespace-for-comment, so line numbers still
 * point at the source): naming a key in prose is legal and these modules rightly do it,
 * while spelling one in code — in any quote style, backticks included — is not.
 */
describe("no production module hand-types a suppression key", () => {
  const LITERAL = /["'`]summary\.(?:fundValueUsd|change|reserve)["'`]/;
  const COMMENT = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;

  /** Every non-test module under `apps/web/src`, minus the keys' declared home. */
  const scanned = readdirSync(SRC, { recursive: true, encoding: "utf-8" })
    .filter((rel) => rel.endsWith(".ts") && !rel.endsWith(".test.ts"))
    .filter((rel) => resolve(SRC, rel) !== resolve(SRC, "projection/contract.ts"))
    .map((rel) => resolve(SRC, rel))
    .sort();

  it("walks the whole source tree, not a list that can go stale", () => {
    // A glob that silently matched nothing would make the guard below vacuous.
    expect(scanned.length).toBeGreaterThan(10);
    for (const speller of ["push/glance.ts", "glance/verdict.ts", "glance/row-view.ts"]) {
      expect(scanned).toContain(resolve(SRC, speller));
    }
  });

  it("spells no key in code, in any module", () => {
    const offenders: string[] = [];
    for (const absolute of scanned) {
      const source = readFileSync(absolute, "utf-8").replace(COMMENT, (block) =>
        block.replace(/[^\n]/g, " "),
      );
      source.split("\n").forEach((line, index) => {
        if (LITERAL.test(line)) offenders.push(`${relative(SRC, absolute)}:${index + 1}`);
      });
    }

    expect(
      offenders,
      "these spell a suppression key by hand; import SUPPRESSION_KEYS instead",
    ).toEqual([]);
  });

  it("reads them from the contract in each module that needs them", () => {
    // The negative above passes trivially for a module that stopped suppressing
    // altogether; this is the positive half for the three that must.
    for (const speller of ["push/glance.ts", "glance/verdict.ts", "glance/row-view.ts"]) {
      expect(readFileSync(resolve(SRC, speller), "utf-8")).toContain("SUPPRESSION_KEYS");
    }
  });
});

/**
 * End to end: the keys the PUSH emits are the keys the READER acts on.
 *
 * ONE KEY AT A TIME, because the reader's checks are ordered and an all-three payload
 * short-circuits on the first: `reserveSlot` returns on the suppressed `fundValue`
 * long before it reaches its own key's branch, so a single fully-suppressed fixture
 * asserts nothing about `reserve` at all. Each key therefore gets a payload where it
 * is the ONLY thing suppressed.
 *
 * Part 2 above proves nobody re-spells them; this proves the spelling still does its
 * job. Together they are what makes a rename safe — change the constant and both
 * halves move, because there is nothing else to move.
 */
describe("keys emitted by the push empty the reader's slots", () => {
  /**
   * The newest fixture anchor with exactly `keys` suppressed. `loadAnchorFixture`
   * re-parses the committed file per call, so mutating what it returns is safe.
   */
  async function suppressing(...keys: string[]): Promise<{
    anchors: SnapshotAnchor[];
    latest: SnapshotAnchor;
  }> {
    const anchors = await loadAnchorFixture();
    const latest = anchors[anchors.length - 1] as SnapshotAnchor;
    latest.report.glance.suppressed = keys;
    return { anchors, latest };
  }

  function verdictFor(latest: SnapshotAnchor, anchors: SnapshotAnchor[]) {
    return computeVerdict(latest, anchors, new Date(`${latest.asOf}T12:00:00Z`));
  }

  it("empties the fund-value slot, and the /big-picture columns that divide by it", async () => {
    const { anchors, latest } = await suppressing(SUPPRESSION_KEYS.fundValue);
    const verdict = verdictFor(latest, anchors);
    const view = composeBigPicture(latest, anchors);

    expect(verdict.slots.fundValue.rendered).toBe(false);
    expect(view.fundValueRendered).toBe(false);
    expect(view.percentOfFundRendered).toBe(false);
  });

  it("empties the change slot alone, leaving the other two standing", async () => {
    const { anchors, latest } = await suppressing(SUPPRESSION_KEYS.change);
    const verdict = verdictFor(latest, anchors);

    expect(verdict.slots.change.rendered).toBe(false);
    expect(verdict.slots.fundValue.rendered).toBe(true);
    expect(verdict.slots.reserve.rendered).toBe(true);
  });

  it("empties the reserve slot alone — the branch an all-three payload never reaches", async () => {
    const { anchors, latest } = await suppressing(SUPPRESSION_KEYS.reserve);
    // The two inputs that would return EARLIER for a different reason, so a pass here
    // is the reserve KEY doing the work and not an absent focus or an absent floor.
    expect(latest.report.dashboard.summary.reserve).toBeDefined();
    expect(latest.report.glance.reserveTargetPct).toBeDefined();

    const verdict = verdictFor(latest, anchors);

    expect(verdict.slots.reserve.rendered).toBe(false);
    expect(verdict.slots.reserve.suppressedBy).toBe("unexpected-absence");
    expect(verdict.slots.fundValue.rendered).toBe(true);
    expect(verdict.slots.change.rendered).toBe(true);
  });

  it("leaves all three unrendered when the push emits all three", async () => {
    const { anchors, latest } = await suppressing(...Object.values(SUPPRESSION_KEYS));
    const verdict = verdictFor(latest, anchors);

    expect(verdict.slots.fundValue.rendered).toBe(false);
    expect(verdict.slots.change.rendered).toBe(false);
    expect(verdict.slots.reserve.rendered).toBe(false);
  });

  it("renders all three when nothing is suppressed — the guard is not vacuous", async () => {
    const { anchors, latest } = await suppressing();
    const verdict = verdictFor(latest, anchors);

    expect(verdict.slots.fundValue.rendered).toBe(true);
    expect(verdict.slots.change.rendered).toBe(true);
    expect(verdict.slots.reserve.rendered).toBe(true);
    expect(composeBigPicture(latest, anchors).fundValueRendered).toBe(true);
  });
});
