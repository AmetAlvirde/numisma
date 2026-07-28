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
 *    `loadCurrentReport` over an actual log without touching the operator's store.
 */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { CompositionReport } from "@numisma/engine";
import type { GlanceBlock } from "../projection/contract.ts";
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
 * A representative v3 `GlanceBlock` for tests that need a well-formed payload but
 * are not testing the glance derivation itself (the upsert path, the D8 key-path
 * contract). Deliberately NOT an empty block: it carries a floor, a real shortfall
 * and the resulting suppression, so a key-path allow-list walking it sees every
 * branch — including the optional `reserveTargetPct` an empty block would hide.
 *
 * `buildGlanceBlock` is what the PUSH uses; this is a fixture, and the two are
 * asserted against each other in `glance.test.ts`.
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
  suppressed: ["summary.fundValueUsd", "summary.change", "summary.reserve"],
};
