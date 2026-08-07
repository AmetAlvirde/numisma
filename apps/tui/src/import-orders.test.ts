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
  buildOrderFillObserved,
  parseBitgetOpenOrdersCsv,
  parseFundReview,
  pickRestingOrdersAsOf,
  type FundReviewData,
  type OrderRecord,
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

/**
 * One synthetic rung the venue shows as FULLY filled — nothing still claimed, so the
 * parser reports it as `not-resting` rather than admitting it (#173). This is the
 * ordinary case of a rung filling between the export and the import (#184).
 */
function filledRung(price: string, quantity: string, at: string): string {
  return partlyFilledRung(price, quantity, quantity, at);
}

function ladder(...rows: string[]): string {
  return [HEADER, ...rows, ""].join("\n");
}

/**
 * One resting rung written STRAIGHT to the sidecar, under a chosen id and funding
 * reserve — the only way to build a book whose rungs name DIFFERENT reserves, since the
 * import prompts for one declaration per batch. Synthetic throughout (`O7`).
 */
function seededRung(id: string, at: string, fundingReserveId: string): OrderRecord {
  return {
    id,
    observedAt: at.replace(" ", "T"),
    kind: "orderPlaced",
    currency: "USD",
    symbol: "XYZ/USDT",
    side: "buy",
    price: 100,
    quantity: 0.1,
    fundingReserveId,
  };
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
  reserves?: SyntheticReserve[];
}

/**
 * One reserve of the synthetic fund. LIVE and USD unless the case is specifically about a
 * reserve the fold will REFUSE to admit — `executionMode: "paper"`, an unsupported
 * `currency`, or a `currency` the rungs are not quoted in.
 */
interface SyntheticReserve {
  id: string;
  amount: number;
  executionMode?: string;
  currency?: string;
  accountId?: string;
}

/** A minimal folded fund carrying the given reserves. Round fakes only (`O7`). */
function syntheticFund(reserves: SyntheticReserve[]): FundReviewData {
  const parsed = parseFundReview({
    fund: { id: "synthetic-fund", name: "Synthetic Fund", baseCurrency: "USD" },
    review: { asOf: "2026-01-31", usdMxn: 20 },
    portfolios: [{ id: "core", name: "Core" }],
    accounts: [
      { id: "venue-usd", name: "Synthetic Venue", platform: "BITGET", currency: "USD" },
      { id: "venue-mxn", name: "Other Venue", platform: "XTB", currency: "MXN" },
    ],
    instruments: [{ id: "test-usd", name: "Test Asset", symbol: "XYZ", currency: "USD" }],
    reserves: reserves.map((reserve) => ({
      id: reserve.id,
      portfolioId: "core",
      tempo: "Capital",
      executionMode: reserve.executionMode ?? "live",
      accountId: reserve.accountId ?? "venue-usd",
      currency: reserve.currency ?? "USD",
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

});

/**
 * #199 — a rung the venue filled FURTHER costs ITS OWN rung, not the whole batch.
 *
 * The id is synthesized from the submission stamp, so a rung that fills between two
 * exports returns under the same id with a larger `filled_quantity`. Refusing the batch
 * over it blocked every unrelated new rung in every later export from that venue,
 * indefinitely, with no local remedy: nothing is written on a refusal, so recording the
 * fill repaired `committed`/`available` and left the placement line — and therefore the
 * refusal — exactly where it was. The only exits were at the venue.
 *
 * The split is safe for THIS FIELD AND NO OTHER, and the direction is the whole argument.
 * A stale partial makes the file believe more is still resting than is, so the guard
 * reads the encumbrance HIGH — it can refuse a fundable batch and can never admit an
 * unfundable one. A stale `quantity` points the other way and stays a total refusal.
 */
describe("a restated partial is skipped per rung (#199)", () => {
  /** The rung of the traced case: 10 units at 100, the venue showing 6 already filled. */
  const PARTLY_FILLED = partlyFilledRung("100", "10", "6", "2020-01-01 10:00:00");

  it("SKIPS the restated rung and imports every other rung in the export", async () => {
    const first = await harness({
      csv: ladder(PARTLY_FILLED),
      reserves: [{ id: "reserve-a", amount: 5000 }],
    });
    await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    // The same rung filled further at the venue, PLUS an unrelated new rung — which is
    // the whole point: that new rung used to be blocked with no local way to clear it.
    await writeFile(
      first.csvPath,
      ladder(
        partlyFilledRung("100", "10", "8", "2020-01-01 10:00:00"),
        rung("90", "1", "2020-01-01 11:00:00"),
      ),
      "utf8",
    );
    const outcome = await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    expect(outcome).not.toMatchObject({ status: "rejected" });
    // The new rung landed. The restated one is NOT `alreadyKnown` — it is not a
    // re-sighting, and calling it one is the silence #174 named.
    expect(outcome).toMatchObject({ appended: 1, alreadyKnown: 0 });
    expect(await idsOnDisk(first.ordersPath)).toHaveLength(2);
  });

  it("QUALIFIES the status rather than reporting an unqualified success", async () => {
    const first = await harness({
      csv: ladder(PARTLY_FILLED),
      reserves: [{ id: "reserve-a", amount: 5000 }],
    });
    await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    await writeFile(
      first.csvPath,
      ladder(
        partlyFilledRung("100", "10", "8", "2020-01-01 10:00:00"),
        rung("90", "1", "2020-01-01 11:00:00"),
      ),
      "utf8",
    );
    const outcome = await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    // `imported` now means every row read AND nothing restated — a strengthened
    // invariant, so the status keeps meaning what a reader who opens no second field
    // assumes it means.
    expect(outcome).not.toMatchObject({ status: "imported" });
    expect(outcome).toMatchObject({ status: "imported-partial", appended: 1 });
    if (outcome.status !== "imported-partial") throw new Error("expected a partial import");
    expect(outcome.restated).toEqual([
      // Both remainders ride along, and here they are the strictly-over case: the file
      // still claims the 4 its placement line implies, the venue holds 2.
      {
        id: expect.stringContaining(":100:"),
        known: 6,
        observed: 8,
        remainingOnFile: 4,
        remainingAtVenue: 2,
      },
    ]);
    // NOT absorbed into `skips`: `leavesRungUnweighed` is a predicate over PARSER
    // problems, and this rung was read perfectly — it is weighed, and weighed HIGH.
    expect(outcome.skips).toHaveLength(0);
  });

  it("LEADS its own line with the restatement and names the OPPOSITE money direction", async () => {
    const first = await harness({
      csv: ladder(PARTLY_FILLED),
      reserves: [{ id: "reserve-a", amount: 5000 }],
    });
    await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    await writeFile(
      first.csvPath,
      ladder(
        partlyFilledRung("100", "10", "8", "2020-01-01 10:00:00"),
        rung("90", "1", "2020-01-01 11:00:00"),
      ),
      "utf8",
    );
    await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    const line = first.outputs.find((message) => message.includes("RESTATED"));
    expect(line).toBeDefined();
    // The qualification OPENS the line, and the counts follow it.
    expect(line?.startsWith("RESTATED")).toBe(true);
    expect(line).toContain("1 order(s) appended");
    // Its own direction, which is the REVERSE of an unread row's. Stated as a FLOOR
    // rather than an inequality: the skip class now admits the EXACT case (the file's
    // own fill lines having caught the venue up), where `committed` is neither high nor
    // low, so the only claim true of every entry is that it is never understated.
    expect(line).toContain("committed never reads LOW and available never reads HIGH");
    expect(line).not.toContain("available reads HIGH");
    // Both figures, and the honest consequence: this recurs until the venue resolves it.
    expect(line).toContain("filled 6 → 8");
    expect(line).toContain("REPRINTS");
  });

  it("reports BOTH lines when one export is qualified both ways at once", async () => {
    // The case that killed the third-status option: a sum type can say only ONE of
    // these, so one qualification would drop silently. Two fields say both.
    const first = await harness({
      csv: ladder(PARTLY_FILLED),
      reserves: [{ id: "reserve-a", amount: 5000 }],
    });
    await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    await writeFile(
      first.csvPath,
      ladder(
        partlyFilledRung("100", "10", "8", "2020-01-01 10:00:00"),
        rung("90", "1", "2020-01-01 11:00:00"),
        rung("not-a-price", "0.1", "2020-01-01 12:00:00"),
      ),
      "utf8",
    );
    const outcome = await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    expect(outcome).toMatchObject({ status: "imported-partial", appended: 1 });
    if (outcome.status !== "imported-partial") throw new Error("expected a partial import");
    expect(outcome.skips).toHaveLength(1);
    expect(outcome.restated).toHaveLength(1);

    const message = first.outputs.find((line) => line.includes("could not be read"));
    expect(message).toBeDefined();
    // BOTH qualifications, each on its own line, each naming its own direction — and the
    // unread row leads, being the one we can say least about.
    expect(message?.startsWith("INCOMPLETE")).toBe(true);
    expect(message).toContain("\nRESTATED");
    expect(message).toContain("available reads HIGH");
    expect(message).toContain("committed never reads LOW and available never reads HIGH");
    // The counts follow both, once.
    expect(message).toContain("1 order(s) appended");
  });

  it("keeps `restated` EMPTY on the unqualified status", async () => {
    const { csvPath, io } = await harness();
    const outcome = await importBitgetOpenOrders({ csvPath, io });
    expect(outcome).toMatchObject({ status: "imported", appended: 2 });
    if (outcome.status !== "imported") throw new Error("expected a clean import");
    expect(outcome.restated).toEqual([]);
  });

  it("leaves the restated rung's line on file at the OLDER, more conservative partial", async () => {
    const first = await harness({
      csv: ladder(PARTLY_FILLED),
      reserves: [{ id: "reserve-a", amount: 5000 }],
    });
    await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    await writeFile(
      first.csvPath,
      ladder(partlyFilledRung("100", "10", "8", "2020-01-01 10:00:00")),
      "utf8",
    );
    await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    // `orders.jsonl` is append-only and a second placement line is ignored by the
    // selector, so the skip cannot repair the figure — and must not pretend to. The rung
    // still claims 4 (10 less the partial of 6 on file), NOT the 2 the venue now shows.
    const remaining = await remainingOnDisk(first.ordersPath);
    expect(remaining).toEqual([4]);
    expect(remaining).not.toContain(2);
    // No second placement line was appended for it, and no fill was synthesized.
    const load = await loadOrders(first.ordersPath, { warn: () => {} });
    if (load.status !== "loaded") throw new Error("expected a loaded sidecar");
    expect(load.records).toHaveLength(1);
  });

  it("reports the qualification without prompting when EVERY rung is restated", async () => {
    // The empty-batch path (#200 review). A one-rung export that filled further leaves
    // NOTHING admitted, and the flow used to carry straight on: two prompts for the
    // funding reserve of a batch of zero orders, a coverage guard over a book this
    // import does not change, an append of nothing.
    const first = await harness({
      csv: ladder(PARTLY_FILLED),
      reserves: [{ id: "reserve-a", amount: 5000 }],
    });
    await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });
    const before = await readFile(first.ordersPath, "utf8");
    const askedByTheFirstImport = first.asked.length;

    await writeFile(
      first.csvPath,
      ladder(partlyFilledRung("100", "10", "8", "2020-01-01 10:00:00")),
      "utf8",
    );
    const outcome = await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    // Still a qualified success, and still NOT the unqualified one: `restated` is
    // non-empty by construction on this path, since an export with no readable rows at
    // all was already refused as `no-orders` further up.
    expect(outcome).not.toMatchObject({ status: "imported" });
    expect(outcome).toMatchObject({ status: "imported-partial", appended: 0, alreadyKnown: 0 });
    if (outcome.status !== "imported-partial") throw new Error("expected a partial import");
    expect(outcome.restated).toHaveLength(1);
    expect(await readFile(first.ordersPath, "utf8")).toBe(before);
    // The operator still gets the whole qualification — the short-circuit skips the
    // prompt and the guard, never the reporting.
    const line = first.outputs.find((message) => message.includes("RESTATED"));
    expect(line).toBeDefined();
    expect(line).toContain("0 order(s) appended");

    // NOTHING WAS ASKED, and that is what makes the blank-answer refusal unreachable.
    // "Funding reserve for this batch:" over a batch of zero orders has no honest
    // answer, and the honest reply — a blank line — used to return
    // `rejected`/`no-reserve-declared`: a refusal reported over an import that had
    // nothing to refuse and nothing to fund.
    expect(first.asked.length).toBe(askedByTheFirstImport);
  });

  it("REFUSES the batch when the same claim also changed its quantity", async () => {
    const first = await harness({
      csv: ladder(PARTLY_FILLED),
      reserves: [{ id: "reserve-a", amount: 5000 }],
    });
    await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });
    const before = await readFile(first.ordersPath, "utf8");

    // Both fields at once. `quantity` is not in the synthesized id, so this is the SAME
    // claim — and carrying the safe difference does not make the dangerous one safe.
    await writeFile(
      first.csvPath,
      ladder(partlyFilledRung("100", "12", "8", "2020-01-01 10:00:00")),
      "utf8",
    );
    const outcome = await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    expect(outcome).toMatchObject({ status: "rejected", reason: "changed-claim" });
    expect(await readFile(first.ordersPath, "utf8")).toBe(before);
  });

  it("REFUSES a partial that moved DOWN — its OWN refusal since #181", async () => {
    const first = await harness({ csv: ladder(PARTLY_FILLED) });
    await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });
    const before = await readFile(first.ordersPath, "utf8");

    // A fill does not un-fill, so this is a contradiction rather than the ordinary life
    // of a rung — and since #181 it is refused under its OWN token, because the remedy
    // `changed-claim` prints is wrong for it. See the split's own describe below.
    await writeFile(
      first.csvPath,
      ladder(partlyFilledRung("100", "10", "4", "2020-01-01 10:00:00")),
      "utf8",
    );
    const outcome = await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    expect(outcome).toMatchObject({ status: "rejected", reason: "backwards-claim" });
    expect(await readFile(first.ordersPath, "utf8")).toBe(before);

    // THE MESSAGE, not just the reason. `quantity` is IDENTICAL here (10 both times),
    // so a headline promising "a different SIZE" describes a disagreement this refusal
    // does not have — and asserting only the status is exactly how that false wording
    // survived a release. The operator is owed the disagreement that actually refused.
    if (outcome.status !== "rejected") throw new Error("expected a refusal");
    expect(outcome.message).not.toContain("different SIZE");
    expect(outcome.message).toContain("filled 6 → 4");
  });

  it("REFUSES a restatement the file's OWN fill lines have already overtaken", async () => {
    // THE PROBE for the inverted guard. The partition used to read only the placement
    // lines, so it concluded "the file over-states, therefore skipping is safe" without
    // ever asking what the funding guard actually weighs — which is
    // `pickRestingOrdersAsOf`, fill lines and all.
    //
    // The money argument, in figures: the file records placed 10 / filled 6, the
    // operator then runs the fill flow and records the remaining 4, retiring the rung.
    // The file now counts ZERO resting. The venue's next export shows filled 8 — 2 units
    // STILL RESTING and funded by a reserve the book believes is free. Skipping this
    // rung would make `available` read HIGH, the direction that costs money, which is
    // precisely #174's hazard wearing #199's clothes.
    const first = await harness({
      csv: ladder(PARTLY_FILLED),
      reserves: [{ id: "reserve-a", amount: 5000 }],
    });
    await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    // The id is DERIVED from what landed, never hand-written: it is synthesized from
    // `(pair, side, price, submittedAt)` and spelling it out here would pin a test to a
    // format the ingest owns.
    const [restedId] = await idsOnDisk(first.ordersPath);
    if (restedId === undefined) throw new Error("expected the rung on disk");
    await appendOrders(first.ordersPath, [
      {
        id: restedId,
        observedAt: "2020-01-01T12:00:00",
        kind: "orderFilled",
        currency: "USD",
        filledQuantity: 4,
      },
    ]);
    expect(await remainingOnDisk(first.ordersPath)).toEqual([]);
    const before = await readFile(first.ordersPath, "utf8");

    await writeFile(
      first.csvPath,
      ladder(partlyFilledRung("100", "10", "8", "2020-01-01 10:00:00")),
      "utf8",
    );
    const outcome = await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    expect(outcome).toMatchObject({ status: "rejected", reason: "changed-claim" });
    expect(await readFile(first.ordersPath, "utf8")).toBe(before);
    // And the refusal NAMES the remainder gap, because that — not the partial figures —
    // is what decided it.
    if (outcome.status !== "rejected") throw new Error("expected a refusal");
    expect(outcome.message).toContain("the file would claim 0 where the venue still holds 2");
  });

  it("SKIPS the restatement when the recorded fill left the file EXACTLY level", async () => {
    // The other side of the same reading. Here the operator recorded the fill the venue
    // actually took — 2 units — so the file claims 2 and the venue holds 2. Nothing is
    // over-stated and nothing is under-stated, and the skip is still safe because the
    // test the class is defined by is `fileRemaining >= venueRemaining`, not `>`.
    const first = await harness({
      csv: ladder(PARTLY_FILLED),
      reserves: [{ id: "reserve-a", amount: 5000 }],
    });
    await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    const [restedId] = await idsOnDisk(first.ordersPath);
    if (restedId === undefined) throw new Error("expected the rung on disk");
    await appendOrders(first.ordersPath, [
      {
        id: restedId,
        observedAt: "2020-01-01T12:00:00",
        kind: "orderFilled",
        currency: "USD",
        filledQuantity: 2,
      },
    ]);
    expect(await remainingOnDisk(first.ordersPath)).toEqual([2]);

    await writeFile(
      first.csvPath,
      ladder(partlyFilledRung("100", "10", "8", "2020-01-01 10:00:00")),
      "utf8",
    );
    const outcome = await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    expect(outcome).toMatchObject({ status: "imported-partial" });
    if (outcome.status !== "imported-partial") throw new Error("expected a partial import");
    expect(outcome.restated).toEqual([
      { id: restedId, known: 6, observed: 8, remainingOnFile: 2, remainingAtVenue: 2 },
    ]);

    // The wording has to survive this case, which is the whole reason it changed: an
    // EXACT rung is not over-stated, so a line claiming `committed` reads HIGH and
    // `available` reads LOW would be flatly false about it — and that line reprints on
    // every import by design, so a falsehood there is a falsehood the operator reads
    // forever.
    const line = first.outputs.find((message) => message.includes("RESTATED"));
    expect(line).toBeDefined();
    expect(line).not.toContain("committed reads HIGH");
    expect(line).not.toContain("available reads LOW");
    expect(line).toContain("committed never reads LOW and available never reads HIGH");
    expect(line).toContain("the file still claims 2, the venue holds 2");
  });
});

/**
 * #181 slice #208 — detection re-based on the LATEST OBSERVATION, and the refusal split.
 *
 * END TO END, THROUGH THE IMPORT, and that is the point of putting these here rather than
 * only at `detectChangedClaims`. The claim is not "the comparison returns an empty array";
 * it is that the import ADMITS the rung, WRITES NOTHING, and COUNTS IT AS ALREADY KNOWN —
 * three facts about three different layers, and idempotency is the conjunction of them.
 * The unit-level basis, tie-break and epsilon cases are in the engine's
 * `detection-basis.test.ts`.
 *
 * THE OBSERVATION LINES ARE HAND-APPENDED, deliberately. Slice #208 changes what is
 * DETECTED and what is REFUSED, not what is written — the import does not construct an
 * observation until slice #210 — so a test that waited for the writer would be testing
 * nothing until then. `appendOrders` over a line built by `buildOrderFillObserved` is the
 * same file the writer will produce, and the constructor is what makes that claim true
 * rather than hopeful.
 */
describe("detection is re-based on the latest observation (#181)", () => {
  const PARTLY_FILLED = partlyFilledRung("100", "10", "6", "2020-01-01 10:00:00");

  /** The observation line for the rung on disk, built through the total constructor. */
  async function recordObservation(
    ordersPath: string,
    id: string,
    observedAt: string,
    observedFilledQuantity: number,
  ): Promise<void> {
    const built = buildOrderFillObserved({
      id,
      observedAt,
      currency: "USD",
      observedFilledQuantity,
    });
    if (built.status !== "ok") throw new Error(`fixture must build: ${built.message}`);
    await appendOrders(ordersPath, [built.record]);
  }

  /** The file after one import of `PARTLY_FILLED` plus one recorded restatement to 8. */
  async function fileWithRecordedRestatement(): Promise<{
    harness: Harness;
    id: string;
    before: string;
  }> {
    const first = await harness({
      csv: ladder(PARTLY_FILLED),
      reserves: [{ id: "reserve-a", amount: 5000 }],
    });
    await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });
    const [id] = await idsOnDisk(first.ordersPath);
    if (id === undefined) throw new Error("expected the rung on disk");
    await recordObservation(first.ordersPath, id, "2020-01-02T09:00:00", 8);
    return { harness: first, id, before: await readFile(first.ordersPath, "utf8") };
  }

  it("re-imports an export whose restatement is ALREADY RECORDED with no difference", async () => {
    // THE CASE THE PLACEMENT-LINE BASIS GOT WRONG FOREVER. Against the placement line's 6
    // this export reads as a fresh restatement on every import for the life of the rung —
    // the rung is skipped, the RESTATED line reprints, and the operator is told about work
    // that was done days ago. Against the latest observation it reads as nothing new.
    const { harness: first, before } = await fileWithRecordedRestatement();
    await writeFile(
      first.csvPath,
      ladder(partlyFilledRung("100", "10", "8", "2020-01-01 10:00:00")),
      "utf8",
    );

    const outcome = await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    // ADMITTED, not skipped: the unqualified status, and an EMPTY `restated`.
    expect(outcome).toMatchObject({
      status: "imported",
      appended: 0,
      alreadyKnown: 1,
      restated: [],
    });
    // WROTE NOTHING — byte-identical, not merely "no new orders".
    expect(await readFile(first.ordersPath, "utf8")).toBe(before);
    // And the operator is told nothing about a restatement, because there was not one.
    expect(first.outputs.join("\n")).not.toContain("RESTATED");
  });

  it("still SKIPS when the venue has moved PAST the recorded restatement", async () => {
    // The re-base must not blind the detector: 9 against a recorded 8 is a NEW
    // restatement and gets #199's per-rung skip, on the new basis rather than the old.
    const { harness: first, before } = await fileWithRecordedRestatement();
    await writeFile(
      first.csvPath,
      ladder(partlyFilledRung("100", "10", "9", "2020-01-01 10:00:00")),
      "utf8",
    );

    const outcome = await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    expect(outcome).toMatchObject({ status: "imported-partial" });
    if (outcome.status !== "imported-partial") throw new Error("expected a partial import");
    // `known` is the LATEST OBSERVATION — 8, not the placement line's 6.
    expect(outcome.restated).toMatchObject([{ known: 8, observed: 9 }]);
    expect(await readFile(first.ordersPath, "utf8")).toBe(before);
  });

  it("REFUSES an export BELOW the latest observation, and names the export not the rung", async () => {
    // THE DISCRIMINATING CASE for the whole split. 7 is ABOVE the placement line's 6 and
    // BELOW the recorded 8, so the old basis read it as a restatement that moved UP and
    // refused it — correctly — with advice to CANCEL THE RUNG AT THE VENUE. That advice
    // destroys a live rung in response to someone selecting yesterday's CSV.
    const { harness: first, before } = await fileWithRecordedRestatement();
    await writeFile(
      first.csvPath,
      ladder(partlyFilledRung("100", "10", "7", "2020-01-01 10:00:00")),
      "utf8",
    );

    const outcome = await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    expect(outcome).toMatchObject({ status: "rejected", reason: "backwards-claim" });
    expect(await readFile(first.ordersPath, "utf8")).toBe(before);
    if (outcome.status !== "rejected") throw new Error("expected a refusal");

    // THE WORDING IS THE DELIVERABLE. It names a stale or mistaken export and the remedy
    // is to export again.
    expect(outcome.message).toContain("LESS filled");
    expect(outcome.message).toContain("filled 8 → 7");
    expect(outcome.message).toContain("Re-export");
    // AND IT MUST NOT SEND ANYONE TO THE VENUE. This is the assertion the slice exists
    // for: a refusal over a wrong CSV that tells the operator to cancel or re-place costs
    // a live rung, which is worse than the mistake it is reporting.
    expect(outcome.message).not.toContain("Cancel the rung");
    expect(outcome.message).not.toContain("re-place");
  });

  it("keeps TODAY'S refusal for a figure at or above the observation but below consumed", async () => {
    // The other side of the partition — `latest observation <= export < consumed`, the
    // fund having BOOKED past what the venue shows. Same file, same rung, one `orderFilled`
    // line: observation 8, booked 2 more, so `consumed` is 10 and the rung is retired. The
    // export's 9 is ABOVE the observation, so it is not backwards; it is #174's hazard,
    // and it keeps #174's wording and #174's exit.
    //
    // AT the observation — the interval's closed end — there is no DIFFERENCE for the
    // partition to classify at all, and that is unchanged by this slice rather than a hole
    // it opens: an export agreeing with what the file last observed has always been a
    // re-sighting, whatever the fund booked afterwards.
    const { harness: first, id, before: withObservation } = await fileWithRecordedRestatement();
    await appendOrders(first.ordersPath, [
      {
        id,
        observedAt: "2020-01-03T09:00:00",
        kind: "orderFilled",
        currency: "USD",
        filledQuantity: 2,
      },
    ]);
    expect(withObservation).not.toBe(await readFile(first.ordersPath, "utf8"));
    expect(await remainingOnDisk(first.ordersPath)).toEqual([]);
    const before = await readFile(first.ordersPath, "utf8");

    await writeFile(
      first.csvPath,
      ladder(partlyFilledRung("100", "10", "9", "2020-01-01 10:00:00")),
      "utf8",
    );
    const outcome = await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    expect(outcome).toMatchObject({ status: "rejected", reason: "changed-claim" });
    expect(await readFile(first.ordersPath, "utf8")).toBe(before);
    if (outcome.status !== "rejected") throw new Error("expected a refusal");
    // TODAY'S WORDING, UNCHANGED — including the remedy, which is the right one here.
    expect(outcome.message).toContain("the file would claim 0 where the venue still holds 1");
    expect(outcome.message).toContain("Cancel the rung at the venue");
  });

  it("REFUSES THE WHOLE BATCH on a `quantity` difference, whatever the partial does", async () => {
    // Unchanged by the split, and asserted against a file that carries an observation so
    // the re-base cannot quietly demote it: `quantity` 10 → 12 with the partial EQUAL to
    // the recorded observation, and the batch still goes as `changed-claim`.
    const { harness: first, before } = await fileWithRecordedRestatement();
    await writeFile(
      first.csvPath,
      ladder(partlyFilledRung("100", "12", "8", "2020-01-01 10:00:00")),
      "utf8",
    );
    const outcome = await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    expect(outcome).toMatchObject({ status: "rejected", reason: "changed-claim" });
    expect(await readFile(first.ordersPath, "utf8")).toBe(before);
    if (outcome.status !== "rejected") throw new Error("expected a refusal");
    expect(outcome.message).toContain("quantity 10 → 12");
  });

  it("writes NOTHING for a filled difference below the epsilon", async () => {
    // Float noise is not an observation. Under an exact comparison this reports a
    // difference, and once a difference means a permanent line on an append-only file
    // that is a file that grows on an import which observed nothing real.
    const first = await harness({
      csv: ladder(PARTLY_FILLED),
      reserves: [{ id: "reserve-a", amount: 5000 }],
    });
    await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });
    const before = await readFile(first.ordersPath, "utf8");

    await writeFile(
      first.csvPath,
      ladder(partlyFilledRung("100", "10", "6.0000000001", "2020-01-01 10:00:00")),
      "utf8",
    );
    const outcome = await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    expect(outcome).toMatchObject({
      status: "imported",
      appended: 0,
      alreadyKnown: 1,
      restated: [],
    });
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
    expect(outcome).toMatchObject({ status: "rejected", reason: "unattributed" });
    expect(await readOrDefault(ordersPath, "<<absent>>")).toBe("<<absent>>");
  });

  it("names EVERY reason the book cannot be placed, in ONE refusal", async () => {
    // THE MESSAGE IS THE DELIVERABLE (#179). A book wrong in BOTH attribution ways used
    // to report whichever class the guard filtered for first, so the operator fixed it,
    // re-ran the whole import — declaration prompt included — and was refused again for a
    // fault already computed on the first pass.
    //
    // The batch itself declares ONE reserve, so the mixed book is built the way the guard
    // actually sees one: rungs ALREADY ON FILE against two other unplaceable reserves,
    // plus this batch's two against a paper one. `reserve-odd` is unfundable for a second
    // reason (unsupported currency) so the section has two reserves to dedup to, and
    // `reserve-mxn` is live and admitted but holds a currency these USD rungs are not
    // quoted in — the other class entirely.
    const { csvPath, io, ordersPath, errors } = await harness({
      answers: ["reserve-paper", "n"],
      reserves: [
        { id: "reserve-paper", amount: 1000, executionMode: "paper" },
        { id: "reserve-odd", amount: 1000, currency: "EUR" },
        { id: "reserve-mxn", amount: 1000, currency: "MXN", accountId: "venue-mxn" },
      ],
    });
    await appendOrders(ordersPath, [
      seededRung("rung-odd", "2020-01-01 09:00:00", "reserve-odd"),
      seededRung("rung-mxn", "2020-01-01 09:00:01", "reserve-mxn"),
    ]);

    const outcome = await importBitgetOpenOrders({ csvPath, io });
    expect(outcome).toMatchObject({ status: "rejected", reason: "unattributed" });

    const refusal = errors.join("\n");
    // BOTH sections, both labels, and the counts with the RIGHT plurals — `2 reserves`
    // and `3 rungs` against a bare `1 rung`, pinned here rather than left to the
    // renderer's luck.
    expect(refusal).toContain("REFUSED — 4 rungs cannot be placed against a fundable reserve.");
    expect(refusal).toContain("unfundable reserve — 2 reserves, 3 rungs");
    expect(refusal).toContain("currency mismatch — 1 rung");
    // Each class's advice, distinct and never concatenated.
    expect(refusal).toContain("The fold excluded these reserves");
    expect(refusal).toContain("Cross-currency funding is not supported");
    // Every unplaceable rung is NAMED — the unfundable ones grouped under their reserve
    // (one declaration fix clears all of them), the mismatched one per rung.
    expect(refusal).toContain("      reserve-odd\n        rung-odd");
    expect(refusal).toContain("\n      reserve-paper\n");
    // Marker-agnostic here — the id sits on its own line and the mismatch is indented
    // beneath it; the marked form is pinned exactly below.
    expect(refusal).toMatch(
      /\n {6}rung-mxn.*\n {8}quoted in USD, declared against reserve-mxn\n/,
    );
    // PROVENANCE (#202 review). The count is the whole book's, so the two rungs that were
    // already in the sidecar are MARKED and the legend says what the mark means — without
    // it, the operator reconciles "4 rungs" against an export holding two of them and
    // cannot make it come out even.
    expect(refusal).toContain('rungs marked "on file"');
    expect(refusal).toContain("        rung-odd — on file");
    expect(refusal).toContain(
      "      rung-mxn — on file\n        quoted in USD, declared against reserve-mxn",
    );
    // This batch's own rungs carry NO marker: they are in the export just read.
    const exported = parseBitgetOpenOrdersCsv(await readFile(csvPath, "utf8"));
    expect(exported.status).toBe("ok");
    if (exported.status !== "ok") return;
    const batchRungIds = exported.orders.map((order) => order.id);
    expect(batchRungIds).toHaveLength(2);
    for (const id of batchRungIds) {
      expect(refusal).toContain(`        ${id}\n`);
      expect(refusal).not.toContain(`${id} — on file`);
    }
    // NOTHING written: the file still carries exactly the two rungs seeded above.
    expect(await idsOnDisk(ordersPath)).toEqual(["rung-odd", "rung-mxn"]);
    // The honest cost of batching, and not droppable: `over-committed` never ran, so the
    // operator has NOT been told everything, and one sentence says so.
    expect(refusal).toContain(
      "Reserve balances were NOT weighed: an unplaceable rung has no balance to\n" +
        "compare against, so a coverage refusal may still follow once every rung\n" +
        "above is placeable.",
    );
    // A blank line before `reject()`'s tail, so it does not read as a continuation of the
    // balances sentence.
    expect(refusal).toContain(`placeable.\n\nNothing was written to ${ordersPath}.`);
  });

  it("renders ONE section when only one class is present", async () => {
    // Each section is absent when its class is: the homogeneous case does not pay for the
    // batching, and the singular counts are exercised here rather than the plural ones.
    const { csvPath, io, errors } = await harness({
      csv: ladder(rung("1000", "0.1", "2020-01-01 10:00:00")),
      answers: ["reserve-paper", "n"],
      reserves: [{ id: "reserve-paper", amount: 1000, executionMode: "paper" }],
    });
    await importBitgetOpenOrders({ csvPath, io });

    const refusal = errors.join("\n");
    expect(refusal).toContain("REFUSED — 1 rung cannot be placed against a fundable reserve.");
    expect(refusal).toContain("unfundable reserve — 1 reserve, 1 rung");
    expect(refusal).toContain("The fold excluded this reserve");
    expect(refusal).not.toContain("currency mismatch");
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
 * #184 — a `not-resting` skip is a WEIGHED rung, not an unread one.
 *
 * `parsed.skips` is heterogeneous: three of the four `BitgetRowProblem` members mean the
 * row might still be claiming capital and we cannot say how much, while `not-resting`
 * means the parser reached a POSITIVE finding — the encumbrance is zero. Summing all four
 * into the INCOMPLETE line fires a money-direction alarm on the ordinary event of a rung
 * filling between the export and the import, which is how that alarm becomes noise.
 */
describe("a rung that filled before the import is not a gap in the read", () => {
  it("keeps the CLEAN status and line when the only skip is not-resting", async () => {
    const csv = ladder(
      rung("1000", "0.1", "2020-01-01 10:00:00"),
      rung("900", "0.1", "2020-01-01 10:00:01"),
      filledRung("1100", "0.1", "2020-01-01 10:00:02"),
    );
    const { csvPath, io, outputs, errors } = await harness({ csv });
    const outcome = await importBitgetOpenOrders({ csvPath, io });

    expect(outcome).toMatchObject({ status: "imported", appended: 2, alreadyKnown: 0 });
    if (outcome.status !== "imported") throw new Error("expected a clean import");
    expect(outputs.some((message) => message.includes("INCOMPLETE"))).toBe(false);
    expect(
      outputs.some((message) => message.startsWith(`Imported ${csvPath}: 2 order(s) appended, 0 already known.`)),
    ).toBe(true);
    // The skip is still CARRIED and still REPORTED — only the discrimination changed.
    expect(outcome.skips).toHaveLength(1);
    expect(errors.some((message) => message.includes("not a resting order"))).toBe(true);
  });

  it("counts only the UNWEIGHED skips in the INCOMPLETE line of a mixed export", async () => {
    const csv = ladder(
      rung("1000", "0.1", "2020-01-01 10:00:00"),
      rung("900", "0.1", "2020-01-01 10:00:01"),
      rung("not-a-price", "0.1", "2020-01-01 10:00:02"),
      filledRung("1100", "0.1", "2020-01-01 10:00:03"),
    );
    const { csvPath, io, outputs, errors } = await harness({ csv });
    const outcome = await importBitgetOpenOrders({ csvPath, io });

    expect(outcome).toMatchObject({ status: "imported-partial", appended: 2, alreadyKnown: 0 });
    if (outcome.status !== "imported-partial") throw new Error("expected a partial import");
    const line = outputs.find((message) => message.includes("could not be read"));
    expect(line).toBeDefined();
    // ONE row could not be read — the malformed price. The filled rung was read fully.
    expect(line).toContain("1 row(s)");
    expect(line).not.toContain("2 row(s)");
    // Both skips still ride the outcome and both are still on the error channel.
    expect(outcome.skips).toHaveLength(2);
    expect(errors.some((message) => message.includes("price must be a positive decimal"))).toBe(true);
    expect(errors.some((message) => message.includes("not a resting order"))).toBe(true);
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
