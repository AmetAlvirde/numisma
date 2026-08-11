/**
 * D8 forbidden-key contract — what may NOT reach the cloud.
 *
 * Mirror image of `client-bundle.integration.test.ts`: that test asserts what may
 * not reach the BROWSER; this one asserts what may not reach the hosted
 * projection DB. Both convert a silent drift class into a red build.
 *
 * The history this exists to prevent: ADR-007 computed its blast radius over
 * "derived dashboard values, not the raw thesis/risk-budget/invalidation prose",
 * which was accurate when written. The engine then grew `invalidationWatch`
 * (per-position stop levels), `closedBook` (the full realized-P&L blotter, with
 * `strategy` tags on its rows), `priceJourneys` and `reserveReconciliation` — and
 * the push, which serialized the WHOLE `CompositionReport`, silently inherited
 * every one of them. Nothing decided that. The engine grew and nobody was told.
 *
 * `ProjectionReport = Pick<CompositionReport, "totals" | "dashboard">` plus
 * `toProjectionReport`'s key-by-key construction narrows it TODAY. This test is
 * what makes the narrowing survive the NEXT engine increment: it drives a
 * deliberately WIDE report through the real `deriveSnapshot` path and deep-scans
 * every key at every depth of the resulting payload.
 *
 * TWO SCANS, DIFFERENT POLARITIES — and the allow-list is the load-bearing one:
 *
 *  - ALLOW-LIST (`keyPathsOf` vs `ALLOWED_KEY_PATHS`) — the payload's full
 *    recursive key-PATH set must equal a checked-in list exactly. Closed-world:
 *    any key appearing anywhere under `totals`/`dashboard` that nobody wrote down
 *    fails, including one nobody anticipated. This is the runtime twin of
 *    `contract.ts`'s `ProjectionKeyAllowList`, which enforces the same closed
 *    world over the engine TYPES at compile time. The two catch different halves:
 *    the type guard catches the engine growing a field the fixture does not carry;
 *    this catches a runtime value carrying a key its type never declared (a cast,
 *    a spread, a hand-built object).
 *
 *  - BLOCKLIST (`scanForbiddenKeys`) — retained underneath as a NAMED-SUSPECT
 *    check. It is strictly weaker (it only ever catches leaks somebody already
 *    thought of) and the allow-list subsumes it, but it survives because it fails
 *    with a far more legible message: "`strategy` leaked at $.x.y" reads better in
 *    CI than a 60-line set diff, and the five markers are the specific fields D8
 *    argued about.
 *
 * Two properties keep both honest:
 *  - the scans recurse over objects AND arrays; the blocklist matches markers as
 *    case-insensitive substrings, so a renamed variant (`invalidationWatch` →
 *    `invalidationLevels`) is still caught;
 *  - false-pass guards assert each scanner genuinely FINDS what it looks for in
 *    the wide INPUT report. A recursive scanner with a bug reports "clean" for
 *    everything; without those assertions this file would be decoration.
 */
import { describe, expect, it } from "vitest";
import type { CompositionReport } from "@numisma/engine";
import { deriveSnapshot } from "./push-core.ts";
import { loadFixture, TEST_DCA, TEST_GLANCE } from "./push-core.fixtures.ts";
import { toProjectionReport } from "../projection/contract.ts";

/**
 * Key markers that must never appear at any depth of the pushed payload. Matched
 * as case-insensitive SUBSTRINGS of the key name, so `invalidation` catches
 * `invalidationWatch`, `invalidationCondition` and a bare `invalidation` alike.
 */
const FORBIDDEN_KEY_MARKERS = [
  "strategy",
  "invalidation",
  "closedBook",
  "entryThesis",
  "riskBudget",
];

/**
 * Every forbidden marker found in `value`, walking objects and arrays to
 * arbitrary depth. Reports `marker @ path` so a failure names where it leaked.
 */
function scanForbiddenKeys(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => scanForbiddenKeys(item, `${path}[${i}]`));
  }
  if (value === null || typeof value !== "object") {
    return [];
  }
  const hits: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const here = `${path}.${key}`;
    const lowered = key.toLowerCase();
    for (const marker of FORBIDDEN_KEY_MARKERS) {
      if (lowered.includes(marker.toLowerCase())) {
        hits.push(`${marker} @ ${here}`);
      }
    }
    hits.push(...scanForbiddenKeys(child, here));
  }
  return hits;
}

/**
 * Every key PATH in `value`, walking objects and arrays to arbitrary depth.
 *
 * Array indices collapse to a single `[]` segment on purpose: the question is
 * "which keys may leave the machine", which is a property of the payload's SHAPE,
 * not of how many rows the fixture happens to hold. Without the collapse this set
 * would churn on every fixture edit and the allow-list would be abandoned as
 * noise within two increments.
 */
function keyPathsOf(value: unknown, path = "$", out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      keyPathsOf(item, `${path}[]`, out);
    }
    return out;
  }
  if (value === null || typeof value !== "object") {
    return out;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const here = `${path}.${key}`;
    out.add(here);
    keyPathsOf(child, here, out);
  }
  return out;
}

/**
 * THE ALLOW-LIST: every key path the pushed payload is permitted to contain.
 *
 * Adding a line here is the act of deciding a field may leave the machine. Do not
 * regenerate this list to make a red build green — read the new path, decide, and
 * if it may go out, bump `COMPOSITION_SNAPSHOT_SCHEMA_VERSION` alongside.
 *
 * Note this is derived from the FIXTURE, so it is a subset of what the engine
 * types permit — an optional field the fixture omits is absent here. That gap is
 * precisely why `contract.ts`'s `ProjectionKeyAllowList` exists at the type level;
 * neither guard is sufficient alone.
 */
const ALLOWED_KEY_PATHS = [
  "$.dashboard",
  "$.dashboard.sections",
  "$.dashboard.sections[].id",
  "$.dashboard.sections[].rows",
  "$.dashboard.sections[].rows[].costBasisUsd",
  "$.dashboard.sections[].rows[].id",
  "$.dashboard.sections[].rows[].kind",
  "$.dashboard.sections[].rows[].label",
  "$.dashboard.sections[].rows[].percentOfFund",
  "$.dashboard.sections[].rows[].unrealizedPnlUsd",
  "$.dashboard.sections[].rows[].usdValue",
  "$.dashboard.sections[].title",
  "$.dashboard.summary",
  "$.dashboard.summary.asOf",
  "$.dashboard.summary.dataSafety",
  "$.dashboard.summary.dataSafety.hasWarnings",
  "$.dashboard.summary.dataSafety.invalidExcluded",
  "$.dashboard.summary.dataSafety.nonLiveExcluded",
  "$.dashboard.summary.dataSafety.shortDeferredExcluded",
  "$.dashboard.summary.fundName",
  "$.dashboard.summary.fundValueUsd",
  "$.dashboard.summary.largestAccount",
  "$.dashboard.summary.largestAccount.kind",
  "$.dashboard.summary.largestAccount.label",
  "$.dashboard.summary.largestAccount.percentOfFund",
  "$.dashboard.summary.largestAccount.rowId",
  "$.dashboard.summary.largestAccount.usdValue",
  "$.dashboard.summary.largestInstrument",
  "$.dashboard.summary.largestInstrument.kind",
  "$.dashboard.summary.largestInstrument.label",
  "$.dashboard.summary.largestInstrument.percentOfFund",
  "$.dashboard.summary.largestInstrument.rowId",
  "$.dashboard.summary.largestInstrument.usdValue",
  "$.dashboard.summary.largestPortfolio",
  "$.dashboard.summary.largestPortfolio.kind",
  "$.dashboard.summary.largestPortfolio.label",
  "$.dashboard.summary.largestPortfolio.percentOfFund",
  "$.dashboard.summary.largestPortfolio.rowId",
  "$.dashboard.summary.largestPortfolio.usdValue",
  "$.dashboard.summary.largestTempo",
  "$.dashboard.summary.largestTempo.kind",
  "$.dashboard.summary.largestTempo.label",
  "$.dashboard.summary.largestTempo.percentOfFund",
  "$.dashboard.summary.largestTempo.rowId",
  "$.dashboard.summary.largestTempo.usdValue",
  "$.dashboard.summary.reserve",
  "$.dashboard.summary.reserve.kind",
  "$.dashboard.summary.reserve.label",
  "$.dashboard.summary.reserve.percentOfFund",
  "$.dashboard.summary.reserve.rowId",
  "$.dashboard.summary.reserve.usdValue",
  "$.dashboard.summary.totalUnrealizedPnlUsd",
  "$.dashboard.summary.usdMxn",
  // The glance branch (v3, slice #148). Every path here is a DERIVED conclusion:
  // a policy percentage, two counts, and row ids + labels `$.dashboard.sections`
  // already carries — "derived dashboard values" in ADR-007's own terms. There is
  // deliberately no mark date among them (D14); `no ISO-date-shaped value outside
  // summary.asOf` below is the assertion that keeps it that way.
  "$.glance",
  "$.glance.feedGap",
  "$.glance.feedGap.arrived",
  "$.glance.feedGap.expected",
  "$.glance.feedGap.missing",
  "$.glance.feedGap.missing[].label",
  "$.glance.feedGap.missing[].rowId",
  "$.glance.reserveTargetPct",
  "$.glance.suppressed",
  // The dca branch (v4, spec #277). Conclusions again, and the same rule placed every
  // path: a STATE per position, a COUNT of unattributable lines, the loader's whole-
  // file outcome, and the rung PRICE AXIS the card is. What is deliberately absent is
  // as load-bearing as what is here — no `effectiveAt` (the date invariant below), no
  // rung `id` or `sizeUsd`, no `endedBy`, no `skipped`: those are a conclusion's
  // inputs, and `push/dca-block.ts` is where they stop.
  "$.dca",
  "$.dca.positions",
  "$.dca.positions[].kind",
  "$.dca.positions[].positionId",
  "$.dca.positions[].rungs",
  "$.dca.positions[].rungs[].priceUsd",
  "$.dca.positions[].state",
  "$.dca.source",
  "$.dca.unattributable",
  "$.totals",
  "$.totals.baseCurrency",
  "$.totals.fundValueUsd",
  "$.totals.usdMxn",
];

/**
 * The shipped fixture, widened so it actually CARRIES every forbidden marker.
 * The fixture on disk has `invalidationWatch: []` and an empty `closedBook`, so
 * pushing it unmodified would prove nothing — the payload would be clean whether
 * or not the narrowing worked. `entryThesis` / `riskBudget` are not on today's
 * `CompositionReport` at all; they are planted here so the scan is proven against
 * all five markers rather than only the three the engine happens to emit now.
 */
async function loadWideReport(): Promise<CompositionReport> {
  const fixture = await loadFixture();
  return {
    ...fixture,
    invalidationWatch: [
      {
        positionId: "pos:btc-core",
        instrumentId: "BTC",
        markPrice: 61250.5,
        level: 57800,
        direction: "below",
        breached: false,
      },
      {
        positionId: "pos:sol-pulse",
        instrumentId: "SOL",
        markPrice: 142.75,
        level: 158.4,
        direction: "above",
        breached: true,
      },
    ],
    closedBook: {
      rows: [
        {
          positionId: "pos:eth-swing",
          instrumentId: "ETH",
          tempo: "Pulse",
          strategy: "breakout-retest",
          direction: "long",
          openedAsOf: "2026-03-02",
          closedAsOf: "2026-04-18",
          costBasisUsd: 2400,
          proceedsUsd: 3120.75,
          realizedPnlUsd: 720.75,
          tierAttribution: [
            { tier: "core", realizedPnlUsd: 720.75, strategy: "breakout-retest" },
          ],
          entryThesis: "reclaim of the March range high",
          riskBudget: { maxLossUsd: 240, percentOfFund: 2.2 },
        },
      ],
      byTempo: [
        {
          key: "Pulse",
          realizedPnlUsd: 720.75,
          costBasisUsd: 2400,
          proceedsUsd: 3120.75,
        },
      ],
      byTier: [
        {
          key: "core",
          realizedPnlUsd: 720.75,
          costBasisUsd: 2400,
          proceedsUsd: 3120.75,
        },
      ],
      totalRealizedPnlUsd: 720.75,
    },
  } as unknown as CompositionReport;
}

describe("D8 forbidden-key contract (what may not reach the cloud)", () => {
  it("finds every forbidden marker in the WIDE input — the scanner has teeth", async () => {
    // False-pass guard. A buggy recursive scanner returns [] for everything, which
    // would make the leak assertions below vacuous. Assert the scanner detects all
    // five markers in the un-narrowed report BEFORE trusting it to clear a payload.
    const wide = await loadWideReport();
    const hits = scanForbiddenKeys(wide);
    for (const marker of FORBIDDEN_KEY_MARKERS) {
      expect(
        hits.filter((h) => h.startsWith(`${marker} @`)),
        `scanner found no "${marker}" in the wide report — the fixture is not wide ` +
          `enough, or the scanner is broken. Either way the leak checks are vacuous.`,
      ).not.toEqual([]);
    }
    // The markers must also be reachable at NESTED depth, not only top level, or
    // the recursion itself is untested.
    expect(hits.some((h) => h.includes("closedBook.rows[0]"))).toBe(true);
  });

  it("sees the wide report's extra paths — the path scanner has teeth", async () => {
    // False-pass guard for the ALLOW-LIST, mirroring the blocklist's above. If
    // `keyPathsOf` under-walked, the payload would look like a subset of the
    // allow-list for the wrong reason and the equality assertion below would pass
    // vacuously. Prove it reaches the dropped branches in the un-narrowed report
    // first, INCLUDING nested-in-array depth.
    const paths = keyPathsOf(await loadWideReport());
    for (const dropped of [
      "$.invalidationWatch[].level",
      "$.closedBook.rows[].strategy",
      "$.closedBook.rows[].tierAttribution[].strategy",
      "$.priceJourneys[].points[].price",
    ]) {
      expect(
        [...paths],
        `path scanner never reached ${dropped} in the wide report — it is ` +
          `under-walking, which would make the allow-list assertion vacuous.`,
      ).toContain(dropped);
    }
  });

  it("contains EXACTLY the allow-listed key paths and nothing else", async () => {
    // The load-bearing assertion. Unlike the marker blocklist, this fails on a key
    // nobody predicted — which is the entire drift class ADR-007's amendment
    // documents. See ALLOWED_KEY_PATHS before "fixing" a failure here.
    const wide = await loadWideReport();
    const actual = [...keyPathsOf(deriveSnapshot(wide, TEST_GLANCE, TEST_DCA).report)].sort();
    const allowed = [...ALLOWED_KEY_PATHS].sort();

    const unlisted = actual.filter((p) => !allowed.includes(p));
    expect(
      unlisted,
      `payload carries key paths NOBODY ALLOWED — decide whether each may leave ` +
        `the machine, then either drop it in toProjectionReport or add it to ` +
        `ALLOWED_KEY_PATHS and bump the schema version:\n${unlisted.join("\n")}`,
    ).toEqual([]);

    const missing = allowed.filter((p) => !actual.includes(p));
    expect(
      missing,
      `ALLOWED_KEY_PATHS names paths the payload no longer produces — a stale ` +
        `allow-list stops being a guard:\n${missing.join("\n")}`,
    ).toEqual([]);
  });

  it("pushes no forbidden key at any depth of the derived payload", async () => {
    const wide = await loadWideReport();
    const leaks = scanForbiddenKeys(deriveSnapshot(wide, TEST_GLANCE, TEST_DCA).report);
    expect(leaks, `pushed payload leaks:\n${leaks.join("\n")}`).toEqual([]);
  });

  it("narrows the payload to exactly { totals, dashboard, glance, dca }", async () => {
    const wide = await loadWideReport();
    expect(Object.keys(deriveSnapshot(wide, TEST_GLANCE, TEST_DCA).report).sort()).toEqual([
      "dashboard",
      "dca",
      "glance",
      "totals",
    ]);
  });

  it("carries totals and dashboard through intact", async () => {
    const wide = await loadWideReport();
    const { report } = deriveSnapshot(wide, TEST_GLANCE, TEST_DCA);
    expect(report.totals).toEqual(wide.totals);
    expect(report.dashboard).toEqual(wide.dashboard);
    // The narrowing must be by CONSTRUCTION, not a cast: a `report as
    // ProjectionReport` would leave the wide object at runtime and serialize every
    // dropped key into JSONB. Serializing the payload is the runtime proof.
    const serialized = JSON.parse(JSON.stringify(report)) as unknown;
    expect(scanForbiddenKeys(serialized)).toEqual([]);
    expect(Object.keys(serialized as object).sort()).toEqual([
      "dashboard",
      "dca",
      "glance",
      "totals",
    ]);
  });

  it("narrows the shipped fixture the same way (a wide real-shaped report)", async () => {
    const fixture = await loadFixture();
    expect(Object.keys(toProjectionReport(fixture, TEST_GLANCE, TEST_DCA)).sort()).toEqual([
      "dashboard",
      "dca",
      "glance",
      "totals",
    ]);
    expect(scanForbiddenKeys(toProjectionReport(fixture, TEST_GLANCE, TEST_DCA))).toEqual([]);
  });
});

/**
 * D14's runtime guard — NO MARK DATE ANYWHERE ON THE WIRE.
 *
 * The rejected design was `markAsOf?` on every `CompositionRow`: a per-instrument
 * observation timeline, materially closer to the `priceJourneys` D8 dropped on
 * purpose, and a disclosure of which instruments are actively traded. The glance
 * block ships the CONCLUSION of expectation-vs-arrival instead. This test is what
 * makes that survive the next increment — it does not care which key a date arrives
 * under, only that none does.
 *
 * `summary.asOf` is the ONE date the payload has always carried: a single
 * fold-level anchor, and the row's own primary key. It is named as the sole
 * exception rather than the scan being loosened to "dates are fine".
 */
const ONLY_ALLOWED_DATE_PATH = "$.dashboard.summary.asOf";

/** ISO-date-SHAPED string values, walked to arbitrary depth, reported as `path = value`. */
function scanDateShapedValues(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => scanDateShapedValues(item, `${path}[${i}]`));
  }
  if (typeof value === "string") {
    return /\d{4}-\d{2}-\d{2}/.test(value) ? [`${path} = ${value}`] : [];
  }
  if (value === null || typeof value !== "object") {
    return [];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    scanDateShapedValues(child, `${path}.${key}`),
  );
}

describe("D14 date contract (no mark date reaches the cloud)", () => {
  it("finds the dates in the WIDE input — the date scanner has teeth", async () => {
    // False-pass guard, same polarity as the two above. The un-narrowed report is
    // full of dates (closed-book open/close dates, price-journey points); if the
    // scanner reported none of them, the assertion below would be decoration.
    const hits = scanDateShapedValues(await loadWideReport());
    expect(hits.some((h) => h.includes("closedBook.rows[0].openedAsOf"))).toBe(true);
    expect(hits.some((h) => h.includes("priceJourneys"))).toBe(true);
    expect(hits.length).toBeGreaterThan(2);
  });

  it("finds NO date-shaped value in the payload outside summary.asOf", async () => {
    const wide = await loadWideReport();
    const { report } = deriveSnapshot(wide, TEST_GLANCE, TEST_DCA);
    const hits = scanDateShapedValues(report);

    expect(
      hits.map((h) => h.split(" = ")[0]),
      `the payload carries date-shaped values outside ${ONLY_ALLOWED_DATE_PATH}. A ` +
        `per-instrument mark date is exactly what D14 refuses to ship — push the ` +
        `CONCLUSION, not the observation timeline:\n${hits.join("\n")}`,
    ).toEqual([ONLY_ALLOWED_DATE_PATH]);
  });

  it("the glance block in particular carries no date at all", async () => {
    const wide = await loadWideReport();
    const { report } = deriveSnapshot(wide, TEST_GLANCE, TEST_DCA);
    expect(scanDateShapedValues(report.glance, "$.glance")).toEqual([]);
  });

  it("the dca branch in particular carries no date at all", async () => {
    // The plans sidecar is ENTIRELY date-driven — `effectiveAt` selects the winning
    // line, `anchorAt` phases a cadence — so this branch had the easiest possible
    // route to putting a second date on the wire, and the builder's answer is that
    // `asOf` is an INPUT to the selection and never an output of it. Asserted on the
    // branch directly, not only through the payload-wide scan above, because a date
    // here would be a decision somebody made rather than a key that slipped.
    const wide = await loadWideReport();
    const { report } = deriveSnapshot(wide, TEST_GLANCE, TEST_DCA);
    expect(scanDateShapedValues(report.dca, "$.dca")).toEqual([]);
  });
});
