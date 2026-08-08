/**
 * Front-door lock for `@numisma/price-feed`'s public surface (`./index.ts`).
 *
 * WHY THIS EXISTS, and why the barrel is NOT coverage-excluded. Every other
 * price-feed test reaches past the barrel straight to a deep module
 * (`./fetch-prices.js`, `./rejection-check.js`, …), and — as of this writing —
 * NOTHING in the workspace imports the `@numisma/price-feed` specifier at all,
 * not even the package's own `cli.ts`, which uses relative paths. So no code
 * path, product or test, crosses the package's front door. Excluding it from
 * coverage would have hidden that; this test crosses it instead.
 *
 * That absence of consumers is exactly what makes the barrel fragile rather than
 * safe: with no importer to break, a dropped or renamed re-export is invisible
 * until the first future consumer (web, scheduler — the reuse the module header
 * promises) tries to wire it up. This is the only thing that would catch it.
 *
 * WHAT THE SURFACE IS SHAPED FOR (audit finding 18, decision C). With no consumer
 * to take evidence from, the barrel is shaped for the consumer the package header
 * promises, and the list below is that decision's record. Two kinds of export were
 * removed rather than left pinned:
 *   - `atomicWrite` / `AtomicWriteIo` and `upsertQuote` — internal plumbing (a
 *     generic fs primitive and disposable price-store IO) that three modules reach
 *     by RELATIVE import and no front-door consumer needs. The modules stay; only
 *     the re-exports went.
 *   - `fetchTwelveDataDailyClose` (singular) — deleted outright. It had zero
 *     non-test callers, and publishing it invited a consumer to issue one request
 *     per symbol against Twelve Data's 8-credit/minute cap. The BATCHED
 *     `fetchTwelveDataDailyCloses` — what `runPriceFetch` actually drives — is
 *     exported in its place, with `ProviderFetchResult`, its per-entry outcome.
 *
 * The surface splits in two, and so does the guard:
 *   - RUNTIME exports are asserted here, by exact set equality against
 *     `EXPECTED_VALUE_EXPORTS` — so a DROP fails, and so does an unannounced
 *     ADDITION, which keeps the list honest rather than merely append-only.
 *   - TYPE-ONLY exports cannot be observed at runtime. They are guarded at
 *     COMPILE time by the `import type` below plus `TypeSurface`: if one stops
 *     being exported, `pnpm typecheck` fails. That matches the posture
 *     `packages/engine/src/index.ts` already states for its own surface —
 *     typecheck is the mechanical guard — rather than inventing a second style.
 */
import { describe, expect, it } from "vitest";
// The barrel is reached the way engine's tests reach engine's root: the relative
// `./index.js` path, the repo's convention (19 engine test files do this; no test
// in the workspace imports its own package by specifier). This also guarantees the
// coverage instrumentation attributes the crossing to the barrel itself.
import * as priceFeed from "./index.js";
import type {
  EquitiesFetchOptions,
  FetchFailure,
  FetchOptions,
  FetchRunResult,
  FixFetchOptions,
  MarkRejection,
  PriceFeedConfig,
  PriceFeedPaths,
  ProviderCredentials,
  ProviderFetchResult,
  ProviderObservation,
  RejectionScan,
  RunOptions,
  SpineReferencePaths,
} from "./index.js";

/**
 * The ONE list: every runtime export the barrel is contracted to publish, and the
 * kind it must be. Both the name-set assertion and the kind assertion derive from
 * this, so there is no second copy to drift.
 */
const EXPECTED_VALUE_EXPORTS = {
  // config.ts — the shipped defaults and the env credential reader.
  DEFAULT_CONFIG: "object",
  readCredentialsFromEnv: "function",
  // The three provider fetches (ADR-005 two-plane model). Twelve Data's is the
  // BATCHED one — the singular fetch is gone, see the header.
  fetchBinanceDailyClose: "function",
  fetchTwelveDataDailyCloses: "function",
  fetchBanxicoFix: "function",
  // inbox.ts — the atomic inbox emit.
  emitMarksToInbox: "function",
  // paths.ts — path resolution for both.
  resolvePriceFeedPaths: "function",
  // fetch-prices.ts — the run the CLI drives.
  runPriceFetch: "function",
  // rejection-check.ts — the post-run scan against the spine's own gates.
  loadSpineReference: "function",
  findMarkRejections: "function",
  marksFromRun: "function",
  scanFetchedMarks: "function",
} as const satisfies Record<string, "function" | "object">;

/**
 * Compile-time half of the surface lock: naming each type-only export in a
 * position that must resolve. Removing or renaming one is a `pnpm typecheck`
 * failure, which is where a type contract can be enforced at all.
 */
type TypeSurface = {
  config: PriceFeedConfig;
  credentials: ProviderCredentials;
  observation: ProviderObservation;
  fetchOptions: FetchOptions;
  equitiesFetchOptions: EquitiesFetchOptions;
  providerFetchResult: ProviderFetchResult;
  fixFetchOptions: FixFetchOptions;
  paths: PriceFeedPaths;
  runResult: FetchRunResult;
  failure: FetchFailure;
  runOptions: RunOptions;
  rejection: MarkRejection;
  spineReferencePaths: SpineReferencePaths;
  rejectionScan: RejectionScan;
};

describe("@numisma/price-feed public surface", () => {
  it("publishes exactly the contracted runtime exports — no more, no fewer", () => {
    // Exact set equality, not a subset check: a dropped export and a smuggled-in
    // one both fail, and the diff names the symbol either way.
    expect(Object.keys(priceFeed).sort()).toEqual(Object.keys(EXPECTED_VALUE_EXPORTS).sort());
  });

  it("publishes each runtime export as the kind callers bind to", () => {
    const actual = Object.fromEntries(
      Object.keys(EXPECTED_VALUE_EXPORTS).map((name) => [
        name,
        typeof (priceFeed as Record<string, unknown>)[name],
      ]),
    );
    // Asserted as one object so a wrong kind reports the symbol AND what it became,
    // rather than failing on the first mismatch and hiding the rest.
    expect(actual).toEqual({ ...EXPECTED_VALUE_EXPORTS });
  });

  it("carries the type-only surface through the same front door (compile-time)", () => {
    // The assertion is that this file TYPECHECKS; the runtime check is only that
    // the type surface is inhabitable, which pins `TypeSurface` as used rather
    // than letting it be silently deleted along with the import it guards.
    const surface: Partial<TypeSurface> = { config: priceFeed.DEFAULT_CONFIG };
    expect(surface.config).toBe(priceFeed.DEFAULT_CONFIG);
  });
});
