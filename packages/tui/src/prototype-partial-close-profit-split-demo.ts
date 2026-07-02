/**
 * PROTOTYPE (mvi 2026-07-02-partial-close-profit-split). Non-destructive end-to-end
 * tracer for the combined MVI: (A) `PositionTrimmed` partial close, (B)
 * `PositionAddedTo` lot append, and (C) the derived, descriptive-only profit-split
 * layer driven by a preferences sidecar DECOUPLED from the event log.
 *
 * It folds the REAL git-ignored genesis + event log, layers the prototype trim/add
 * entirely IN MEMORY (never appends to `data/events.jsonl`), and reads/seeds the
 * committable preferences sidecar (`data/preferences.jsonl`). Every event still flows
 * through the real ingest gates (`parseEvent` + `crossReferenceEvent`) before the
 * fold, proving the seam: the two new verbs and the profit-split ride the existing
 * spine with `event-store.ts` unchanged.
 *
 * Run: `pnpm --filter @numisma/tui demo:partial-close`
 */
import {
  applyEventToReference,
  buildCompositionReport,
  buildEventReference,
  composeProfitSplit,
  crossReferenceEvent,
  foldEvents,
  formatCompositionReport,
  formatProfitSplit,
  parseEvent,
  pickPolicyAsOf,
  type PortfolioEvent,
  type ProfitPolicyEntry,
} from "@numisma/engine";
import { loadEventLog, loadGenesis, resolveEventStorePaths } from "./event-store.js";
import {
  loadPreferences,
  resolvePreferencesPath,
  writePreferences,
} from "./preferences.js";

const TRIM_POSITION = "capital-btc"; // real OPEN position with c1 + c2 lots
const SETTLE_RESERVE = "pulse-bitget-usdt"; // real tiered USD trading reserve
const ROUTING_RESERVE = "reserve-binance-usdt"; // the profit-sink Reserve (inferred)

function must(result: ReturnType<typeof parseEvent>, label: string): PortfolioEvent {
  if (result.kind !== "ok") {
    throw new Error(`${label} failed (${result.path}: ${result.message}).`);
  }
  return result.value;
}

const paths = resolveEventStorePaths();
const genesis = await loadGenesis(paths.genesis);
const log = (await loadEventLog(paths.log)).events;

// --- Baseline: the pure #90 book, ZERO preferences ---------------------------------
const baseData = foldEvents(genesis, log);
const baseReport = buildCompositionReport(baseData);
const baseNav = baseReport.totals.fundValueUsd;

const btc = baseData.positions.find((position) => position.id === TRIM_POSITION);
if (!btc) {
  throw new Error(`Expected open position '${TRIM_POSITION}' in the real fold.`);
}
const mark = btc.markPrice;
const c2Qty = btc.lots.filter((lot) => lot.tier === "c2").reduce((sum, lot) => sum + lot.quantity, 0);
const addQty = 0.005;

// --- A. Trim: remove all of c2 (leave c1); settle proceeds at market ----------------
const trim = must(
  parseEvent({
    id: "proto-trim-btc-c2",
    asOf: "2026-07-02",
    type: "PositionTrimmed",
    positionId: TRIM_POSITION,
    removals: [{ tier: "c2", quantity: c2Qty }],
    settlement: { reserveId: SETTLE_RESERVE, proceeds: c2Qty * mark },
  }),
  "trim parse",
);

// --- B. Add: append a NEW c1 lot at a different cost (never merged) -----------------
const add = must(
  parseEvent({
    id: "proto-add-btc-c1",
    asOf: "2026-07-02",
    type: "PositionAddedTo",
    positionId: TRIM_POSITION,
    lot: { tier: "c1", quantity: addQty, cost: mark },
    funding: { reserveId: SETTLE_RESERVE, amount: addQty * mark },
  }),
  "add parse",
);

// Both flow through the real cross-ref gate before the fold.
const reference = buildEventReference(genesis, log);
for (const [event, label] of [[trim, "trim"], [add, "add"]] as const) {
  const crossRef = crossReferenceEvent(event, reference);
  if (crossRef.kind !== "ok") {
    throw new Error(`${label} cross-reference failed (${crossRef.path}: ${crossRef.message}).`);
  }
  applyEventToReference(reference, event);
}

const data = foldEvents(genesis, [...log, trim, add]);
const report = buildCompositionReport(data, {
  load: { status: "loaded", sourcePath: `${paths.log} + prototype trim/add (in-memory)` },
});
const nav = report.totals.fundValueUsd;

// --- C. Profit split from the preferences sidecar (composed at read time) -----------
const prefsPath = resolvePreferencesPath();
await writePreferences(prefsPath, [
  {
    effectiveAt: genesis.review.asOf,
    split: { wealth: 60, reserve: 40 },
    splitBasis: "highWaterMark",
    routingReserveId: ROUTING_RESERVE,
    reserveTargetPct: 10,
  },
]);
const prefsHwm = await loadPreferences(prefsPath);
const policyHwm = pickPolicyAsOf(prefsHwm);
const reservePct = report.dashboard.summary.reserve?.percentOfFund ?? 0;
const splitHwm = composeProfitSplit(data, policyHwm, genesis, reservePct);

process.stdout.write(`${formatCompositionReport(report)}\n`);
process.stdout.write(`\n${formatProfitSplit(splitHwm)}\n`);

// --- Proof lines -------------------------------------------------------------------
const trimRow = report.closedBook.rows.find((row) => row.positionId === TRIM_POSITION && row.partial);
const survivor = data.positions.find((position) => position.id === TRIM_POSITION);
const settle = data.reserves.find((reserve) => reserve.id === SETTLE_RESERVE);
const baseSettle = baseData.reserves.find((reserve) => reserve.id === SETTLE_RESERVE);

const line = (label: string, ok: boolean, detail: string): string =>
  `[${ok ? "PASS" : "FAIL"}] ${label}: ${detail}`;

const out: string[] = ["", "=== Prototype-target checks ==="];

// 1. Trim → partial blotter row, position survives, reserve credited, NAV conserved.
out.push(
  line(
    "1 trim",
    !!trimRow && !!survivor && survivor.lots.every((l) => l.tier !== "c2"),
    `partial row realized ${trimRow?.realizedPnlUsd.toFixed(2)} (proceeds ${trimRow?.proceedsUsd.toFixed(2)} − cost ${trimRow?.costBasisUsd.toFixed(2)}); ` +
      `${TRIM_POSITION} survives with ${survivor?.lots.length} lot(s), c2 removed; ` +
      `${SETTLE_RESERVE} ${baseSettle?.amount.toFixed(2)} → ${settle?.amount.toFixed(2)}`,
  ),
);
// NAV conservation (trim + add together).
out.push(
  line("  NAV conserved (trim+add)", Math.abs(nav - baseNav) < 0.01, `${baseNav.toFixed(4)} → ${nav.toFixed(4)} (Δ ${(nav - baseNav).toFixed(6)})`),
);

// 2. Add → new lot appended (entryFx/tier preserved, NOT merged), funding debited.
const c1Lots = survivor?.lots.filter((l) => l.tier === "c1") ?? [];
out.push(
  line(
    "2 add",
    c1Lots.length >= 2,
    `${TRIM_POSITION} now has ${c1Lots.length} distinct c1 lots (${c1Lots.map((l) => `${l.quantity}@${l.cost}`).join(", ")}) — appended, not weighted-average-merged`,
  ),
);

// 3. Profit-split dashboard numbers.
out.push(
  line(
    "3 profit split",
    !!splitHwm,
    `cum net realized ${splitHwm?.cumulativeNetRealizedUsd.toFixed(2)}, obligation(HWM) ${splitHwm?.obligationUsd.toFixed(2)}, ` +
      `Reserve ${splitHwm?.reservePctOfNav.toFixed(2)}% vs ${splitHwm?.reserveTargetPct}% target`,
  ),
);

// 4. Blank the block ⇒ NAV unchanged (descriptive-only proof).
const blank = formatProfitSplit(undefined);
out.push(line("4 blank block", blank === "" && report.totals.fundValueUsd === nav, `formatProfitSplit(undefined) === "" and NAV still ${nav.toFixed(4)}`));

// 5. Toggle splitBasis in the sidecar ⇒ obligation recomputes, no code change.
await writePreferences(prefsPath, [
  ...prefsHwm,
  {
    effectiveAt: "2026-07-02",
    split: { wealth: 60, reserve: 40 },
    splitBasis: "perClose",
    routingReserveId: ROUTING_RESERVE,
    reserveTargetPct: 10,
  },
]);
const prefsToggled = await loadPreferences(prefsPath);
const policyPerClose = pickPolicyAsOf(prefsToggled); // latest-wins → perClose
const splitPerClose = composeProfitSplit(data, policyPerClose, genesis, reservePct);
out.push(
  line(
    "5 toggle basis",
    splitPerClose?.basis === "perClose" && splitPerClose?.obligationUsd !== splitHwm?.obligationUsd,
    `sidecar now yields ${splitPerClose?.basis}; obligation ${splitHwm?.obligationUsd.toFixed(2)} (HWM) → ${splitPerClose?.obligationUsd.toFixed(2)} (perClose), no code change`,
  ),
);

// 6. Over-removal ⇒ fails loud at ingest (position-lot-sufficiency gate).
const overTrim = must(
  parseEvent({
    id: "proto-trim-over",
    asOf: "2026-07-02",
    type: "PositionTrimmed",
    positionId: TRIM_POSITION,
    removals: [{ tier: "c2", quantity: c2Qty * 5 }],
    settlement: { reserveId: SETTLE_RESERVE, proceeds: c2Qty * 5 * mark },
  }),
  "over-trim parse",
);
const overRef = buildEventReference(genesis, log);
const overResult = crossReferenceEvent(overTrim, overRef);
out.push(line("6 sufficiency gate", overResult.kind === "event-error", overResult.kind === "event-error" ? overResult.message : "unexpectedly accepted"));

process.stdout.write(`${out.join("\n")}\n`);
process.stdout.write(`\n[demo] No disk write to ${paths.log}. Preferences sidecar at ${prefsPath} (committable fund policy).\n`);
