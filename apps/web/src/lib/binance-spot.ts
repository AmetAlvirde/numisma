/**
 * LIVE SPOT — THE ONE CALL SITE (spec #285 G-D4, slice #289).
 *
 * ── THIS FETCH IS CLIENT-SIDE, AND IT MUST STAY THAT WAY ────────────────────────────
 * `api.binance.com` answers requests from US IP addresses with **HTTP 451 Unavailable
 * For Legal Reasons**. Vercel's functions run on US infrastructure. So a server-side
 * fetch of this endpoint — in a route loader, in a server function, in a cron — PASSES
 * LOCALLY on the operator's machine and FAILS IN PRODUCTION, every time, with a status
 * code nobody reads as "wrong execution environment".
 *
 * That failure mode is the whole reason this module exists as a browser hook rather
 * than as a loader. DO NOT HELPFULLY MOVE IT. If a future refactor wants spot in a
 * loader, the geo-block has to be solved first — a proxy, a different venue, a
 * server-side price of the fund's own — and that is a decision, not a tidy-up.
 *
 * BINANCE SPECIFICALLY, not a convenient alternative: the fund's own marks come from
 * Binance, and a `next` marker computed against a different venue's price would put the
 * chart's "now" line somewhere the fund's own book does not agree with (G-D4).
 *
 * ── THIS IS A NEW CLASS OF ACCESS FOR THIS APP, KEPT TO ONE PLACE ───────────────────
 * Nothing else in `apps/web` reaches the network from the browser. Keeping it to this
 * one exported hook means the geo-block reason above has exactly one place to be read,
 * and a second call site is a visible diff rather than an accident.
 *
 * FAILURE IS A LABELED STATE, NEVER A BROKEN PAGE. On failure the hook reports
 * `unavailable` carrying the last price it actually saw this session, and the surface
 * renders `live price unavailable` beside it while every spot-independent fact — the
 * rungs, the figures, the waiting capital, the caption — still renders. On the FIRST
 * load there is no last close to fall back to, so `lastCloseUsd` is absent and the
 * surface shows an em-dash with the named cause. It never invents a price, and it never
 * renders a `0`.
 */
import { useEffect, useState } from "react";
import type { SpotReading } from "../ladder/fill-path-view.ts";

/** The public spot ticker. Exported so a reader can see the exact URL being called. */
export const BINANCE_SPOT_URL =
  "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT";

/** How often the price refreshes while the page is open. */
const REFRESH_MS = 60_000;

/**
 * Read BTC spot in USD, in the browser.
 *
 * Starts `loading` — which is also what the SERVER renders, since `useEffect` does not
 * run during SSR. That is correct rather than incidental: the server genuinely does not
 * know spot, and the first paint says so instead of flashing a stale number.
 */
export function useBinanceSpotUsd(): SpotReading {
  const [reading, setReading] = useState<SpotReading>({ status: "loading" });

  useEffect(() => {
    let live = true;
    const controller = new AbortController();

    async function read(): Promise<void> {
      try {
        const response = await fetch(BINANCE_SPOT_URL, { signal: controller.signal });
        if (!response.ok) throw new Error(`binance responded ${response.status}`);
        const body = (await response.json()) as { price?: string };
        const priceUsd = Number(body.price);
        // A non-finite or non-positive price is not a price. Treating it as one would
        // put a `$0` on a surface whose entire discipline is that a zero is a bug.
        if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
          throw new Error("binance returned no usable price");
        }
        if (live) setReading({ status: "live", priceUsd });
      } catch {
        // The failure itself is not interesting — 451, offline, DNS, a parse error all
        // mean the same thing to the operator: this number is not live right now.
        if (!live) return;
        setReading((previous) => {
          // Keep the last price this session actually saw, so a refresh that fails
          // degrades to a last close rather than blanking a working page. With nothing
          // seen yet there is no close to fall back to, and the surface says so.
          if (previous.status === "live") {
            return { status: "unavailable", lastCloseUsd: previous.priceUsd };
          }
          return previous.status === "unavailable" ? previous : { status: "unavailable" };
        });
      }
    }

    void read();
    const timer = setInterval(() => void read(), REFRESH_MS);
    return () => {
      live = false;
      controller.abort();
      clearInterval(timer);
    };
  }, []);

  return reading;
}
