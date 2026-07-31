/**
 * The IO shell's acceptance criteria, over a REAL temp `orders.jsonl`: re-importing the
 * same export appends zero lines, `O1` refuses with nothing on disk, a re-priced rung
 * round-trips as cancel-and-place, and the funding reserve is asked once per batch.
 *
 * EVERY FIXTURE IS A SYNTHETIC LADDER (`O7`). The pair is invented, the rungs are round
 * hundreds, the sizes are round tenths and the reserve balance is a round thousand. The
 * real ladder's figures live only in the private notes vault. Assertions are on
 * PROPERTIES — ids present or absent, byte-identical files, counts — never on a value.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { appendOrders, loadOrders, resolveOrdersPath } from "@numisma/preferences";
import {
  BITGET_OPEN_ORDERS_HEADER,
  parseBitgetOpenOrdersCsv,
  type ReserveBalance,
} from "@numisma/engine";
import { afterEach, describe, expect, it } from "vitest";
import { importBitgetOpenOrders, type OrdersImportIo } from "./import-orders.js";

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(createdDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  createdDirs.length = 0;
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(resolve(tmpdir(), "numisma-orders-import-"));
  createdDirs.push(dir);
  return dir;
}

const HEADER = BITGET_OPEN_ORDERS_HEADER.join(",");

/** One synthetic rung. Obvious fakes throughout: pair `XYZ/USDT`, round prices/sizes. */
function rung(price: string, quantity: string, at: string): string {
  const fields: Record<string, string> = {
    timestamp: at,
    pair: "XYZ/USDT",
    time_in_force: "GTC",
    order_type: "Limit",
    side: "Buy",
    price,
    quantity,
    trigger_price: "-- / --",
    order_value: "0",
    filled_quantity: "0",
    total_quantity: quantity,
    filled_percent: "0.00%",
    status: "Unfilled",
    action: "Cancel",
  };
  return BITGET_OPEN_ORDERS_HEADER.map((column) => fields[column] ?? "").join(",");
}

function ladder(...rows: string[]): string {
  return [HEADER, ...rows, ""].join("\n");
}

/** A two-rung synthetic ladder: 0.1 @ 1000 and 0.1 @ 900, committing 190 in total. */
const TWO_RUNG_LADDER = ladder(
  rung("1000", "0.1", "2020-01-01 10:00:00"),
  rung("900", "0.1", "2020-01-01 10:00:01"),
);

interface Harness {
  io: OrdersImportIo;
  csvPath: string;
  ordersPath: string;
  asked: string[];
  errors: string[];
}

interface HarnessOptions {
  csv?: string;
  /**
   * Scripted prompt answers, consumed in order. The script REPEATS once exhausted, so a
   * single harness can drive two successive imports (the re-import and re-price cases)
   * with the operator answering the same way both times.
   */
  answers?: string[];
  balances?: ReserveBalance[];
}

async function harness(options: HarnessOptions = {}): Promise<Harness> {
  const dir = await tempDir();
  const csvPath = join(dir, "open-orders.csv");
  await writeFile(csvPath, options.csv ?? TWO_RUNG_LADDER, "utf8");
  const ordersPath = resolveOrdersPath(join(dir, "data"));

  const asked: string[] = [];
  const errors: string[] = [];
  const script = options.answers ?? ["reserve-a", "n"];
  let answers = [...script];

  return {
    csvPath,
    ordersPath,
    asked,
    errors,
    io: {
      readExport: (path) => readFile(path, "utf8"),
      ordersPath,
      loadOrders: (path) => loadOrders(path, { warn: () => {} }),
      appendOrders,
      reserveBalances: async () => options.balances ?? [{ id: "reserve-a", amount: 1000 }],
      ask: async (question) => {
        asked.push(question);
        if (answers.length === 0) {
          answers = [...script];
        }
        return answers.shift() ?? "";
      },
      out: () => {},
      err: (message) => {
        errors.push(message);
      },
    },
  };
}

async function readOrDefault(path: string, fallback: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return fallback;
  }
}

async function idsOnDisk(path: string): Promise<string[]> {
  const load = await loadOrders(path, { warn: () => {} });
  return load.status === "loaded" ? load.records.map((record) => record.id) : [];
}

describe("importBitgetOpenOrders — deterministic ids (testing decision 5)", () => {
  it("appends the ladder once and ZERO lines on a re-import of the same export", async () => {
    const first = await harness();
    const imported = await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });
    expect(imported).toMatchObject({ status: "imported", appended: 2, alreadyKnown: 0 });

    const afterFirst = await readFile(first.ordersPath, "utf8");

    const again = await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });
    expect(again).toMatchObject({ status: "imported", appended: 0, alreadyKnown: 2 });

    // The file is BYTE-IDENTICAL: not merely "no new orders", but no new lines at all.
    expect(await readFile(first.ordersPath, "utf8")).toBe(afterFirst);
    expect(await idsOnDisk(first.ordersPath)).toHaveLength(2);
  });

  it("carries the pair's quote currency onto every record, explicitly", async () => {
    const { csvPath, io, ordersPath } = await harness();
    await importBitgetOpenOrders({ csvPath, io });
    const load = await loadOrders(ordersPath, { warn: () => {} });
    expect(load.status).toBe("loaded");
    if (load.status !== "loaded") return;
    expect(load.records.map((record) => record.currency)).toEqual(["USD", "USD"]);
  });
});

describe("a re-priced rung round-trips as cancel-and-place", () => {
  it("drops the old id and gains a new one, with no re-price branch anywhere", async () => {
    const first = await harness();
    await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });
    const before = await idsOnDisk(first.ordersPath);

    // The SAME rung, re-priced by the operator at the venue and re-exported. Nothing in
    // the export says "this replaces that" — the difference is only the price.
    const repriced = ladder(
      rung("1000", "0.1", "2020-01-01 10:00:00"),
      rung("890", "0.1", "2020-01-01 11:00:00"),
    );
    await writeFile(first.csvPath, repriced, "utf8");
    const second = await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });
    expect(second).toMatchObject({ status: "imported", appended: 1, alreadyKnown: 1 });

    const after = await idsOnDisk(first.ordersPath);
    const oldRung = before.find((id) => !id.includes(":1000:"));
    expect(oldRung).toBeDefined();
    // The re-priced rung's NEW id is present; the old id is absent from the new export.
    const observedNow = parseBitgetOpenOrdersCsv(repriced);
    expect(observedNow.status).toBe("ok");
    if (observedNow.status !== "ok") return;
    const observedIds = observedNow.orders.map((order) => order.id);
    expect(observedIds).not.toContain(oldRung);
    expect(after).toEqual(expect.arrayContaining(observedIds));
  });
});

describe("`O1` — the over-commitment reject (testing decision 6)", () => {
  it("refuses loudly and leaves the sidecar untouched when it does not yet exist", async () => {
    const { csvPath, io, ordersPath, errors } = await harness({
      // A balance far below the synthetic ladder's committed sum.
      balances: [{ id: "reserve-a", amount: 10 }],
    });

    const outcome = await importBitgetOpenOrders({ csvPath, io });
    expect(outcome).toMatchObject({ status: "rejected", reason: "over-committed" });
    expect(errors.join("\n")).toContain("REFUSED");
    // NOTHING written: the file was never created.
    expect(await readOrDefault(ordersPath, "<<absent>>")).toBe("<<absent>>");
  });

  it("leaves an EXISTING sidecar byte-identical when it refuses", async () => {
    const first = await harness();
    await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });
    const before = await readFile(first.ordersPath, "utf8");

    const overflowing = ladder(rung("1000", "5", "2020-02-02 10:00:00"));
    await writeFile(first.csvPath, overflowing, "utf8");
    const outcome = await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    expect(outcome).toMatchObject({ status: "rejected", reason: "over-committed" });
    expect(await readFile(first.ordersPath, "utf8")).toBe(before);
  });

  it("counts the orders ALREADY on file toward the reserve, not just the new batch", async () => {
    // Each half fits the balance alone; together they do not.
    const first = await harness({ balances: [{ id: "reserve-a", amount: 250 }] });
    await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });
    const before = await readFile(first.ordersPath, "utf8");

    const more = ladder(rung("800", "0.1", "2020-01-02 10:00:00"));
    await writeFile(first.csvPath, more, "utf8");
    const outcome = await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    expect(outcome).toMatchObject({ status: "rejected", reason: "over-committed" });
    expect(await readFile(first.ordersPath, "utf8")).toBe(before);
  });

  it("refuses a reserve the fold has never heard of, rather than reading it as zero", async () => {
    const { csvPath, io, ordersPath } = await harness({ answers: ["reserve-typo", "n"] });
    const outcome = await importBitgetOpenOrders({ csvPath, io });
    expect(outcome).toMatchObject({ status: "rejected", reason: "unknown-reserve" });
    expect(await readOrDefault(ordersPath, "<<absent>>")).toBe("<<absent>>");
  });
});

describe("the declared half — one field, once per batch", () => {
  it("asks for the funding reserve ONCE and stamps it on every rung", async () => {
    const { csvPath, io, ordersPath, asked } = await harness({ answers: ["reserve-a", "n"] });
    await importBitgetOpenOrders({ csvPath, io });

    const reserveQuestions = asked.filter((question) => question.includes("this batch"));
    expect(reserveQuestions).toHaveLength(1);

    const load = await loadOrders(ordersPath, { warn: () => {} });
    if (load.status !== "loaded") throw new Error("expected a loaded sidecar");
    expect(
      load.records.map((record) => (record.kind === "orderPlaced" ? record.fundingReserveId : "")),
    ).toEqual(["reserve-a", "reserve-a"]);
  });

  it("lets ONE rung be overridden, keeping the batch answer for the rest", async () => {
    const { csvPath, io, ordersPath } = await harness({
      answers: ["reserve-a", "y", "", "reserve-b"],
      balances: [
        { id: "reserve-a", amount: 1000 },
        { id: "reserve-b", amount: 1000 },
      ],
    });
    await importBitgetOpenOrders({ csvPath, io });

    const load = await loadOrders(ordersPath, { warn: () => {} });
    if (load.status !== "loaded") throw new Error("expected a loaded sidecar");
    expect(
      load.records.map((record) => (record.kind === "orderPlaced" ? record.fundingReserveId : "")),
    ).toEqual(["reserve-a", "reserve-b"]);
  });

  it("records NEITHER a positionId NOR a batch/ladder id", async () => {
    const { csvPath, io, ordersPath } = await harness();
    await importBitgetOpenOrders({ csvPath, io });
    const raw = await readFile(ordersPath, "utf8");
    expect(raw).not.toContain("positionId");
    expect(raw).not.toContain("ladderId");
    expect(raw).not.toContain("batchId");
  });

  it("writes nothing when no funding reserve is declared", async () => {
    const { csvPath, io, ordersPath } = await harness({ answers: [""] });
    const outcome = await importBitgetOpenOrders({ csvPath, io });
    expect(outcome).toMatchObject({ status: "rejected", reason: "no-reserve-declared" });
    expect(await readOrDefault(ordersPath, "<<absent>>")).toBe("<<absent>>");
  });
});

describe("the export is refused whole when it is not an open-orders export", () => {
  it("rejects an unrecognized header without prompting or writing", async () => {
    const { csvPath, io, ordersPath, asked } = await harness({
      csv: "timestamp,pair,side,price,quantity,fee\n2020-01-01 10:00:00,XYZ/USDT,Buy,1000,0.1,0\n",
    });
    const outcome = await importBitgetOpenOrders({ csvPath, io });
    expect(outcome).toMatchObject({ status: "rejected", reason: "unrecognized-header" });
    expect(asked).toEqual([]);
    expect(await readOrDefault(ordersPath, "<<absent>>")).toBe("<<absent>>");
  });

  it("refuses to compute committed over a sidecar it cannot fully read", async () => {
    const { csvPath, io, ordersPath } = await harness();
    await mkdir(dirname(ordersPath), { recursive: true });
    await writeFile(ordersPath, "{not json}\n", "utf8");

    const outcome = await importBitgetOpenOrders({ csvPath, io });
    expect(outcome).toMatchObject({ status: "rejected", reason: "unreadable-sidecar-lines" });
    expect(await readFile(ordersPath, "utf8")).toBe("{not json}\n");
  });
});
