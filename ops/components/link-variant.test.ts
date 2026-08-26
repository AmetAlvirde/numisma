import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EXCLUDED_CONTRAST_PAIRS } from "../../packages/components/src/contrast.ts";
import {
  REPO_ROOT,
  sourceFiles,
  workspaceGroups,
  workspacePackageDirs,
} from "../testkit/repo-sources.testkit.ts";

/**
 * THE CONDITION UNDER `--nms-primary` ON A CARD (spec #451 §10; PR #460 review).
 *
 * `contrast.ts` excludes `--nms-primary` as text, and the whole exclusion rests
 * on one sentence of fact: Button `variant="link"` renders in the workbench's
 * fixture and on no shipped app surface, so nothing fails for a user today.
 * That sentence measures 3.77:1 against SC 1.4.3's 4.5 and is the only thing
 * standing between the app and a real contrast failure.
 *
 * IT WAS PROSE, AND PROSE DOES NOT GO RED. Ship a link button tomorrow and the
 * exclusion becomes false silently: no guard fires, no reviewer is told, and the
 * app carries type nobody can read. This file is the condition turned into a
 * check. `contrast.ts`'s exclusion names it back, so a reader who finds the
 * exclusion finds what enforces it, and the case at the bottom asserts that
 * naming rather than trusting it.
 *
 * WHAT THIS IS NOT: a reason to mint a text-side blue. Spec §10 rules that the
 * value decision belongs to the first case that needs one, and there is no case.
 * A blue chosen now would be a five-sided decision — package default, themed
 * mode, app palette, pair list, docs — made for a surface nobody has asked for.
 * The day someone does, the red below is the ask, and the answer is a mint
 * BEFORE the variant ships, not after.
 *
 * SHIPPED IS DERIVED, NOT NAMED. The scan takes every app in the workspace's
 * `apps` group and subtracts the review surfaces declared below, so a second
 * shipped app is covered the day its `package.json` lands rather than the day
 * someone remembers this file. `apps/workbench` is the one subtraction and it is
 * a declaration with an argument, not a path in a filter: showing the variant is
 * the fixture's whole job, and a guard that reds on it would be a guard against
 * reviewing components.
 *
 * TESTS ARE OUT OF SCOPE FOR THE SAME REASON THE WORKBENCH IS. A test that
 * renders the variant to assert something about it ships to nobody, and a guard
 * that forbade it would forbid testing the thing it guards.
 */

/** An app that exists to be reviewed rather than shipped, and why it is exempt. */
interface ReviewSurface {
  /** Repo-relative app directory, as `workspacePackageDirs()` spells it. */
  readonly dir: string;
  /** Why the variant is allowed to render here. A sentence, not a label. */
  readonly reason: string;
}

const REVIEW_SURFACES: readonly ReviewSurface[] = [
  {
    dir: "apps/workbench",
    reason:
      "react-cosmos, and the one surface in the repo whose product IS the enumeration of every state a component has. `button.fixture.tsx` renders all six variants side by side under three theme modes, which is how anyone finds out that `link` is unreadable on a dark card in the first place. Forbidding the variant here would delete the evidence for the exclusion this file enforces, and the workbench reaches no user: it has no route, no deploy and no SSR.",
  },
];

/** The forms a caller can reach Button's `link` variant through. */
const LINK_VARIANT_FORMS: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  {
    label: "a JSX `variant` attribute",
    pattern: /variant\s*=\s*(?:"link"|'link'|\{\s*["']link["']\s*\})/g,
  },
  {
    label: "a `variant` property, which is how `buttonVariants` is called",
    pattern: /variant\s*:\s*["']link["']/g,
  },
];

/**
 * Files that could be reaching Button at all — the ones naming `Button` or
 * `buttonVariants`.
 *
 * WHY THE NAME GATE. `variant="link"` on some future component of the app's own
 * would be a false red, and a false red on an accessibility guard is how a guard
 * gets deleted. Matching the name rather than the import specifier is deliberate
 * and wider: a local wrapper that re-exports the package's Button under its own
 * module still carries the word, and so does a star-import member read, both of
 * which an import-specifier match would walk straight past.
 */
const REACHES_BUTTON = /\b(?:Button|buttonVariants)\b/;

/** Every app the repo ships, derived from the workspace manifest. */
function shippedAppDirs(): string[] {
  const exempt = new Set(REVIEW_SURFACES.map((surface) => surface.dir));
  return workspacePackageDirs().filter(
    (dir) => dir.startsWith("apps/") && !exempt.has(dir),
  );
}

/** Every shipped source file, tests excluded. See the header for why. */
function shippedSourceFiles(): string[] {
  return shippedAppDirs()
    .flatMap((dir) => sourceFiles({ dir }))
    .filter((file) => !/\.test\.tsx?$/.test(file));
}

/** Where a file sets a `variant` to `link`, one line per hit. */
function linkVariantHits(where: string, source: string): string[] {
  if (!REACHES_BUTTON.test(source)) return [];
  return LINK_VARIANT_FORMS.flatMap(({ label, pattern }) =>
    [...source.matchAll(pattern)].map(
      (match) => `${where} writes \`${match[0]}\` as ${label}`,
    ),
  );
}

describe("Button `variant=\"link\"` ships nowhere", () => {
  const shipped = shippedAppDirs();
  const files = shippedSourceFiles();

  it("scans every app the workspace ships, and knows which one it skips", () => {
    // FALSE-PASS FLOOR, in both halves. An empty app list or an empty file list
    // produces an empty offender list and a green run over nothing — which is
    // what a renamed workspace group, a moved `apps/` or a broken `REPO_ROOT`
    // looks like from here. The floor is a floor and not a census: it may be
    // raised as the apps grow, and it reds rather than drifting quietly down.
    expect(workspaceGroups()).toContain("apps");
    expect(shipped).toContain("apps/web");
    expect(shipped.length).toBeGreaterThan(0);
    expect(files.length).toBeGreaterThan(40);
    // And the exemption is a subtraction from a derived list, not a name in a
    // filter: the workbench has to be an app the scan would otherwise have read.
    expect(workspacePackageDirs()).toContain("apps/workbench");
    expect(shipped).not.toContain("apps/workbench");
  });

  it("reads the two forms it claims to read", () => {
    // GUARDS THE GUARD. Every assertion below is "this regex found nothing",
    // which is also what a regex that can never match anything reports. These
    // authored samples are the positive control, and they are why the empty
    // offender list a page down means something.
    expect(
      linkVariantHits("sample.tsx", '<Button variant="link">Docs</Button>'),
    ).toHaveLength(1);
    expect(
      linkVariantHits("sample.tsx", "<Button variant={'link'} />"),
    ).toHaveLength(1);
    expect(
      linkVariantHits("sample.ts", 'buttonVariants({ variant: "link" })'),
    ).toHaveLength(1);
    // And the name gate really gates: the same string with no Button in sight
    // is somebody else's component and not this guard's business.
    expect(linkVariantHits("sample.tsx", '<Anchor variant="link" />')).toEqual([]);
    // A variant that merely starts with the same letters is not the variant.
    expect(
      linkVariantHits("sample.tsx", '<Button variant="linked" />'),
    ).toEqual([]);
  });

  it("renders on no shipped app surface", () => {
    const offenders = files.flatMap((file) =>
      linkVariantHits(file, readFileSync(join(REPO_ROOT, file), "utf8")),
    );
    // The red says what to do, because the fix is not "delete the button". A
    // shipped link button needs a legible colour first, and `--nms-primary` is
    // not one: `apps/web` resolves it to an accent chosen as a FILL under white,
    // and as type on the app's card it measures 3.77:1 where SC 1.4.3 wants 4.5.
    expect(
      offenders.length === 0
        ? []
        : [
            ...offenders,
            "A shipped link button needs a text-legible colour BEFORE it ships, " +
              "which is a mint: --nms-primary measures 3.77:1 as type on apps/web's " +
              "card. Mint it, pair it in packages/components/src/contrast.ts, and " +
              "drop that file's --nms-primary-on-card exclusion, which this guard is " +
              "the condition on.",
          ],
    ).toEqual([]);
  });
});

describe("the exclusion this guard is the condition on", () => {
  const excluded = EXCLUDED_CONTRAST_PAIRS.find(
    (pair) =>
      pair.foreground === "--nms-primary" && pair.surface === "--nms-card",
  );

  it("is still in the pair list, rather than having quietly become an assertion", () => {
    // If someone mints the text-side blue and asserts the pair, this guard has
    // done its job and should go with the exclusion. A green here over a missing
    // exclusion would leave a guard enforcing a condition on nothing.
    expect(excluded).toBeDefined();
  });

  it("names this file, so the condition and its enforcement find each other", () => {
    // The half a comment cannot hold up on its own. `contrast.ts` says the
    // exclusion holds ON THE CONDITION that no shipped surface renders the
    // variant; this asserts the sentence still points at what checks it.
    expect(excluded!.reason).toContain("link-variant.test.ts");
  });

  it("says what has to happen if the condition breaks", () => {
    // The exclusion is not merely conditional, it is conditional with a remedy:
    // the variant needs a legible colour before it ships, and that is a mint.
    expect(excluded!.reason).toContain("mint");
  });
});
