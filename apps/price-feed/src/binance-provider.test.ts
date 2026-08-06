// Binance public-REST provider suite. No live network (every fetch is mocked).
// Currently one case: the non-JSON 200, which must stay symbol-attributable.
import { describe, expect, it } from "vitest";
import type { InstrumentRegistryEntry } from "@numisma/engine";
import { fetchBinanceDailyClose } from "./binance-provider.js";

const BTC: InstrumentRegistryEntry = {
  instrumentId: "btc",
  symbol: "BTCUSDT",
  quoteCurrency: "USD",
  source: "binance",
};

function fetchWith(res: () => Response | Promise<Response>): typeof fetch {
  return (() => Promise.resolve(res())) as typeof fetch;
}

const OPTS = { timeoutMs: 5_000 };

describe("fetchBinanceDailyClose — loud failures", () => {
  it("attributes a non-JSON 200 to the symbol instead of throwing a bare SyntaxError", async () => {
    // Regression guard for #110's finding 2 — see twelvedata-provider.test.ts. The
    // decode used to run outside the guarded region, so a 200 carrying a maintenance
    // page or a Cloudflare interstitial threw before Binance's prefix was applied.
    await expect(
      fetchBinanceDailyClose(BTC, {
        ...OPTS,
        fetchImpl: fetchWith(() => new Response("<html>maintenance</html>", { status: 200 })),
      }),
    ).rejects.toThrow(/^Binance BTCUSDT -> /);
  });
});
