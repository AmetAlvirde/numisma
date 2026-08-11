/**
 * Test-only fixtures for the push path (the repo's `.fixtures.ts` convention —
 * cf. `apps/tui/src/ingest-commit.fixtures.ts`; already coverage-excluded).
 *
 * Two things live here, and neither is reachable from the push command:
 *
 *  - `FIXTURE_PATH` / `loadFixture` — the committed `composition-report.fixture.json`
 *    the push shell USED to publish. It moved out of `push-core.ts` when the push
 *    started folding the real durable log (PRD #134 slice 2): after that slice the
 *    command can only push real data, with no flag, env toggle, or fallback back to
 *    the fixture. The JSON stays committed and is what it always should have been —
 *    a *test* fixture, loaded directly by the unit and integration tests.
 *  - `makeTempStore` — builds a throwaway data dir (genesis seed + an events.jsonl
 *    of the caller's choosing) so the real-fold tests can exercise
 *    `loadCurrentFold` over an actual log without touching the operator's store.
 */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { CompositionReport } from "@numisma/engine";
import {
  SUPPRESSION_KEYS,
  type DcaBlock,
  type GlanceBlock,
} from "../projection/contract.ts";
import {
  resolveEventStorePaths,
  type EventStorePaths,
} from "@numisma/event-store";
import {
  GENESIS_SEED_AS_OF,
  GENESIS_SEED_FUND_NAME,
  genesisSeed,
} from "@numisma/event-store/testkit";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the committed fixture CompositionReport (TEST INPUT ONLY). */
export const FIXTURE_PATH = resolve(
  HERE,
  "../../fixtures/composition-report.fixture.json",
);

/** Load and parse the fixture CompositionReport from disk (TEST INPUT ONLY). */
export async function loadFixture(): Promise<CompositionReport> {
  const raw = await readFile(FIXTURE_PATH, "utf-8");
  return JSON.parse(raw) as CompositionReport;
}

/**
 * The genesis seed's t0 date — every temp-store fold starts here.
 *
 * Re-exported under the local names the push tests already read, rather than
 * duplicated: the seed itself now lives in `@numisma/event-store/testkit`, beside
 * the read path it seeds. This file used to carry a byte-identical copy of it.
 */
export const TEMP_GENESIS_AS_OF = GENESIS_SEED_AS_OF;

/** The fund name the temp genesis seed carries (slugged into the row's fund_id). */
export const TEMP_FUND_NAME = GENESIS_SEED_FUND_NAME;

export { genesisSeed as tempGenesisSeed };

/** A `PriceMarked` event line for the genesis AAPL position, dated `asOf`. */
export function priceMarkedLine(
  id: string,
  asOf: string,
  price: number,
): string {
  return JSON.stringify({
    id,
    asOf,
    type: "PriceMarked",
    instrumentId: "aapl-usd",
    price,
  });
}

/**
 * Create a throwaway data dir holding the genesis seed plus `log` as
 * `events.jsonl`. Returns the resolved paths AND the dir, so a caller can point
 * `NUMISMA_DATA_DIR` at it and clean it up afterwards.
 */
export async function makeTempStore(
  log: string,
): Promise<{ dir: string; paths: EventStorePaths }> {
  const dir = await mkdtemp(resolve(tmpdir(), "numisma-push-"));
  const paths = resolveEventStorePaths(dir);
  await writeFile(paths.genesis, JSON.stringify(genesisSeed()), "utf8");
  await writeFile(paths.log, log, "utf8");
  return { dir, paths };
}

/**
 * A representative v5 `DcaBlock`, on the same principle as {@link TEST_GLANCE} below:
 * a fixture for tests that need a well-formed payload but are not testing the DCA
 * derivation itself, and deliberately NOT an empty block. It carries one row of EVERY
 * arm the wire has, so a key-path allow-list walking it sees every optional key —
 * `kind` and `rungs` on a ladder, `kind` alone on a `dcaTime` plan, and neither on the
 * two conclusion-only arms. An empty block, or one with a single row, would let a leak
 * inside a shape nobody walked go unnoticed.
 *
 * `buildDcaBlock` is what the PUSH uses; this is a fixture, and nothing asserts the two
 * against each other. What holds this fixture to the wire's closed world is the type:
 * `ProjectionKeyAllowList`'s `dcaPosition` assert closes the key set at compile time,
 * and TypeScript's excess-property check refuses a stray key in the literal below.
 */
export const TEST_DCA: DcaBlock = {
  source: "loaded",
  positions: [
    // A pending ladder — the day-zero case the card exists for, and the only arm that
    // carries rungs. Three of them, so the key-path walk reaches inside the array AND
    // sees every optional the v5 fill state can put there: one rung fully reconciled
    // with a price mismatch (the only case that carries `orderPriceUsd`), one
    // reconciled cleanly, and one never placed — which carries NO fill key at all, and
    // is the shape that proves an absent optional is distinguishable from an unused one.
    {
      positionId: "capital-fixture-btc",
      state: "pending",
      kind: "dcaLadder",
      planId: "00000000-0000-4000-8000-000000000042",
      rungs: [
        {
          id: "rung-1",
          priceUsd: 9_800,
          venueAxis: "partly-filled",
          bookAxis: "partly-recorded",
          label: "partly filled · 50%",
          joinProvenance: "declared",
          orderPriceUsd: 9_760,
          declaredPriceMismatch: true,
          placedQuantity: 4,
          venueConsumedQuantity: 2,
          bookedQuantity: 1,
          venueFilledFraction: 0.5,
          resting: true,
        },
        {
          id: "rung-2",
          priceUsd: 9_400,
          venueAxis: "resting",
          bookAxis: "not-recorded",
          label: "waiting",
          joinProvenance: "price-matched",
          declaredPriceMismatch: false,
          placedQuantity: 3,
          venueConsumedQuantity: 0,
          bookedQuantity: 0,
          venueFilledFraction: 0,
          resting: true,
        },
        { id: "rung-3", priceUsd: 9_200 },
      ],
      figures: {
        deployedUsd: 19_600,
        unitsAcquired: 2,
        avgEntryUsd: 9_800,
        waitingDeclaredUsd: 750,
        waitingRestingUsd: 500,
      },
      orphanLots: 1,
    },
    // A `dcaTime` plan: `kind` present, `rungs` genuinely ABSENT. Without it the
    // key-path allow-list could not tell an absent optional apart from an unused one.
    { positionId: "capital-fixture-eth", state: "active", kind: "dcaTime" },
    // The two conclusion-only arms, which must carry nothing else at all.
    { positionId: "capital-fixture-old", state: "ended" },
    { positionId: "capital-fixture-bad", state: "unreadable" },
  ],
  unattributable: 1,
};

/**
 * A representative `GlanceBlock` for tests that need a well-formed payload but
 * are not testing the glance derivation itself (the upsert path, the D8 key-path
 * contract). Deliberately NOT an empty block: it carries a floor, a real shortfall
 * and the resulting suppression, so a key-path allow-list walking it sees every
 * branch — including the optional `reserveTargetPct` an empty block would hide.
 *
 * `buildGlanceBlock` is what the PUSH uses; this is a fixture, and nothing asserts the
 * two against each other. What keeps this block honest is `ALLOWED_KEY_PATHS` in
 * `projection-payload.test.ts`: it fails on a path the payload produces that nobody
 * listed AND on a listed path the payload stops producing, so a fixture that drifted
 * narrower than the real block goes red there.
 */
export const TEST_GLANCE: GlanceBlock = {
  reserveTargetPct: 10,
  feedGap: {
    expected: 13,
    arrived: 4,
    missing: [
      { rowId: "instrument:aapl", label: "AAPL (Apple Inc.)" },
      { rowId: "instrument:googl", label: "GOOGL (Alphabet Inc.)" },
    ],
  },
  suppressed: Object.values(SUPPRESSION_KEYS),
};
