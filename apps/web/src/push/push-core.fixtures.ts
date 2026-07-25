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
import {
  resolveEventStorePaths,
  type EventStorePaths,
} from "@numisma/event-store";

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

/** The genesis seed's t0 date — every temp-store fold starts here. */
export const TEMP_GENESIS_AS_OF = "2026-06-01";

/** The fund name the temp genesis seed carries (slugged into the row's fund_id). */
export const TEMP_FUND_NAME = "Accumulus";

/** A small, legible genesis seed: one live position, one reserve, two instruments. */
export function tempGenesisSeed(): unknown {
  return {
    fund: { id: "fund-1", name: TEMP_FUND_NAME, baseCurrency: "USD" },
    review: { asOf: TEMP_GENESIS_AS_OF, usdMxn: 20 },
    portfolios: [{ id: "core", name: "Core" }],
    accounts: [
      { id: "xtb-usd", name: "Main Broker", platform: "XTB", currency: "USD" },
    ],
    instruments: [
      { id: "aapl-usd", name: "Apple Inc.", symbol: "AAPL", currency: "USD" },
      { id: "btc-usd", name: "Bitcoin", symbol: "BTC", currency: "USD" },
    ],
    reserves: [
      {
        id: "cash-core",
        portfolioId: "core",
        tempo: "Reserve",
        executionMode: "live",
        accountId: "xtb-usd",
        currency: "USD",
        amount: 1000,
      },
    ],
    positions: [
      {
        id: "aapl-core",
        portfolioId: "core",
        tempo: "Capital",
        executionMode: "live",
        accountId: "xtb-usd",
        instrumentId: "aapl-usd",
        direction: "long",
        markPrice: 150,
        currency: "USD",
        lots: [{ quantity: 2, cost: 100, tier: "c1" }],
      },
    ],
  };
}

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
  await writeFile(paths.genesis, JSON.stringify(tempGenesisSeed()), "utf8");
  await writeFile(paths.log, log, "utf8");
  return { dir, paths };
}
