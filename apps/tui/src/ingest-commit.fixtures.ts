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

/** A folded read model + the single parsed event, from the fixtures above. */
export function foldedFixture(): {
  // SLICE-A SHIM — replaced in PRD #323 slice D. `foldEvents` now returns an envelope;
  // the capture fixture still hands the bare read model to `deriveHeadDigest`.
  folded: ReturnType<typeof foldEvents>["data"];
  appended: PortfolioEvent[];
} {
  const parsedGenesis = parseFundReview(JSON.stringify(GENESIS));
  if (parsedGenesis.kind !== "ok") throw new Error("bad genesis fixture");
  const parsedMark = parseEvent(MARK);
  if (parsedMark.kind !== "ok") throw new Error("bad mark fixture");
  const appended = [parsedMark.value];
  const folded = foldEvents(parsedGenesis.value, appended).data; // SLICE-A SHIM — PRD #323 slice D
  return { folded, appended };
}

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
