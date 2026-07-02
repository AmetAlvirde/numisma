/**
 * PROTOTYPE (mvi 2026-07-01-realized-pnl). Non-destructive end-to-end tracer for the
 * realized-P&L closed book (#1) + invalidation watch (#4).
 *
 * It folds the REAL git-ignored genesis + event log, PLUS the real staged inbox
 * closes (GRAM + RENDER, operator-supplied proceeds) and a couple of PROTOTYPE
 * `InvalidationMarked` levels, entirely IN MEMORY — it never appends to
 * `data/events.jsonl` or archives the inbox. So the real durable log stays clean and
 * this demo is fully reversible; only `pnpm dev` / `pnpm report` (the real ingest
 * path) would persist the staged closes.
 *
 * Every event still flows through the real ingest gates (`parseEvent` +
 * `crossReferenceEvent`) before the fold, proving the seam: the closed book and the
 * new 7th verb ride the existing spine, `event-store.ts` unchanged.
 *
 * Run: `pnpm --filter @numisma/tui demo:realized-pnl`
 */
import {
  applyEventToReference,
  buildCompositionReport,
  buildEventReference,
  crossReferenceEvent,
  foldEvents,
  formatCompositionReport,
  parseEvent,
  type PortfolioEvent,
} from "@numisma/engine";
import { readFile } from "node:fs/promises";
import {
  loadGenesis,
  loadEventLog,
  resolveEventStorePaths,
} from "./event-store.js";

/**
 * PROTOTYPE invalidation levels layered on real OPEN positions for the demo. These
 * are illustrative thesis stops, NOT real operator decisions — the visible mocked-
 * data shortcut. `wealth-eth` gets two marks to show latest-wins revision, and its
 * final level (below 1600, vs the real 1570.11 mark) breaches; `capital-btc` stays OK.
 */
const PROTOTYPE_INVALIDATIONS: PortfolioEvent[] = [
  { id: "demo-inval-btc-1", asOf: "2026-06-30", type: "InvalidationMarked", positionId: "capital-btc", price: 55000, direction: "below" },
  { id: "demo-inval-eth-1", asOf: "2026-06-30", type: "InvalidationMarked", positionId: "wealth-eth", price: 1500, direction: "below" },
  { id: "demo-inval-eth-2", asOf: "2026-06-30", type: "InvalidationMarked", positionId: "wealth-eth", price: 1600, direction: "below" },
];

async function readInbox(inboxPath: string): Promise<PortfolioEvent[]> {
  const raw = await readFile(inboxPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Inbox ${inboxPath} must be a JSON array.`);
  }
  return parsed as PortfolioEvent[];
}

const paths = resolveEventStorePaths();
const genesis = await loadGenesis(paths.genesis);
const logLoad = await loadEventLog(paths.log);

// Candidate events to layer on the durable log: the real staged inbox closes/deposit
// + the prototype invalidation levels. Validate each through the real ingest gates.
const staged = await readInbox(paths.inbox);
const candidates = [...staged, ...PROTOTYPE_INVALIDATIONS];

const reference = buildEventReference(genesis, logLoad.events);
const accepted: PortfolioEvent[] = [];
for (const [index, candidate] of candidates.entries()) {
  const parsed = parseEvent(candidate);
  if (parsed.kind !== "ok") {
    throw new Error(`Candidate [${index}] failed parse (${parsed.path}: ${parsed.message}).`);
  }
  const crossRef = crossReferenceEvent(parsed.value, reference);
  if (crossRef.kind !== "ok") {
    throw new Error(`Candidate [${index}] failed cross-reference (${crossRef.path}: ${crossRef.message}).`);
  }
  applyEventToReference(reference, parsed.value);
  accepted.push(parsed.value);
}

const combined = [...logLoad.events, ...accepted];
const data = foldEvents(genesis, combined);
const report = buildCompositionReport(data, {
  load: { status: "loaded", sourcePath: `${paths.log} + staged inbox + prototype invalidations (in-memory)` },
});

process.stdout.write(`${formatCompositionReport(report)}\n`);

// A compact proof line the eye can check against the blotter above.
process.stdout.write(
  `\n[demo] NAV (fund value) is unchanged by the blotter — realized is descriptive only.\n` +
    `[demo] ${accepted.length} candidate events accepted through parseEvent + crossReferenceEvent ` +
    `(no disk write).\n`,
);
