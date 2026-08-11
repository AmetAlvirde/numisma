/**
 * The checked-in anchor-replay fixture (PRD #146 slice 3) — and, deliberately, the
 * ONLY module in this directory that reads neither the durable log nor the
 * preferences sidecar. It is plain `fs` + `JSON.parse` over a committed file, so
 * ANY module may import it: that is the entire reason it is a separate file from
 * `backfill-core.ts`.
 *
 * WHY IT EXISTS. Slice 4's load-bearing test replays EVERY anchor in this file
 * through `verdict.ts` and asserts the measured history against the anchors it names
 * — a handful of *yes* days among mostly *no* ones, `feedGap` behind most of the
 * *yes* verdicts, `navMove` behind one, 06-28 declining to compare, 07-26 rendering
 * in full (as measured on 2026-08-05; the fixture grows by one on every push, so
 * these are a dated observation, not a contract). Without a committed fixture that test can only read backfilled rows out of
 * Postgres, which means it sits behind the same `NUMISMA_TEST_DATABASE_URL` gate as
 * the write test and **passes by skipping** on every machine and CI run without a
 * database — the exact shape this repo has been burned by before. The Postgres
 * integration test proves the WRITE; this fixture keeps the VERDICT test honest,
 * and the two are different claims.
 *
 * WHAT IT HOLDS: {@link SnapshotAnchor}[] — `{ fundId, asOf, report }` per anchor,
 * the SAME shape `getSnapshotHistory` returns from the DB, so slice 4 feeds the
 * fixture into the verdict module through the identical seam a real read uses. No
 * adapter, no second shape to keep in sync.
 *
 * WHAT IT DOES NOT HOLD: anything D8 keeps off the wire. Every `report` here is the
 * output of `toProjectionReport`, key-by-key — `{ totals, dashboard, glance, dca }`
 * and nothing else. `invalidationWatch`, `closedBook`, `priceJourneys`,
 * `reserveReconciliation`, `warnings`, `excluded` and `load` never enter it, and
 * `glance.feedGap.missing` carries `rowId` + `label` only, never a mark date (D14).
 * `anchor-fixture.test.ts` asserts that on the committed bytes rather than trusting
 * this paragraph.
 *
 * WHAT IT HOLDS IS NOT THE REAL FUND. The payload is by construction publishable to
 * the ADR-007 projection DB, which is auth-gated; THIS REPOSITORY IS PUBLIC, and those
 * are not the same bar. So the committed file is SYNTHESIZED: the real fund's anchor
 * dates, `glance` blocks, Reserve percentages, day-over-day NAV moves and structural
 * shape, over invented magnitudes anchored at a round fictional 100000. Nothing reads
 * a magnitude, so nothing is lost; see `fixture-synthesis.ts` for exactly which
 * quantities are preserved and which are invented, and `backfill-core.ts`'s ANCHOR
 * FIXTURE EXPOSURE header for why. The only way to regenerate is
 * `pnpm backfill -- --fixture-only`, which cannot emit real magnitudes.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  COMPOSITION_SNAPSHOT_SCHEMA_VERSION,
  type SnapshotAnchor,
} from "../projection/contract.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the committed anchor-replay fixture. */
export const ANCHOR_FIXTURE_PATH = resolve(
  HERE,
  "../../fixtures/backfill-anchors.fixture.json",
);

/**
 * The committed file's envelope. `schemaVersion` is not decoration: it is what
 * makes a STALE fixture fail loud instead of replaying a shape the reader no longer
 * understands. Every bump must regenerate this file, and until it does
 * {@link loadAnchorFixture} throws rather than handing slice 4 a stale payload dressed
 * as current.
 *
 * PINNED TO `CURRENT`, NOT TO THE READER'S SUPPORTED RANGE (spec #285). The reader
 * accepts an older STORED row because it does not get to choose what the projection
 * already holds; this file is a committed artifact this repository does choose, so
 * "current or fail" stays the rule for it.
 */
export interface AnchorFixture {
  schemaVersion: number;
  anchors: SnapshotAnchor[];
}

/**
 * Load the committed anchors. NO database, NO durable log, no environment — this
 * runs on any machine, which is the property slice 4's replay depends on.
 *
 * Throws on a version mismatch or an empty file. Both are "the fixture was not
 * regenerated" and both must stop the test, because a replay against the wrong
 * shape reports a green that means nothing.
 */
export async function loadAnchorFixture(): Promise<SnapshotAnchor[]> {
  const raw = await readFile(ANCHOR_FIXTURE_PATH, "utf-8");
  const parsed = JSON.parse(raw) as AnchorFixture;
  if (parsed.schemaVersion !== COMPOSITION_SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(
      `${ANCHOR_FIXTURE_PATH} holds schemaVersion ${parsed.schemaVersion}, but this ` +
        `build expects ${COMPOSITION_SNAPSHOT_SCHEMA_VERSION}. Regenerate it with ` +
        `\`pnpm --filter @numisma/web backfill -- --fixture-only\`.`,
    );
  }
  if (!Array.isArray(parsed.anchors) || parsed.anchors.length === 0) {
    throw new Error(`${ANCHOR_FIXTURE_PATH} holds no anchors.`);
  }
  return parsed.anchors;
}

/**
 * Find one anchor by its calendar date. Throws when it is absent, so a test naming
 * a date the fixture does not hold FAILS rather than quietly asserting over
 * `undefined` — the same "never claim a date you don't have" rule V3 puts on the
 * reader, applied to the test surface.
 */
export function anchorAt(
  anchors: SnapshotAnchor[],
  asOf: string,
): SnapshotAnchor {
  const found = anchors.find((anchor) => anchor.asOf === asOf);
  if (!found) {
    throw new Error(
      `The anchor fixture holds no ${asOf}. It has ${anchors.length} anchors, ` +
        `${anchors[0]?.asOf} … ${anchors[anchors.length - 1]?.asOf}.`,
    );
  }
  return found;
}

/** Serialize anchors into the committed envelope (the exact bytes on disk). */
export function serializeAnchorFixture(anchors: SnapshotAnchor[]): string {
  const fixture: AnchorFixture = {
    schemaVersion: COMPOSITION_SNAPSHOT_SCHEMA_VERSION,
    anchors,
  };
  // Deterministic by construction: no timestamp, no run id, no ordering source
  // outside the anchors themselves. Regenerating against an unchanged log rewrites
  // byte-identical content, so a diff on this file always means the LOG changed.
  return `${JSON.stringify(fixture, null, 2)}\n`;
}
