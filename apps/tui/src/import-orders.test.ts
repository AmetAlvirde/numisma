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
  mergeCollidingClaims,
  parseBitgetOpenOrdersCsv,
  parseFundReview,
  pickRestingOrdersAsOf,
  type FundReviewData,
  type OrderRecord,
} from "@numisma/engine";
import { afterEach, describe, expect, it } from "vitest";
import { describeMerge } from "./import-orders-merge-notice.js";
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
  /**
   * MOVE THE FROZEN CLOCK (#181) — the seam `OrdersImportIo.now` exists for, and until
   * this slice nothing in the suite had ever touched it.
   *
   * That is not a tidiness point. Every import in the suite shared one wall-clock instant
   * whose SECOND nobody controlled, so the suite ran permanently inside the precondition
   * of the same-second bug and could never distinguish "two observations, one stamp,
   * both kept" from "two observations, one stamp, one silently dropped". Holding the
   * stamp still is what makes that distinguishable.
   *
   * Takes the stamp shape the file itself uses, LOCAL and second-granular, so a test
   * reads the same string it will find on disk.
   */
  setClock: (stamp: string) => void;
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
  // FROZEN by default and movable by the test. A default of "now" would leave every
  // stamped line depending on the second the suite happened to run in.
  let clock = new Date("2026-06-01T09:00:00");

  return {
    csvPath,
    ordersPath,
    asked,
    errors,
    outputs,
    setClock: (stamp) => {
      clock = new Date(stamp);
    },
    io: {
      readExport: (path) => readFile(path, "utf8"),
      now: () => clock,
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

  it("REPORTS the merge to the operator on the NORMAL channel, not silently", async () => {
    // THE WIRING, AND ONLY THE WIRING (#221). What the notice SAYS — both quantities as
    // the `a + b` arithmetic, the total, the symbol, the side, the price, the stamp, the
    // row count and the remedy — is asserted exactly in
    // `import-orders-merge-notice.test.ts`, over a plain record and without this
    // apparatus. What only THIS test can hold is that the merge branch calls the
    // renderer at all and that its output reaches the operator: arithmetic applied on
    // the `out` channel, never whispered and never routed to `err` as if it were a
    // warning about something skipped.
    const { csvPath, io, outputs } = await harness({
      csv: COLLIDING_LADDER,
      reserves: [{ id: "reserve-a", amount: 5000 }],
    });
    await importBitgetOpenOrders({ csvPath, io });

    const notice = outputs.find((message) => message.includes("MERGED"));
    expect(notice).toBeDefined();
    // The one content check that stays here, and it is a wiring check: the message on
    // `out` is THIS renderer applied to THE ENGINE'S OWN merge for this batch, not some
    // other message that happens to carry the word. Derived rather than transcribed, so
    // it duplicates none of the notice's content rules.
    const parsed = parseBitgetOpenOrdersCsv(COLLIDING_LADDER);
    expect(parsed.status).toBe("ok");
    if (parsed.status !== "ok") return;
    const { merges } = mergeCollidingClaims(parsed.orders);
    expect(merges).toHaveLength(1);
    expect(notice).toContain(describeMerge(merges[0]!));
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
 * #199 → #181 — a rung the venue filled FURTHER is RECORDED, not skipped.
 *
 * The id is synthesized from the submission stamp, so a rung that fills between two
 * exports returns under the same id with a larger `filled_quantity`. #174 refused the
 * whole batch over it, which blocked every unrelated new rung in every later export from
 * that venue, indefinitely and with no local remedy. #199 narrowed that to a per-rung
 * SKIP, which unblocked the batch and left the file permanently stale. #181 writes the
 * figure down: an `orderFillObserved` line the selector folds as a new `consumed`
 * baseline, so the file's remainder becomes the venue's.
 *
 * THE COUNTING VOCABULARY SPLITS HERE, and it is why these assertions changed rather than
 * being ported. `appended` and `alreadyKnown` used to be derived by DIFFERENT rules from
 * the same list — one counting lines, the other contorted to count orders — so the moment
 * an import could write a second kind of line, a pure-observation import reported
 * `1 order(s) appended` about ZERO orders. `appended` now counts ORDERS and observations
 * are counted separately, so every assertion that pinned the old reading is restated
 * below with its reason beside it rather than quietly edited.
 */
describe("a restated partial is recorded as an observation (#181)", () => {
  /** The rung of the traced case: 10 units at 100, the venue showing 6 already filled. */
  const PARTLY_FILLED = partlyFilledRung("100", "10", "6", "2020-01-01 10:00:00");

  /** The file after one import of `PARTLY_FILLED`, with the rung's id in hand. */
  async function fileWithRestingRung(): Promise<{ first: Harness; restedId: string }> {
    const first = await harness({
      csv: ladder(PARTLY_FILLED),
      reserves: [{ id: "reserve-a", amount: 5000 }],
    });
    await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });
    const [restedId] = await idsOnDisk(first.ordersPath);
    if (restedId === undefined) throw new Error("expected the rung on disk");
    return { first, restedId };
  }

  it("RECORDS the restatement and imports every other rung in the export", async () => {
    const { first } = await fileWithRestingRung();

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
    // WAS `appended: 1, alreadyKnown: 0` AND STILL IS — but for a reason worth restating,
    // because the batch now writes TWO lines and the number did not move. `appended`
    // counts ORDERS: the new rung is one claim on capital, and the observation is none.
    // The restated rung is not `alreadyKnown` either — it is not a re-sighting.
    expect(outcome).toMatchObject({ appended: 1, alreadyKnown: 0 });
    if (outcome.status === "rejected") throw new Error("expected a successful import");
    expect(outcome.observations).toHaveLength(1);
    // THREE LINES on disk for TWO rungs: the observation shares its rung's id, which is
    // exactly why the append key carries `kind` as well.
    expect(await idsOnDisk(first.ordersPath)).toHaveLength(3);
    // And the file now claims what the venue holds: 2 on the restated rung, 1 on the new.
    expect(await remainingOnDisk(first.ordersPath)).toEqual([2, 1]);
  });

  it("does NOT qualify the status — the work is done, not deferred", async () => {
    const { first, restedId } = await fileWithRestingRung();

    await writeFile(
      first.csvPath,
      ladder(
        partlyFilledRung("100", "10", "8", "2020-01-01 10:00:00"),
        rung("90", "1", "2020-01-01 11:00:00"),
      ),
      "utf8",
    );
    const outcome = await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    // THE INVERSION OF #199's ASSERTION, and the reason is the whole slice. #199 asserted
    // `not imported` / `imported-partial`, because a restatement was a DEFERRAL: a rung
    // read perfectly and then not written down, which a status calling itself unqualified
    // would be hiding. The line is written now, so it defers nothing and the union widens
    // back. That is a gap closing, not precision lost.
    expect(outcome).toMatchObject({ status: "imported", appended: 1 });
    if (outcome.status !== "imported") throw new Error("expected an unqualified import");
    // NO REMAINDERS ON THE ENTRY. #199 carried both because they were the safety argument
    // for a SKIP; the line lands now, so the file's remainder IS the venue's and the pair
    // would print one number twice.
    expect(outcome.observations).toEqual([{ id: restedId, known: 6, observed: 8 }]);
    // NOT absorbed into `skips`: `leavesRungUnweighed` is a predicate over PARSER
    // problems, and this rung was read perfectly.
    expect(outcome.skips).toHaveLength(0);
  });

  it("LEADS its own line with what was OBSERVED and what was recorded", async () => {
    const { first } = await fileWithRestingRung();

    await writeFile(
      first.csvPath,
      ladder(
        partlyFilledRung("100", "10", "8", "2020-01-01 10:00:00"),
        rung("90", "1", "2020-01-01 11:00:00"),
      ),
      "utf8",
    );
    await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    const line = first.outputs.find((message) => message.includes("OBSERVED"));
    expect(line).toBeDefined();
    // The notice OPENS the line, and the counts follow it.
    expect(line?.startsWith("OBSERVED")).toBe(true);
    expect(line).toContain("filled 6 → 8");
    expect(line).toContain("RECORDED");
    // WAS `expect(line).toContain("REPRINTS")`. #199's line had to promise it would come
    // back on every import until the venue resolved the rung, because nothing was written
    // and the condition survived the import. It is written now, so the promise is false
    // and its absence is the assertion.
    expect(line).not.toContain("REPRINTS");
    // And it no longer describes a stale file, because the file is not stale.
    expect(line).not.toContain("committed never reads LOW");
    // WAS `1 order(s) appended` FOR A BATCH THAT WROTE ONE ORDER AND ONE OBSERVATION —
    // true here by luck rather than by rule, since one of each happens to make the old
    // line-count and the new order-count agree. Both figures are asserted now, so the
    // rule is pinned rather than the coincidence.
    expect(line).toContain("1 order(s) appended");
    expect(line).toContain("1 observation(s) recorded");
  });

  it("reports BOTH notices when one export carries an unread row too", async () => {
    // A row nobody could read is now the ONLY thing that qualifies an import, so this is
    // the case where a notice and a qualification appear together and must not merge.
    const { first } = await fileWithRestingRung();

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
    expect(outcome.observations).toHaveLength(1);

    const message = first.outputs.find((line) => line.includes("could not be read"));
    expect(message).toBeDefined();
    // The unread row leads, being the one thing here we can say least about.
    expect(message?.startsWith("INCOMPLETE")).toBe(true);
    expect(message).toContain("\nOBSERVED");
    expect(message).toContain("available reads HIGH");
    // WAS `1 order(s) appended` ALONE. Same rewrite as the line above, same reason: the
    // batch wrote one order and one observation, and the report must say both.
    expect(message).toContain("1 order(s) appended");
    expect(message).toContain("1 observation(s) recorded");
  });

  it("renders the observation clause AT ZERO on an import that observed nothing", async () => {
    const { csvPath, io, outputs } = await harness();
    const outcome = await importBitgetOpenOrders({ csvPath, io });
    expect(outcome).toMatchObject({ status: "imported", appended: 2 });
    if (outcome.status !== "imported") throw new Error("expected a clean import");
    expect(outcome.observations).toEqual([]);
    // ALWAYS, INCLUDING AT ZERO. A clause that appears only when it is non-zero is two
    // shapes for a reader to learn and one more place for the two exits to diverge — and
    // the zero is informative in its own right: this import created claims and observed
    // nothing.
    const line = outputs.find((message) => message.startsWith("Imported"));
    expect(line).toContain("0 observation(s) recorded");
  });

  it("leaves the PLACEMENT line at the older partial and corrects the remainder on a second line", async () => {
    // THE ASSERTION THAT HALF-SURVIVED #199, kept rather than deleted because its premise
    // is still true and its MEANING has inverted. The placement line genuinely does still
    // read the older partial — `orders.jsonl` is append-only and nothing rewrites it — and
    // under #199 that was the whole story: the file stayed stale, deliberately, on the
    // conservative side. It is now the FIRST of two observations, and the second one
    // carries the correction, so the same durable line proves the opposite thing: the
    // repair rides on a new line rather than on an edit.
    const { first } = await fileWithRestingRung();

    await writeFile(
      first.csvPath,
      ladder(partlyFilledRung("100", "10", "8", "2020-01-01 10:00:00")),
      "utf8",
    );
    await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    const load = await loadOrders(first.ordersPath, { warn: () => {} });
    if (load.status !== "loaded") throw new Error("expected a loaded sidecar");
    // TWO lines: the untouched placement and the observation that supersedes its figure.
    expect(load.records).toHaveLength(2);
    const placed = load.records.filter((record) => record.kind === "orderPlaced");
    expect(placed).toHaveLength(1);
    // STILL 6 — the older partial, exactly as #199 asserted, and for the same reason.
    expect(placed[0]).toMatchObject({ observedFilledQuantity: 6 });
    // WAS `expect(remaining).toEqual([4])` — the file claiming 4 while the venue held 2,
    // which was #199's conservative staleness and is the figure that has moved. The fold
    // takes the LATEST observation as the `consumed` baseline, so the remainder is now the
    // venue's own 2 and the 4 it used to read is what this slice removed.
    expect(await remainingOnDisk(first.ordersPath)).toEqual([2]);
    // And no fill was synthesized: an `orderFilled` line is half of a fill act and would
    // brick the fill flow. The second line is an observation.
    expect(load.records.some((record) => record.kind === "orderFilled")).toBe(false);
  });

  it("writes the observation WITHOUT prompting or guarding when EVERY rung is restated", async () => {
    // WAS `reports the qualification without prompting`, and the qualification is what
    // changed: this import writes N lines and reports an unqualified success. #199's
    // version asserted the file was byte-identical afterwards, which is now the one thing
    // it must not be.
    const { first } = await fileWithRestingRung();
    const before = await readFile(first.ordersPath, "utf8");
    const askedByTheFirstImport = first.asked.length;
    // A reserve that could not fund the book already on file. If the guard ran on this
    // path it would refuse `over-committed` — over a PRE-EXISTING condition this import
    // does not create and, no declaration having been prompted for, could not fix.
    first.io.fundReview = async () => syntheticFund([{ id: "reserve-a", amount: 1 }]);

    await writeFile(
      first.csvPath,
      ladder(partlyFilledRung("100", "10", "8", "2020-01-01 10:00:00")),
      "utf8",
    );
    const outcome = await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    // Not refused, and not qualified: the guard was skipped and the work was done.
    expect(outcome).toMatchObject({ status: "imported", appended: 0, alreadyKnown: 0 });
    if (outcome.status !== "imported") throw new Error("expected an unqualified import");
    expect(outcome.observations).toHaveLength(1);
    // THE FILE GREW. #199 asserted byte-equality here; the whole slice is that it no
    // longer holds.
    expect(await readFile(first.ordersPath, "utf8")).not.toBe(before);
    expect(await remainingOnDisk(first.ordersPath)).toEqual([2]);

    // ZERO ORDERS AND ONE OBSERVATION, in one line. This is the pair the old vocabulary
    // could not say: it reported `1 order(s) appended` about an import that created no
    // claim on capital at all.
    const line = first.outputs.find((message) => message.includes("OBSERVED"));
    expect(line).toBeDefined();
    expect(line).toContain("0 order(s) appended");
    expect(line).toContain("1 observation(s) recorded");

    // NOTHING WAS ASKED. "Funding reserve for this batch:" over a batch of zero orders has
    // no honest answer, and the honest reply — a blank line — used to come back as
    // `no-reserve-declared`: a refusal over an import with nothing to fund.
    expect(first.asked.length).toBe(askedByTheFirstImport);
  });

  it("writes the orders and the observations in ONE append call", async () => {
    const { first } = await fileWithRestingRung();
    let appendCalls = 0;
    const realAppend = first.io.appendOrders;
    first.io.appendOrders = async (path, records) => {
      appendCalls += 1;
      await realAppend(path, records);
    };

    await writeFile(
      first.csvPath,
      ladder(
        partlyFilledRung("100", "10", "8", "2020-01-01 10:00:00"),
        rung("90", "1", "2020-01-01 11:00:00"),
      ),
      "utf8",
    );
    await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    // ONE lock, one temp write, one rename. The selector sorts at READ time, so there is
    // no ordering reason to split the two kinds across two writes — and a split write is
    // a window in which the file holds an observation whose placement never landed.
    expect(appendCalls).toBe(1);
    expect(await idsOnDisk(first.ordersPath)).toHaveLength(3);
  });

  it("weighs the observation in the funding guard, so it cannot refuse over freed capital", async () => {
    const { first } = await fileWithRestingRung();
    // The book on file encumbers 400 — the rung's stale remainder of 4 at 100. The
    // restatement frees 200 of that, and the new rung wants 90, so the import needs 290.
    // A 300 reserve funds the import and does NOT fund the stale reading of it.
    first.io.fundReview = async () => syntheticFund([{ id: "reserve-a", amount: 300 }]);

    await writeFile(
      first.csvPath,
      ladder(
        partlyFilledRung("100", "10", "8", "2020-01-01 10:00:00"),
        rung("90", "1", "2020-01-01 11:00:00"),
      ),
      "utf8",
    );
    const outcome = await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    // Excluded from the guard's view, the restated rung would still weigh 400 and the
    // batch would be refused `over-committed` — over capital this very import is about to
    // free. Observations only ever REDUCE a remainder, so they belong in the reading.
    expect(outcome).toMatchObject({ status: "imported", appended: 1 });
  });

  it("marks a restated rung as ON FILE in an attribution refusal — the mark is placement ids only", async () => {
    const { first, restedId } = await fileWithRestingRung();
    // `reserve-a` stops being fundable, so BOTH rungs of the resting book are unmatched:
    // the one this export just declared, and the restated one already on file.
    first.io.fundReview = async () =>
      syntheticFund([{ id: "reserve-a", amount: 5000, executionMode: "paper" }]);

    await writeFile(
      first.csvPath,
      ladder(
        partlyFilledRung("100", "10", "8", "2020-01-01 10:00:00"),
        rung("90", "1", "2020-01-01 11:00:00"),
      ),
      "utf8",
    );
    const outcome = await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    expect(outcome).toMatchObject({ status: "rejected", reason: "unattributed" });
    if (outcome.status !== "rejected") throw new Error("expected a refusal");
    // THE MARK CARRIES PLACEMENT IDS ONLY. An observation shares its rung's id, so adding
    // the observations to the batch set would un-mark the restated rung and invite the
    // operator to fix it by re-declaring — but its `fundingReserveId` comes from its
    // original placement line and `declareFunding` never touches it, so that is a loop
    // that changes nothing.
    expect(outcome.message).toContain(`${restedId} — on file`);
  });

  it("REFUSES the batch when the same claim also changed its quantity", async () => {
    const { first } = await fileWithRestingRung();
    const before = await readFile(first.ordersPath, "utf8");

    // Both fields at once. `quantity` is not in the synthesized id, so this is the SAME
    // claim — and carrying the safe difference does not make the dangerous one safe. The
    // observation verb does not help: it carries no `quantity`, deliberately.
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
    // lines, so it concluded "the file over-states, therefore this is safe" without ever
    // asking what the funding guard actually weighs — which is `pickRestingOrdersAsOf`,
    // fill lines and all.
    //
    // The money argument, in figures: the file records placed 10 / filled 6, the
    // operator then runs the fill flow and records the remaining 4, retiring the rung.
    // The file now counts ZERO resting. The venue's next export shows filled 8 — 2 units
    // STILL RESTING and funded by a reserve the book believes is free. RECORDING an
    // observation here would not repair that: the fund has BOOKED units the venue does
    // not corroborate, so the two statements contradict rather than supersede.
    const { first, restedId } = await fileWithRestingRung();
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

  it("RECORDS the restatement when the recorded fill left the file EXACTLY level", async () => {
    // The other side of the same reading. Here the operator recorded the fill the venue
    // actually took — 2 units — so the file claims 2 and the venue holds 2. The class is
    // defined by `fileRemaining >= venueRemaining`, not `>`, and the observation lands.
    const { first, restedId } = await fileWithRestingRung();
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

    expect(outcome).toMatchObject({ status: "imported" });
    if (outcome.status !== "imported") throw new Error("expected an unqualified import");
    // WAS `{ id, known: 6, observed: 8, remainingOnFile: 2, remainingAtVenue: 2 }`, and
    // the remainders are gone from the entry rather than merely unasserted: they existed
    // to let an operator audit a SKIP, and this rung is not skipped.
    expect(outcome.observations).toEqual([{ id: restedId, known: 6, observed: 8 }]);
    // THE FOLD IS NOT MONOTONIC AND THIS IS THE CASE THAT SHOWS IT: the observation SETS
    // `consumed` to 8, and the 2 already booked against the rung do not add to it. The
    // remainder stays 2 — the venue's own figure — rather than dropping to 0.
    expect(await remainingOnDisk(first.ordersPath)).toEqual([2]);

    // The old wording promised a stale file and both remainders; neither is true now.
    const line = first.outputs.find((message) => message.includes("OBSERVED"));
    expect(line).toBeDefined();
    expect(line).not.toContain("the file still claims 2, the venue holds 2");
    expect(line).toContain("filled 6 → 8");
  });
});

/**
 * #181 slice #210 — the same-second case, and the append key it forced.
 *
 * ONE BATCH STAMP AT SECOND RESOLUTION plus `observedAt` in the append key means two
 * imports inside one second key IDENTICALLY, so the second import's observation is
 * filtered out as a repeat while the operator is told it was RECORDED and a successful
 * status comes back. Honesty and information loss rather than money loss — and ordinary
 * to reach: two exports back to back, or any scripted loop.
 *
 * THIS IS THE FIRST SECOND STAMP ANYWHERE IN THE SUITE, and that is the finding, not the
 * fixture. `OrdersImportIo.now` was introduced correctly and no test had ever overridden
 * it, so every import in the suite shared one uncontrolled wall-clock instant — the suite
 * ran permanently inside the precondition of this bug and could read green over it
 * forever. Freezing the clock is what makes the two cases distinguishable at all.
 */
describe("two imports inside ONE second (#181)", () => {
  const PARTLY_FILLED = partlyFilledRung("100", "10", "6", "2020-01-01 10:00:00");

  it("keeps BOTH observations when the figure MOVES inside one second", async () => {
    const first = await harness({
      csv: ladder(PARTLY_FILLED),
      reserves: [{ id: "reserve-a", amount: 5000 }],
    });
    // ONE INSTANT for all three imports. Nothing advances it, so every observation this
    // test writes carries a byte-identical stamp.
    first.setClock("2026-06-01T09:00:00");
    await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    await writeFile(
      first.csvPath,
      ladder(partlyFilledRung("100", "10", "8", "2020-01-01 10:00:00")),
      "utf8",
    );
    await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    await writeFile(
      first.csvPath,
      ladder(partlyFilledRung("100", "10", "9", "2020-01-01 10:00:00")),
      "utf8",
    );
    const second = await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    const load = await loadOrders(first.ordersPath, { warn: () => {} });
    if (load.status !== "loaded") throw new Error("expected a loaded sidecar");
    const observed = load.records.filter((record) => record.kind === "orderFillObserved");
    // BOTH LINES ON DISK, in the order they were written. 8 and 9 are different facts;
    // only a key on the FIGURE can say so, because the stamps are equal.
    expect(observed.map((record) => record.observedFilledQuantity)).toEqual([8, 9]);
    // AND THE STAMPS REALLY ARE EQUAL — the precondition this case is about. Asserted, so
    // the test cannot quietly stop exercising the collision if the clock ever moves.
    expect(new Set(observed.map((record) => record.observedAt)).size).toBe(1);
    expect(observed.every((record) => record.observedAt === "2026-06-01T09:00:00")).toBe(true);

    // The fold's sort is STABLE, so file order breaks the equal-stamp tie and replays
    // 8 then 9 — the batch stamp's own argument working as written.
    expect(await remainingOnDisk(first.ordersPath)).toEqual([1]);

    // AND THE REPORT NAMES EXACTLY WHAT WAS WRITTEN. Under the stamp key this said
    // `1 observation(s) recorded` about a line that had been filtered out.
    expect(second).toMatchObject({ status: "imported", appended: 0, alreadyKnown: 0 });
    if (second.status !== "imported") throw new Error("expected an unqualified import");
    expect(second.observations).toEqual([
      { id: observed[0]?.id, known: 8, observed: 9 },
    ]);
  });

  it("reports no observation at all when the figure did NOT move", async () => {
    // The dedupe side of the same key. Idempotency is decided one layer above the append
    // filter — `detectChangedClaims` compares against the LATEST observation and reports
    // no difference — so nothing is even built. What the report must not do is name a
    // recorded observation for an import that observed nothing new.
    const first = await harness({
      csv: ladder(PARTLY_FILLED),
      reserves: [{ id: "reserve-a", amount: 5000 }],
    });
    first.setClock("2026-06-01T09:00:00");
    await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    await writeFile(
      first.csvPath,
      ladder(partlyFilledRung("100", "10", "8", "2020-01-01 10:00:00")),
      "utf8",
    );
    await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });
    const before = await readFile(first.ordersPath, "utf8");

    // The SAME export again, in the same second.
    const second = await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    expect(second).toMatchObject({ status: "imported", appended: 0, alreadyKnown: 1 });
    if (second.status !== "imported") throw new Error("expected an unqualified import");
    expect(second.observations).toEqual([]);
    // BYTE-IDENTICAL: two observations asserting the same figure are the same fact.
    expect(await readFile(first.ordersPath, "utf8")).toBe(before);
    const line = first.outputs.at(-1);
    expect(line).toContain("0 observation(s) recorded");
  });
});

/**
 * #181 slice #212 — the append filter is scoped to the rung's LATEST observation.
 *
 * THE KEY ANSWERS "is this figure already recorded?"; the filter needs "is this figure
 * still the rung's CURRENT claim?". Built from EVERY existing record, `alreadyOnFile`
 * answered the first question in the second's place: a figure some later line had already
 * superseded still filtered a legitimate re-assertion of it, and — because the report
 * describes the lines that were WRITTEN — the operator was told `0 observation(s)
 * recorded` about an observation the flow had just decided to record.
 */
describe("the append filter reads the LATEST observation, not the whole history (#212)", () => {
  const PARTLY_FILLED = partlyFilledRung("100", "10", "6", "2020-01-01 10:00:00");

  it("LANDS a re-assertion of a figure a later observation had superseded", async () => {
    const first = await harness({
      csv: ladder(PARTLY_FILLED),
      reserves: [{ id: "reserve-a", amount: 5000 }],
    });
    // 1. The rung goes on file: placed 10, the venue showing 6 filled.
    first.setClock("2026-06-01T09:00:00");
    await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });
    const [id] = await idsOnDisk(first.ordersPath);
    if (id === undefined) throw new Error("expected the rung on disk");

    // 2. An import observes 8. `orderFillObserved <id> 8` is now on file.
    await writeFile(
      first.csvPath,
      ladder(partlyFilledRung("100", "10", "8", "2020-01-01 10:00:00")),
      "utf8",
    );
    await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });
    expect(await remainingOnDisk(first.ordersPath)).toEqual([2]);

    // 3. A hand-authored observation asserting 5, at a LATER stamp, supersedes it. The
    //    file's current claim about this rung is 5 filled, 5 still resting — the 8 is
    //    history now, and history is exactly what the filter must stop reading.
    const built = buildOrderFillObserved({
      id,
      observedAt: "2026-06-01T10:00:00",
      currency: "USD",
      observedFilledQuantity: 5,
    });
    if (built.status !== "ok") throw new Error(`fixture must build: ${built.message}`);
    await appendOrders(first.ordersPath, [built.record]);
    expect(await remainingOnDisk(first.ordersPath)).toEqual([5]);
    const before = await readFile(first.ordersPath, "utf8");

    // 4. The venue's next export shows 8 again. Against the latest observation that is a
    //    RESTATEMENT — 8 is above 5, and the file's 5 resting covers the venue's 2 — so
    //    the observation is built and must be WRITTEN.
    first.setClock("2026-06-01T11:00:00");
    const outcome = await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    expect(outcome).toMatchObject({ status: "imported" });
    if (outcome.status !== "imported") throw new Error("expected an unqualified import");
    expect(outcome.observations).toEqual([{ id, known: 5, observed: 8 }]);

    // THE LINE IS ON DISK — the whole point. Under the old filter the file was
    // byte-identical here and the operator was told nothing was recorded.
    expect(await readFile(first.ordersPath, "utf8")).not.toBe(before);
    const load = await loadOrders(first.ordersPath, { warn: () => {} });
    if (load.status !== "loaded") throw new Error("expected a loaded sidecar");
    const observed = load.records.filter((record) => record.kind === "orderFillObserved");
    expect(observed.map((record) => record.observedFilledQuantity)).toEqual([8, 5, 8]);
    expect(observed.at(-1)?.observedAt).toBe("2026-06-01T11:00:00");
    // And the rung now claims what the venue holds: 10 placed, 8 observed filled.
    expect(await remainingOnDisk(first.ordersPath)).toEqual([2]);
    expect(first.outputs.at(-1)).toContain("1 observation(s) recorded");
  });

  it("still FILTERS the ordinary repeat — the same export twice, one line written", async () => {
    // THE DEDUPE THAT MUST NOT REGRESS, on both kinds at once: the placement line from the
    // first import and the observation line from the second. The third import re-states a
    // figure that IS still the rung's latest, so nothing is built and nothing is written.
    const first = await harness({
      csv: ladder(PARTLY_FILLED),
      reserves: [{ id: "reserve-a", amount: 5000 }],
    });
    first.setClock("2026-06-01T09:00:00");
    await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    await writeFile(
      first.csvPath,
      ladder(partlyFilledRung("100", "10", "8", "2020-01-01 10:00:00")),
      "utf8",
    );
    await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });
    const before = await readFile(first.ordersPath, "utf8");

    // The SAME export again, and again at a LATER second — so the stamp cannot be what
    // filters it. Only the figure can.
    first.setClock("2026-06-01T11:00:00");
    const outcome = await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    expect(outcome).toMatchObject({ status: "imported", appended: 0, alreadyKnown: 1 });
    if (outcome.status !== "imported") throw new Error("expected an unqualified import");
    expect(outcome.observations).toEqual([]);
    expect(await readFile(first.ordersPath, "utf8")).toBe(before);
    const load = await loadOrders(first.ordersPath, { warn: () => {} });
    if (load.status !== "loaded") throw new Error("expected a loaded sidecar");
    expect(load.records.map((record) => record.kind)).toEqual([
      "orderPlaced",
      "orderFillObserved",
    ]);
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

    // ADMITTED, not restated: the unqualified status, and NO observation recorded.
    expect(outcome).toMatchObject({
      status: "imported",
      appended: 0,
      alreadyKnown: 1,
      observations: [],
    });
    // WROTE NOTHING — byte-identical, not merely "no new orders".
    expect(await readFile(first.ordersPath, "utf8")).toBe(before);
    // And the operator is told nothing about a restatement, because there was not one.
    expect(first.outputs.join("\n")).not.toContain("RESTATED");
  });

  it("still DETECTS when the venue has moved PAST the recorded restatement", async () => {
    // The re-base must not blind the detector: 9 against a recorded 8 is a NEW
    // restatement, on the new basis rather than the old.
    const { harness: first, before } = await fileWithRecordedRestatement();
    await writeFile(
      first.csvPath,
      ladder(partlyFilledRung("100", "10", "9", "2020-01-01 10:00:00")),
      "utf8",
    );

    const outcome = await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    // WAS `imported-partial` with the rung SKIPPED and the file byte-identical. Slice
    // #210 writes the line, so the status widens and the file grows — what this test
    // still pins, and all it ever pinned, is the BASIS: 8, not the placement line's 6.
    expect(outcome).toMatchObject({ status: "imported" });
    if (outcome.status !== "imported") throw new Error("expected an unqualified import");
    expect(outcome.observations).toMatchObject([{ known: 8, observed: 9 }]);
    expect(await readFile(first.ordersPath, "utf8")).not.toBe(before);
    expect(await remainingOnDisk(first.ordersPath)).toEqual([1]);
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
      observations: [],
    });
    expect(await readFile(first.ordersPath, "utf8")).toBe(before);
  });
});

/**
 * #205 — THE PLACEMENT DESCRIPTORS, END TO END OVER A REAL FILE.
 *
 * The widening's whole premise is that it costs no migration: `orderType`, `timeInForce`
 * and `triggerPrice` are optional on the record and compared only when the line being
 * compared against carries them, so every line already on an append-only file keeps
 * reading exactly as it did. The first case here is that premise, stated directly.
 *
 * The refusal cases are about the REMEDY. A descriptor difference has no funding hazard —
 * the encumbrance is `price × quantity` and no descriptor is in that product — so it must
 * not be handed `changed-claim`'s cancel-the-rung-at-the-venue advice, which would destroy
 * a live rung over a discrepancy that costs nothing. Assertions are on the MESSAGE, because
 * the message is the whole reason the class exists.
 */
describe("the placement descriptors (#205)", () => {
  /** One synthetic rung, with the venue's placement descriptors under the test's control. */
  function describedRung(
    price: string,
    quantity: string,
    at: string,
    descriptors: { orderType?: string; timeInForce?: string; triggerPrice?: string } = {},
  ): string {
    const fields: Record<string, string> = {
      timestamp: at,
      pair: "XYZ/USDT",
      time_in_force: descriptors.timeInForce ?? "GTC",
      order_type: descriptors.orderType ?? "Limit",
      side: "Buy",
      price,
      quantity,
      trigger_price: descriptors.triggerPrice ?? "-- / --",
      order_value: "0",
      filled_quantity: "0",
      total_quantity: quantity,
      filled_percent: "0.00%",
      status: "Unfilled",
      action: "Cancel",
    };
    return BITGET_OPEN_ORDERS_HEADER.map((column) => fields[column] ?? "").join(",");
  }

  /** The placement line as it was written BEFORE this widening: ten keys, no descriptors. */
  async function seedPreWideningLine(ordersPath: string, csvText: string): Promise<string> {
    const parsed = parseBitgetOpenOrdersCsv(csvText);
    if (parsed.status !== "ok") throw new Error("fixture must parse");
    const [order] = parsed.orders;
    if (order === undefined) throw new Error("fixture must carry one row");
    const record: OrderRecord = {
      id: order.id,
      observedAt: order.observedAt,
      kind: "orderPlaced",
      currency: order.currency,
      symbol: order.symbol,
      side: order.side,
      price: order.price,
      quantity: order.quantity,
      fundingReserveId: "reserve-a",
    };
    await appendOrders(ordersPath, [record]);
    return order.id;
  }

  /** The placement record on disk for one id, read back through the real loader. */
  async function placedOnDisk(path: string, id: string): Promise<OrderRecord> {
    const load = await loadOrders(path, { warn: () => {} });
    if (load.status !== "loaded") throw new Error(`expected a loaded sidecar, got ${load.status}`);
    const record = load.records.find(
      (candidate) => candidate.id === id && candidate.kind === "orderPlaced",
    );
    if (record === undefined) throw new Error("expected the placement line on disk");
    return record;
  }

  it("reads a PRE-WIDENING file against a descriptor-carrying export with NO difference", async () => {
    // THE HEADLINE PROPERTY, and the whole reason the fields are optional. The file holds
    // a line written before descriptors existed; the export carries all three. If absence
    // were coalesced to `""` and `0`, this import would refuse on the rung — and so would
    // every re-import of every unchanged export, on every rung, until a migration rewrote
    // an append-only file.
    const csv = ladder(describedRung("1000", "0.1", "2020-01-01 10:00:00", { triggerPrice: "900" }));
    const first = await harness({ csv });
    await seedPreWideningLine(first.ordersPath, csv);
    const before = await readFile(first.ordersPath, "utf8");

    const outcome = await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    expect(outcome).not.toMatchObject({ status: "rejected" });
    expect(outcome).toMatchObject({ status: "imported", appended: 0, alreadyKnown: 1 });
    // Nothing written, byte for byte — the pre-widening line is not re-shaped either.
    expect(await readFile(first.ordersPath, "utf8")).toBe(before);
    expect(first.errors.join("\n")).not.toContain("REFUSED");
  });

  it("WRITES the descriptors and reads them back off the real file", async () => {
    const first = await harness({
      csv: ladder(
        describedRung("1000", "0.1", "2020-01-01 10:00:00", {
          orderType: "Limit",
          timeInForce: "GTC",
          triggerPrice: "900",
        }),
      ),
    });
    await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    const [id] = await idsOnDisk(first.ordersPath);
    if (id === undefined) throw new Error("expected the rung on disk");
    // Through `loadOrders`/`parseOrderRecord`, not off the in-memory record: a descriptor
    // missing from `KEY_ORDER.orderPlaced` never reaches the file at all.
    expect(await placedOnDisk(first.ordersPath, id)).toMatchObject({
      orderType: "Limit",
      timeInForce: "GTC",
      triggerPrice: 900,
    });
  });

  it("writes NO `triggerPrice` key for the venue's blank sentinel", async () => {
    const first = await harness({
      csv: ladder(describedRung("1000", "0.1", "2020-01-01 10:00:00")),
    });
    await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    const raw = await readFile(first.ordersPath, "utf8");
    expect(raw).not.toContain("triggerPrice");
    expect(raw).not.toContain("null");
    const [id] = await idsOnDisk(first.ordersPath);
    if (id === undefined) throw new Error("expected the rung on disk");
    expect(await placedOnDisk(first.ordersPath, id)).not.toHaveProperty("triggerPrice");
  });

  it("REFUSES a changed descriptor with its OWN token and NO cancel-the-rung advice", async () => {
    const first = await harness({
      csv: ladder(
        describedRung("1000", "0.1", "2020-01-01 10:00:00", { timeInForce: "GTC" }),
      ),
    });
    await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });
    const before = await readFile(first.ordersPath, "utf8");

    // The SAME rung by every id component and by size, described differently.
    await writeFile(
      first.csvPath,
      ladder(describedRung("1000", "0.1", "2020-01-01 10:00:00", { timeInForce: "IOC" })),
      "utf8",
    );
    const outcome = await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    expect(outcome).toMatchObject({ status: "rejected", reason: "descriptor-changed" });
    expect(await readFile(first.ordersPath, "utf8")).toBe(before);
    if (outcome.status !== "rejected") throw new Error("expected a refusal");

    // THE WORDING IS THE DELIVERABLE. It names the rung, the field and both values.
    expect(outcome.message).toContain("timeInForce GTC → IOC");
    // It says plainly that no money moved, which is what justifies not sending anyone to
    // the venue.
    expect(outcome.message).toContain("price × quantity");
    // And the remedy is to reconcile the file with the venue.
    expect(outcome.message).toContain("Reconcile the export");
    // THE ASSERTION THE CLASS EXISTS FOR: `changed-claim`'s remedy destroys a live rung,
    // and it is justified by a funding hazard a descriptor cannot create.
    expect(outcome.message).not.toContain("Cancel the rung");
    expect(outcome.message).not.toContain("re-place");
  });

  it("names a changed `triggerPrice` as a figure pair", async () => {
    const first = await harness({
      csv: ladder(describedRung("1000", "0.1", "2020-01-01 10:00:00", { triggerPrice: "900" })),
    });
    await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    await writeFile(
      first.csvPath,
      ladder(describedRung("1000", "0.1", "2020-01-01 10:00:00", { triggerPrice: "950" })),
      "utf8",
    );
    const outcome = await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    expect(outcome).toMatchObject({ status: "rejected", reason: "descriptor-changed" });
    if (outcome.status !== "rejected") throw new Error("expected a refusal");
    expect(outcome.message).toContain("triggerPrice 900 → 950");
  });

  it("keeps `amended` for a `quantity` difference even when a descriptor ALSO differs", async () => {
    // A funding hazard outranks everything: `quantity` is the figure the encumbrance is
    // computed from, so this rung is refused with exactly the token and the message it was
    // refused with before the descriptors existed — cancel-the-rung advice included,
    // because there it IS the right remedy.
    const first = await harness({
      csv: ladder(describedRung("1000", "0.1", "2020-01-01 10:00:00", { timeInForce: "GTC" })),
      reserves: [{ id: "reserve-a", amount: 5000 }],
    });
    await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });
    const before = await readFile(first.ordersPath, "utf8");

    await writeFile(
      first.csvPath,
      ladder(describedRung("1000", "0.5", "2020-01-01 10:00:00", { timeInForce: "IOC" })),
      "utf8",
    );
    const outcome = await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    expect(outcome).toMatchObject({ status: "rejected", reason: "changed-claim" });
    expect(await readFile(first.ordersPath, "utf8")).toBe(before);
    if (outcome.status !== "rejected") throw new Error("expected a refusal");
    expect(outcome.message).toContain("quantity 0.1 → 0.5");
    expect(outcome.message).toContain("Cancel the rung at the venue");
  });

  it("takes a rung whose descriptor AND fill both moved into the descriptor class", async () => {
    // The mixed claim. It must not ride into the permissive per-rung skip beside a safe
    // fill — that is what the partition's length guard protects — and it must not be told
    // to cancel a live rung either, because this wording is the accurate one for it.
    const first = await harness({
      csv: ladder(
        partlyFilledRung("100", "10", "6", "2020-01-01 10:00:00"),
      ),
      reserves: [{ id: "reserve-a", amount: 5000 }],
    });
    await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });
    const before = await readFile(first.ordersPath, "utf8");

    // The same rung, filled further AND re-described. `partlyFilledRung` writes `GTC`, so
    // this row disagrees on `time_in_force` as well as on `filled_quantity`.
    const mixed = BITGET_OPEN_ORDERS_HEADER.map(
      (column) =>
        ({
          timestamp: "2020-01-01 10:00:00",
          pair: "XYZ/USDT",
          time_in_force: "IOC",
          order_type: "Limit",
          side: "Buy",
          price: "100",
          quantity: "10",
          trigger_price: "-- / --",
          order_value: "0",
          filled_quantity: "8",
          total_quantity: "10",
          filled_percent: "80.00%",
          status: "PartiallyFilled",
          action: "Cancel",
        })[column] ?? "",
    ).join(",");
    await writeFile(first.csvPath, ladder(mixed), "utf8");
    const outcome = await importBitgetOpenOrders({ csvPath: first.csvPath, io: first.io });

    expect(outcome).toMatchObject({ status: "rejected", reason: "descriptor-changed" });
    // NOTHING WRITTEN — not the observation either, which a skip-class reading would have
    // recorded while quietly ignoring the descriptor.
    expect(await readFile(first.ordersPath, "utf8")).toBe(before);
    if (outcome.status !== "rejected") throw new Error("expected a refusal");
    expect(outcome.message).toContain("timeInForce GTC → IOC");
    expect(outcome.message).not.toContain("Cancel the rung");
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
      "Reserve balances were NOT weighed: an unplaceable rung has no balance to compare\n" +
        "against, so a coverage refusal may still follow once every rung above is placeable.",
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
      // THE COUNTS LINE CARRIES THREE FIGURES NOW (#181). The observation clause renders
      // ALWAYS, including at zero, so a clean order-only import states plainly that it
      // observed nothing — rather than leaving the reader to infer it from a missing
      // clause they have to know to look for.
      outputs.some((message) =>
        message.startsWith(
          `Imported ${csvPath}: 2 order(s) appended, 0 already known, ` +
            `0 observation(s) recorded.`,
        ),
      ),
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
