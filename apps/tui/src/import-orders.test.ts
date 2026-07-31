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
  parseFundReview,
  pickRestingOrdersAsOf,
  type FundReviewData,
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

/** One synthetic rung the venue shows as PARTIALLY FILLED, with a remainder still open. */
function partlyFilledRung(
  price: string,
  quantity: string,
  filled: string,
  at: string,
): string {
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
    filled_quantity: filled,
    total_quantity: quantity,
    filled_percent: "60.00%",
    status: "PartiallyFilled",
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
  /** Everything the flow told the OPERATOR on the normal channel — merges included. */
  outputs: string[];
}

interface HarnessOptions {
  csv?: string;
  /**
   * Scripted prompt answers, consumed in order. The script REPEATS once exhausted, so a
   * single harness can drive two successive imports (the re-import and re-price cases)
   * with the operator answering the same way both times.
   */
  answers?: string[];
  /**
   * The LIVE reserves the folded fund carries, as `{ id, amount }` — synthesized into a
   * real `FundReviewData` by {@link syntheticFund}, because the guard takes the fund now
   * and derives its own reserve set from it (#172). A harness can no longer hand the
   * guard a reserve list the rendered report would reject.
   */
  reserves?: { id: string; amount: number }[];
}

/** A minimal folded fund carrying the given LIVE, USD reserves. Round fakes only (`O7`). */
function syntheticFund(reserves: { id: string; amount: number }[]): FundReviewData {
  const parsed = parseFundReview({
    fund: { id: "synthetic-fund", name: "Synthetic Fund", baseCurrency: "USD" },
    review: { asOf: "2026-01-31", usdMxn: 20 },
    portfolios: [{ id: "core", name: "Core" }],
    accounts: [{ id: "venue-usd", name: "Synthetic Venue", platform: "BITGET", currency: "USD" }],
    instruments: [{ id: "test-usd", name: "Test Asset", symbol: "XYZ", currency: "USD" }],
    reserves: reserves.map((reserve) => ({
      id: reserve.id,
      portfolioId: "core",
      tempo: "Capital",
      executionMode: "live",
      accountId: "venue-usd",
      currency: "USD",
      amount: reserve.amount,
    })),
    positions: [],
  });
  if (parsed.kind !== "ok") throw new Error(`fixture must parse, got ${parsed.kind}`);
  return parsed.value;
}

async function harness(options: HarnessOptions = {}): Promise<Harness> {
  const dir = await tempDir();
  const csvPath = join(dir, "open-orders.csv");
  await writeFile(csvPath, options.csv ?? TWO_RUNG_LADDER, "utf8");
  const ordersPath = resolveOrdersPath(join(dir, "data"));

  const asked: string[] = [];
  const errors: string[] = [];
  const outputs: string[] = [];
  const script = options.answers ?? ["reserve-a", "n"];
  let answers = [...script];

  return {
    csvPath,
    ordersPath,
    asked,
    errors,
    outputs,
    io: {
      readExport: (path) => readFile(path, "utf8"),
      ordersPath,
      loadOrders: (path) => loadOrders(path, { warn: () => {} }),
      appendOrders,
      fundReview: async () => syntheticFund(options.reserves ?? [{ id: "reserve-a", amount: 1000 }]),
      ask: async (question) => {
        asked.push(question);
        if (answers.length === 0) {
          answers = [...script];
        }
        return answers.shift() ?? "";
      },
      out: (message) => {
        outputs.push(message);
      },
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

/** What each rung on disk STILL CLAIMS, through the selector rather than by hand. */
async function remainingOnDisk(path: string): Promise<number[]> {
  const load = await loadOrders(path, { warn: () => {} });
  if (load.status !== "loaded") return [];
  return pickRestingOrdersAsOf(load.records).map((order) => order.remainingQuantity);
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

  it("stays idempotent over a PARTIALLY-FILLED rung — no double-counted partial", async () => {
    // #173. The partial rides on the placement line, so a re-import is the same
    // deterministic id and appends nothing. If it were a synthesized `orderFilled` line
    // instead, the second import would subtract the same 6 units a second time and the
    // rung would read 8 remaining of a 10-unit claim — free capital that does not exist.
    const partial = ladder(partlyFilledRung("100", "10", "6", "2020-01-01 10:00:00"));
    const first = await harness({ csv: partial });
    expect(await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io })).toMatchObject({
      status: "imported",
      appended: 1,
    });
    const afterFirst = await readFile(first.ordersPath, "utf8");
    expect(await remainingOnDisk(first.ordersPath)).toEqual([4]);

    const again = await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });
    expect(again).toMatchObject({ status: "imported", appended: 0, alreadyKnown: 1 });

    // Byte-identical, and the remainder is unmoved: counted once, on both readings.
    expect(await readFile(first.ordersPath, "utf8")).toBe(afterFirst);
    expect(await remainingOnDisk(first.ordersPath)).toEqual([4]);
    // And no `orderFilled` line was ever synthesized — which would also read as a torn
    // fill act, since no lot in `events.jsonl` answers for it.
    const load = await loadOrders(first.ordersPath, { warn: () => {} });
    if (load.status !== "loaded") throw new Error("expected a loaded sidecar");
    expect(load.records.map((record) => record.kind)).toEqual(["orderPlaced"]);
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

describe("one id identifies exactly ONE claim (#174)", () => {
  /** Two rows the venue rendered identically in every id component: same second, same price. */
  const COLLIDING_LADDER = ladder(
    rung("1000", "1", "2020-01-01 10:00:00"),
    rung("1000", "2", "2020-01-01 10:00:00"),
  );

  it("SUMS two rows colliding on one id into a single claim, and appends one line", async () => {
    const { csvPath, io, ordersPath } = await harness({
      csv: COLLIDING_LADDER,
      reserves: [{ id: "reserve-a", amount: 5000 }],
    });
    const outcome = await importBitgetOpenOrders({ csvPath, io });

    expect(outcome).toMatchObject({ status: "imported", appended: 1, alreadyKnown: 0 });
    // ONE line, under ONE id, claiming the SUM. Dropping either row would be a guess;
    // two lines under one id would make the second unreachable to the selector.
    expect(await idsOnDisk(ordersPath)).toHaveLength(1);
    expect(await remainingOnDisk(ordersPath)).toEqual([3]);
  });

  it("REPORTS the merge to the operator, naming both quantities and the total", async () => {
    const { csvPath, io, outputs } = await harness({
      csv: COLLIDING_LADDER,
      reserves: [{ id: "reserve-a", amount: 5000 }],
    });
    await importBitgetOpenOrders({ csvPath, io });

    const merge = outputs.find((message) => message.toLowerCase().includes("merged"));
    expect(merge).toBeDefined();
    const text = merge ?? "";
    expect(text).toContain("1000"); // the price
    expect(text).toContain("2020-01-01T10:00:00"); // the second
    expect(text).toContain("1"); // the first quantity
    expect(text).toContain("2"); // the second quantity
    expect(text).toContain("3"); // the merged total
    // And how to keep two genuinely separate rungs distinct next time.
    expect(text).toContain("tick");
  });

  it("puts the SUMMED claim in front of `O1`, so an over-committed batch is caught", async () => {
    // The balance covers ONE of the two colliding rows and not both. Deduping by id
    // instead of summing would hide the second row from the guard entirely.
    const { csvPath, io, ordersPath } = await harness({
      csv: COLLIDING_LADDER,
      reserves: [{ id: "reserve-a", amount: 1500 }],
    });
    const outcome = await importBitgetOpenOrders({ csvPath, io });

    expect(outcome).not.toMatchObject({ status: "imported" });
    expect(outcome).toMatchObject({ status: "rejected", reason: "over-committed" });
    expect(await readOrDefault(ordersPath, "<<absent>>")).toBe("<<absent>>");
  });

  it("REFUSES an amended row — same id, different quantity — instead of calling it known", async () => {
    const first = await harness({ reserves: [{ id: "reserve-a", amount: 5000 }] });
    await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });
    const before = await readFile(first.ordersPath, "utf8");

    // The SAME rung by every id component, re-exported with a different size. There is
    // no verb for "this claim changed" yet, and a second placement line is ignored by
    // the selector by construction — so it is refused, loudly, and nothing is written.
    const amended = ladder(
      rung("1000", "0.5", "2020-01-01 10:00:00"),
      rung("900", "0.1", "2020-01-01 10:00:01"),
    );
    await writeFile(first.csvPath, amended, "utf8");
    const outcome = await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    expect(outcome).toMatchObject({ status: "rejected", reason: "changed-claim" });
    // NEVER counted as already known: it is a change, not a re-sighting.
    expect(outcome).not.toMatchObject({ status: "imported" });
    expect(first.errors.join("\n")).toContain("REFUSED");
    expect(await readFile(first.ordersPath, "utf8")).toBe(before);
  });

  it("REFUSES a rung whose observed partial moved, rather than silently keeping the old one", async () => {
    const partial = ladder(partlyFilledRung("100", "10", "6", "2020-01-01 10:00:00"));
    const first = await harness({ csv: partial });
    await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });
    const before = await readFile(first.ordersPath, "utf8");

    const filledMore = ladder(partlyFilledRung("100", "10", "8", "2020-01-01 10:00:00"));
    await writeFile(first.csvPath, filledMore, "utf8");
    const outcome = await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    expect(outcome).toMatchObject({ status: "rejected", reason: "changed-claim" });
    expect(await readFile(first.ordersPath, "utf8")).toBe(before);
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
      reserves: [{ id: "reserve-a", amount: 10 }],
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
    const first = await harness({ reserves: [{ id: "reserve-a", amount: 250 }] });
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
      reserves: [
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

/**
 * `D2`/`D3` (#177 item 4) — a partial export STILL imports, and says so as a gap.
 *
 * The two partial-read policies stay ASYMMETRIC on purpose. Appending over a partially
 * read SIDECAR asserts something false: `known` is built only from readable lines, so a
 * row whose sidecar line was unreadable looks FRESH and appends a second time, and
 * `detectChangedClaims` goes blind over that region. Skipping an unparseable EXPORT row
 * asserts nothing — it omits, it cannot duplicate, it is reported with a line and a
 * reason, and the next export carries the same rung again. What it must NOT do is read as
 * an unqualified success on any of the three surfaces: the status, the operator's line, or
 * the exit code.
 */
describe("a partial export imports, and every surface says it was partial", () => {
  /** One readable rung and one whose price no build can read — a real, reported skip. */
  const PARTLY_READABLE_LADDER = ladder(
    rung("1000", "0.1", "2020-01-01 10:00:00"),
    rung("not-a-price", "0.1", "2020-01-01 10:00:01"),
  );

  it("DISCRIMINATES in the status rather than hiding the gap in a second field", async () => {
    const { csvPath, io } = await harness({ csv: PARTLY_READABLE_LADDER });
    const outcome = await importBitgetOpenOrders({ csvPath, io });
    expect(outcome).toMatchObject({ status: "imported-partial", appended: 1, alreadyKnown: 0 });
    if (outcome.status !== "imported-partial") throw new Error("expected a partial import");
    expect(outcome.skips).toHaveLength(1);
  });

  it("LEADS the operator's line with the unread rows and names the money DIRECTION", async () => {
    const { csvPath, io, outputs } = await harness({ csv: PARTLY_READABLE_LADDER });
    await importBitgetOpenOrders({ csvPath, io });

    const line = outputs.find((message) => message.includes("could not be read"));
    expect(line).toBeDefined();
    // The gap OPENS the line — not a suffix after two success numbers.
    expect(line?.startsWith("INCOMPLETE")).toBe(true);
    expect(line).toContain("1 row(s)");
    expect(line).toContain("available reads HIGH");
    // The counts still follow, after the qualifier rather than before it.
    expect(line).toContain("1 order(s) appended");
  });

  it("still WRITES the readable rungs — the skip omits, it does not refuse", async () => {
    const { csvPath, io, ordersPath } = await harness({ csv: PARTLY_READABLE_LADDER });
    await importBitgetOpenOrders({ csvPath, io });
    expect(await idsOnDisk(ordersPath)).toHaveLength(1);
  });

  it("keeps a CLEAN export on the unqualified status", async () => {
    const { csvPath, io } = await harness();
    const outcome = await importBitgetOpenOrders({ csvPath, io });
    expect(outcome).toMatchObject({ status: "imported", appended: 2, alreadyKnown: 0 });
  });
});

/**
 * #177 item 5 — a failed sidecar write returns through the refusal contract.
 *
 * `appendOrders` is atomic (temp + rename), so a rejection means nothing landed; the
 * operator is owed the flow's own `REFUSED — ... Nothing was written` line rather than a
 * bare stack from the CLI's outer catch. The precedent is `record-fill.ts`, which has
 * carried a `write-failed` member for exactly this case all along.
 */
describe("a failed sidecar write is a refusal, not a thrown error", () => {
  it("returns write-failed instead of throwing out of the flow", async () => {
    const { csvPath, io, errors } = await harness();
    io.appendOrders = async () => {
      throw new Error("synthetic sidecar write failure");
    };

    const outcome = await importBitgetOpenOrders({ csvPath, io });

    expect(outcome).toMatchObject({ status: "rejected", reason: "write-failed" });
    if (outcome.status !== "rejected") throw new Error("expected a rejection");
    expect(outcome.message).toContain("synthetic sidecar write failure");
    expect(errors.some((message) => message.startsWith("REFUSED —"))).toBe(true);
  });
});
