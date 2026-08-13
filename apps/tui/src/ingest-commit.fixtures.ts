// Shared fixtures for the durable-log capture tests (hardening + ingest wiring).
// A genesis seed with one live position, one PriceMarked event that folds cleanly,
// and small git helpers for building throwaway repos in the OS tmpdir.
import { spawnSync } from "node:child_process";
import {
  EVENT_SCHEMA_VERSION,
  foldEvents,
  parseEvent,
  parseFundReview,
  type PortfolioEvent,
} from "@numisma/engine";

export const GENESIS = {
  fund: { id: "fund-1", name: "Accumulus", baseCurrency: "USD" },
  review: { asOf: "2026-06-01", usdMxn: 20 },
  portfolios: [{ id: "core", name: "Core" }],
  accounts: [{ id: "xtb-usd", name: "Main Broker", platform: "XTB", currency: "USD" }],
  instruments: [{ id: "aapl-usd", name: "Apple Inc.", symbol: "AAPL", currency: "USD" }],
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

export const MARK = {
  id: "mark-aapl",
  asOf: "2026-06-06",
  type: "PriceMarked",
  instrumentId: "aapl-usd",
  price: 160,
};

/** Serialize an inbox event the way the durable log stores its lines. */
export function logLine(event: Record<string, unknown>): string {
  return `${JSON.stringify({ schemaVersion: EVENT_SCHEMA_VERSION, ...event })}\n`;
}

/**
 * The fold ENVELOPE + the single parsed event, from the fixtures above. The envelope,
 * not the bare read model: the capture derives its digest from `{data, skipped}` so the
 * committed head carries a discard count (ADR-020). This fixture's log folds cleanly, so
 * its `skipped` is empty — {@link GHOST_CLOSE} seeds the drop case.
 */
export function foldedFixture(): {
  folded: ReturnType<typeof foldEvents>;
  appended: PortfolioEvent[];
} {
  const parsedGenesis = parseFundReview(JSON.stringify(GENESIS));
  if (parsedGenesis.kind !== "ok") throw new Error("bad genesis fixture");
  const parsedMark = parseEvent(MARK);
  if (parsedMark.kind !== "ok") throw new Error("bad mark fixture");
  const appended = [parsedMark.value];
  const folded = foldEvents(parsedGenesis.value, appended);
  return { folded, appended };
}

/**
 * A close naming a position that was never opened — the fold reads it, cannot apply it,
 * and records the drop. Authored for these tests; every id is invented here.
 */
export const GHOST_CLOSE = {
  id: "close-ghost",
  asOf: "2026-06-07",
  type: "PositionClosed",
  positionId: "never-opened",
  settlement: { reserveId: "cash-core", proceeds: 400 },
};

/** Run git in `cwd`, returning status + stdout (never throws). */
export function git(cwd: string, args: string[]): { status: number; stdout: string } {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return { status: result.status ?? -1, stdout: result.stdout ?? "" };
}

/** Initialize a throwaway git repo with a configured identity and a seed commit. */
export function initGitRepo(dir: string): void {
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test Operator"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  git(dir, ["commit", "-q", "--allow-empty", "-m", "seed"]);
}
