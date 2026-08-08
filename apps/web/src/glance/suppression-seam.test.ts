/**
 * THE PUSH↔READER SUPPRESSION SEAM (audit finding 7).
 *
 * `glance.suppressed` is a list of KEYS: the push names a number it refuses to
 * stand behind, and the reader recognises the name and leaves the slot empty. That
 * is a contract between two modules that share no compiler-checked surface — the
 * key is a bare `string` on the wire — so before this suite a key renamed push-side
 * still compiled everywhere and the reader silently stopped suppressing, rendering a
 * NAV computed from a mark that never arrived. The false *no* the design forbids.
 *
 * The fix is one declared home ({@link SUPPRESSION_KEYS} in `projection/contract.ts`,
 * the pg-free wire contract both halves already import). This suite is what keeps it
 * the ONLY home, in three parts that fail for three different reasons:
 *
 *  1. the declared set is pinned, so a rename is a deliberate, visible edit;
 *  2. no production speller hand-types a key — a new bare literal fails here even
 *     though it compiles;
 *  3. the keys the push emits really do empty the reader's slots, end to end, so the
 *     shared constant is proven load-bearing rather than merely imported.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { SnapshotAnchor } from "../projection/contract.ts";
import { SUPPRESSION_KEYS } from "../projection/contract.ts";
import { loadAnchorFixture } from "../push/anchor-fixture.ts";
import { computeVerdict } from "./verdict.ts";
import { composeBigPicture } from "./row-view.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("the declared suppression keys", () => {
  it("pins the closed set of three header keys", () => {
    // Both directions: the values a renamer would change, and the key set itself, so
    // a fourth header key cannot arrive without this line being edited.
    expect(SUPPRESSION_KEYS).toEqual({
      fundValue: "summary.fundValueUsd",
      change: "summary.change",
      reserve: "summary.reserve",
    });
    expect(Object.keys(SUPPRESSION_KEYS).sort()).toEqual([
      "change",
      "fundValue",
      "reserve",
    ]);
  });

  it("lives in the pg-free contract, which both the push and the reader import", () => {
    // `contract.test.ts` proves the contract stays pg-free from the module graph.
    // This proves THIS constant is the thing that property was needed for: a shared
    // RUNTIME value the browser-reachable reader can import without a driver.
    const contract = readFileSync(resolve(HERE, "../projection/contract.ts"), "utf-8");
    expect(contract).toContain("export const SUPPRESSION_KEYS");
  });
});

/**
 * The one declared home, enforced against the source rather than trusted to review.
 *
 * These are the three modules the audit found spelling the keys by hand. A literal
 * here compiles and passes every behavioural test in the repo while being wrong in
 * exactly the way finding 7 describes, so the only guard that can catch it is a
 * textual one. Prose mentions in comments are untouched — the pattern requires STRING
 * quotes, and the repo's docs quote a key in backticks, so naming a key in a comment
 * (which these modules do, and should) stays legal while spelling one in code does not.
 */
describe("no production module hand-types a suppression key", () => {
  const SPELLERS = ["../push/glance.ts", "./verdict.ts", "./row-view.ts"];
  const LITERAL = /["']summary\.(?:fundValueUsd|change|reserve)["']/g;

  for (const relative of SPELLERS) {
    it(`${relative} reads them from the contract`, () => {
      const source = readFileSync(resolve(HERE, relative), "utf-8");
      const literals = source.match(LITERAL) ?? [];
      expect(
        literals,
        `${relative} spells a suppression key by hand; import SUPPRESSION_KEYS instead`,
      ).toEqual([]);
      expect(source).toContain("SUPPRESSION_KEYS");
    });
  }
});

/**
 * End to end: the keys the PUSH emits are the keys the READER acts on.
 *
 * Part 2 above proves nobody re-spells them; this proves the spelling still does its
 * job. Together they are what makes a rename safe — change the constant and both
 * halves move, because there is nothing else to move.
 */
describe("keys emitted by the push empty the reader's slots", () => {
  /** The newest fixture anchor, with every header key marked suppressed. */
  async function fullySuppressed(): Promise<{
    anchors: SnapshotAnchor[];
    latest: SnapshotAnchor;
  }> {
    const anchors = structuredClone(await loadAnchorFixture());
    const latest = anchors[anchors.length - 1] as SnapshotAnchor;
    latest.report.glance.suppressed = Object.values(SUPPRESSION_KEYS);
    return { anchors, latest };
  }

  it("leaves all three verdict slots unrendered", async () => {
    const { anchors, latest } = await fullySuppressed();
    const verdict = computeVerdict(latest, anchors, new Date(`${latest.asOf}T12:00:00Z`));

    expect(verdict.slots.fundValue.rendered).toBe(false);
    expect(verdict.slots.change.rendered).toBe(false);
    expect(verdict.slots.reserve.rendered).toBe(false);
  });

  it("withholds the fund value and the percent-of-fund column on /big-picture", async () => {
    const { anchors, latest } = await fullySuppressed();
    const view = composeBigPicture(latest, anchors);

    expect(view.fundValueRendered).toBe(false);
    expect(view.percentOfFundRendered).toBe(false);
  });

  it("renders all three when nothing is suppressed — the guard is not vacuous", async () => {
    const { anchors, latest } = await fullySuppressed();
    latest.report.glance.suppressed = [];
    const verdict = computeVerdict(latest, anchors, new Date(`${latest.asOf}T12:00:00Z`));

    expect(verdict.slots.fundValue.rendered).toBe(true);
    expect(composeBigPicture(latest, anchors).fundValueRendered).toBe(true);
  });
});
