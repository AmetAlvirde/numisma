/**
 * THE INTERACTIVE HALF OF THE FOLD'S DISCARD CHANNEL (PRD #323 slice E, seam E) — what
 * an operator AT THE KEYBOARD is told, as against the single counted line the unattended
 * push prints (`apps/web/src/push/fold-discard-surface.test.ts` owns that half).
 *
 * Three properties are pinned here, and each of them is a ruling rather than a taste:
 *
 *  - **The enumeration reaches the operator in full** — every skip's LOCATOR (`eventId`
 *    + index), VERB and REASON. The id is what makes the finding actionable, because it
 *    is greppable in the append-only `events.jsonl`.
 *  - **The bound is PER KIND** — the fold's lines are capped over the fold's lines
 *    alone, never over a concatenation with the co-tenant liveness lines. That is PR
 *    #322's `formatGapReport` starvation lesson and ADR-020's reserved-capacity rule:
 *    a bound over the concatenation withholds whichever kind sorts last, forever.
 *  - **Truncation announces itself.** A bound that renders as an all-clear is the same
 *    defect wearing a cap.
 *
 * Every event line below is AUTHORED — invented ids naming an invented reserve the
 * authored genesis seed never declares — and so is every expected string.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_FOLD_DISCARD_LINES,
  formatFoldDiscards,
  resolveEventStorePaths,
  type EventStorePaths,
} from "@numisma/event-store";
import { loadFoldLines } from "./fold-lines.js";
import { prepareStartup } from "./startup.js";

const GENESIS_AS_OF = "2026-06-01";

/** A reserve id the authored seed does not declare — every deposit below names it. */
const ABSENT_RESERVE = "authored-reserve-never-opened";

function genesisSeed() {
  return {
    fund: { id: "fund-1", name: "Accumulus", baseCurrency: "USD" },
    review: { asOf: GENESIS_AS_OF, usdMxn: 20 },
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
}

/** One authored `Deposit` onto the absent reserve — drop kind 4, `reserve-absent`. */
function droppedDepositLine(id: string): string {
  return JSON.stringify({
    id,
    asOf: "2026-06-05",
    type: "Deposit",
    reserveId: ABSENT_RESERVE,
    amount: 250,
    tier: "c1",
  });
}

function droppedLog(count: number): string {
  return `${Array.from({ length: count }, (_, n) => droppedDepositLine(`authored-drop-${n + 1}`)).join("\n")}\n`;
}

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(createdDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  createdDirs.length = 0;
});

async function makeStore(log: string): Promise<EventStorePaths> {
  const dir = await mkdtemp(resolve(tmpdir(), "numisma-fold-lines-"));
  createdDirs.push(dir);
  const paths = resolveEventStorePaths(dir);
  await writeFile(paths.genesis, JSON.stringify(genesisSeed()), "utf8");
  await writeFile(paths.log, log, "utf8");
  return paths;
}

describe("formatFoldDiscards — the enumeration, for a human at the keyboard", () => {
  it("carries every skip's locator, verb and reason", () => {
    const lines = formatFoldDiscards({
      skipped: [
        {
          eventId: "authored-drop-1",
          index: 4,
          verb: "Deposit",
          reason: "reserve-absent",
          detail: "authored fixed prose",
        },
      ],
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("authored-drop-1");
    expect(lines[0]).toContain("index 4");
    expect(lines[0]).toContain("Deposit");
    expect(lines[0]).toContain("reserve-absent");
    expect(lines[0]).toContain("authored fixed prose");
  });

  it("says NOTHING on a clean fold — silence is what makes the channel readable", () => {
    expect(formatFoldDiscards({ skipped: [] })).toEqual([]);
  });

  it("dedups on (eventId, reason), so a re-fold of the same log does not double it", () => {
    const skip = {
      eventId: "authored-drop-1",
      index: 0,
      verb: "Deposit",
      reason: "reserve-absent" as const,
      detail: "authored fixed prose",
    };

    expect(formatFoldDiscards({ skipped: [skip, { ...skip }] })).toHaveLength(1);
  });

  it("ANNOUNCES its truncation rather than reading as an all-clear", () => {
    const skipped = Array.from({ length: MAX_FOLD_DISCARD_LINES + 5 }, (_, n) => ({
      eventId: `authored-drop-${n + 1}`,
      index: n,
      verb: "Deposit",
      reason: "reserve-absent" as const,
      detail: "authored fixed prose",
    }));

    const lines = formatFoldDiscards({ skipped });

    // The cap, plus ONE line naming exactly how much was withheld.
    expect(lines).toHaveLength(MAX_FOLD_DISCARD_LINES + 1);
    expect(lines[lines.length - 1]).toContain("5 further dropped event(s)");
  });
});

describe("loadFoldLines — the startup channel's fold kind", () => {
  it("enumerates the drops it found", async () => {
    const paths = await makeStore(droppedLog(2));

    const lines = await loadFoldLines(paths);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("authored-drop-1");
    expect(lines[1]).toContain("authored-drop-2");
  });

  it("is SILENT on a clean log", async () => {
    expect(await loadFoldLines(await makeStore(""))).toEqual([]);
  });

  it("says so when the check itself could not run — never a silent all-clear", async () => {
    const paths = await makeStore("this line is authored garbage, not JSON\n");

    const lines = await loadFoldLines(paths);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("were NOT checked");
  });
});

describe("RESERVED CAPACITY — the fold kind neither starves nor is starved", () => {
  it("keeps its full bound however loud a co-tenant on the same channel is", async () => {
    const paths = await makeStore(droppedLog(40));
    const emitted: string[] = [];
    // A co-tenant filing 500 lines onto the SAME startup channel. Under a bound taken
    // over the concatenation the fold's lines would never be reached; the bound is
    // taken per kind, so it cannot be.
    const coTenant = Array.from(
      { length: 500 },
      (_, n) => `Numisma: authored co-tenant line ${n + 1}`,
    );

    await prepareStartup(paths, ["node", "app"], {
      emit: (line) => emitted.push(line),
      livenessLines: async () => coTenant,
      foldLines: (asOf) => loadFoldLines(paths, asOf),
    });

    const foldLines = emitted.filter((line) => line.includes("DROPPED EVENT"));
    expect(foldLines).toHaveLength(MAX_FOLD_DISCARD_LINES);
    expect(emitted.some((line) => line.includes("28 further dropped event(s)"))).toBe(true);
    // …and the co-tenant is not starved either: this channel bounds each kind at its
    // own leaf, so 500 lines of one kind and 12 of the other both arrive intact.
    expect(emitted.filter((line) => line.includes("authored co-tenant"))).toHaveLength(500);
  });

  it("stays SILENT for an entry point that does not ask — no default", async () => {
    const paths = await makeStore(droppedLog(3));
    const emitted: string[] = [];

    // `report`, `spine` and `plans` enumerate at their own call sites; the smoke harness
    // says nothing at all. A default here would print on surfaces that never asked.
    await prepareStartup(paths, ["node", "app"], { emit: (line) => emitted.push(line) });

    expect(emitted.some((line) => line.includes("DROPPED EVENT"))).toBe(false);
  });

  it("cannot stop the dashboard mounting, even when the adapter throws", async () => {
    const paths = await makeStore("");
    const emitted: string[] = [];

    const plan = await prepareStartup(paths, ["node", "app"], {
      emit: (line) => emitted.push(line),
      foldLines: () => {
        throw new Error("authored adapter failure");
      },
    });

    // The plan still came back — the operator gets the dashboard AND is told the check
    // is broken, rather than one at the cost of the other.
    expect(plan.sourcePath).toBe(paths.log);
    expect(emitted.some((line) => line.includes("authored adapter failure"))).toBe(true);
  });

  it("reports on the fold the dashboard will RENDER, not on current state", async () => {
    // The drops are dated 2026-06-05; an --as-of before that folds a window that never
    // read them, so naming them would accuse a fold that does not exist.
    const paths = await makeStore(droppedLog(2));
    const emitted: string[] = [];

    await prepareStartup(paths, ["node", "app", "--as-of", "2026-06-03"], {
      emit: (line) => emitted.push(line),
      foldLines: (asOf) => loadFoldLines(paths, asOf),
    });

    expect(emitted.some((line) => line.includes("DROPPED EVENT"))).toBe(false);
  });
});
