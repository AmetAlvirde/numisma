// The RELIABLE half of the `orders.jsonl` sidecar IO: the append is GENUINE (temp +
// rename, and a torn final line is REPAIRED rather than compounded), the round-trip
// through writer and loader is byte-equal, and the loader is TOTAL — unreadable is not
// absent, and an unknown `kind` skips, warns and is returned rather than failing the
// load.
//
// Every ladder here is SYNTHETIC and every figure invented and round. The fund's real
// rungs are figures and must never enter this repository (ADR-007); these tests assert
// PROPERTIES of the IO, never a real value.
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  pickRestingOrdersAsOf,
  serializeOrderRecord,
  type OrderRecord,
  type OrderPlacedRecord,
} from "@numisma/engine";
import { afterEach, describe, expect, it } from "vitest";
import { appendOrders, loadOrders, resolveOrdersPath } from "./orders.js";

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(createdDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  createdDirs.length = 0;
});

async function tempPath(): Promise<string> {
  const dir = await mkdtemp(resolve(tmpdir(), "numisma-orders-"));
  createdDirs.push(dir);
  const path = resolveOrdersPath(resolve(dir, "data"));
  await mkdir(dirname(path), { recursive: true });
  return path;
}

function placed(id: string, observedAt: string, price: number, quantity: number): OrderPlacedRecord {
  return {
    id,
    observedAt,
    kind: "orderPlaced",
    currency: "USD",
    symbol: "TEST/USD",
    side: "buy",
    price,
    quantity,
    fundingReserveId: "reserve-synthetic",
  };
}

/** A synthetic two-rung ladder plus one state change — the whole record vocabulary. */
const LADDER: OrderRecord[] = [
  placed("rung-a", "2026-01-01T10:00:00", 200, 2),
  placed("rung-b", "2026-01-01T10:00:01", 100, 2),
  { id: "rung-a", observedAt: "2026-01-02T09:00:00", kind: "orderCancelled", currency: "USD" },
];

/** Collect the loader's warnings instead of letting them reach the console. */
function warnings(): { warn: (message: string) => void; messages: string[] } {
  const messages: string[] = [];
  return { warn: (message) => messages.push(message), messages };
}

describe("resolveOrdersPath", () => {
  it("resolves an ABSOLUTE path, never a CWD-relative one", () => {
    // A durable, git-tracked artifact written relative to the process's start directory
    // is a split-brain waiting to happen — the same hazard the preferences sidecar's
    // resolver exists to close.
    expect(isAbsolute(resolveOrdersPath())).toBe(true);
    expect(resolveOrdersPath(resolve("/synthetic/data"))).toBe(resolve("/synthetic/data/orders.jsonl"));
  });
});

describe("appendOrders — a GENUINE append", () => {
  it("preserves ALL prior records across successive appends", async () => {
    const path = await tempPath();
    await appendOrders(path, [LADDER[0]!]);
    await appendOrders(path, [LADDER[1]!]);
    await appendOrders(path, [LADDER[2]!]);

    const load = await loadOrders(path, { warn: warnings().warn });
    expect(load.status).toBe("loaded");
    if (load.status !== "loaded") return;
    expect(load.records.map((record) => record.kind)).toEqual([
      "orderPlaced",
      "orderPlaced",
      "orderCancelled",
    ]);
  });

  it("REPAIRS a torn final line rather than compounding it", async () => {
    // The failure the plans-sidecar prototype shipped: a suffix-only `appendFile` onto a
    // file whose last line lost its terminator concatenates the new record onto the torn
    // one, and BOTH are lost unattributably — neither parses, neither is recoverable.
    const path = await tempPath();
    const torn = `${serializeOrderRecord(LADDER[0]!)}`; // deliberately NO trailing newline
    await writeFile(path, torn, "utf8");

    await appendOrders(path, [LADDER[1]!]);

    const raw = await readFile(path, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw.split("\n").filter((line) => line.trim() !== "")).toHaveLength(2);

    const load = await loadOrders(path, { warn: warnings().warn });
    expect(load.status).toBe("loaded");
    if (load.status !== "loaded") return;
    // BOTH records intact and readable — the pre-existing one is not collateral damage.
    expect(load.records.map((record) => record.id)).toEqual(["rung-a", "rung-b"]);
    expect(load.skips).toEqual([]);
  });

  it("leaves no temp file behind and writes nothing for an empty batch", async () => {
    const path = await tempPath();
    await appendOrders(path, LADDER);
    await appendOrders(path, []);

    await expect(readFile(`${path}.tmp`, "utf8")).rejects.toThrow();
    const load = await loadOrders(path, { warn: warnings().warn });
    expect(load.status === "loaded" && load.records).toHaveLength(3);
  });

  it("creates the sidecar and its directory on first write", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "numisma-orders-"));
    createdDirs.push(dir);
    const path = resolveOrdersPath(resolve(dir, "nested", "data"));

    expect((await loadOrders(path, { warn: warnings().warn })).status).toBe("absent");
    await appendOrders(path, [LADDER[0]!]);
    expect((await loadOrders(path, { warn: warnings().warn })).status).toBe("loaded");
  });
});

describe("round-trip — the observed half survives byte-equal", () => {
  it("re-serializes to exactly the bytes on disk", async () => {
    const path = await tempPath();
    await appendOrders(path, LADDER);

    const load = await loadOrders(path, { warn: warnings().warn });
    expect(load.status).toBe("loaded");
    if (load.status !== "loaded") return;

    const onDisk = (await readFile(path, "utf8")).split("\n").filter((line) => line !== "");
    expect(load.records.map((record) => serializeOrderRecord(record))).toEqual(onDisk);
    // And byte-equal against what the caller handed the writer, not just against itself.
    expect(onDisk).toEqual(LADDER.map((record) => serializeOrderRecord(record)));
  });

  it("hands the pure selector records it can replay unchanged", async () => {
    const path = await tempPath();
    await appendOrders(path, LADDER);
    const load = await loadOrders(path, { warn: warnings().warn });
    if (load.status !== "loaded") throw new Error("expected a loaded sidecar");

    // The read-time join in miniature: file IO here, the pure as-of answer in the engine.
    expect(pickRestingOrdersAsOf(load.records, "2026-01-01").map((r) => r.placed.id)).toEqual([
      "rung-a",
      "rung-b",
    ]);
    expect(pickRestingOrdersAsOf(load.records, "2026-01-02").map((r) => r.placed.id)).toEqual([
      "rung-b",
    ]);
  });
});

describe("loadOrders — TOTAL", () => {
  it("reports a missing file as ABSENT, not as an error", async () => {
    const path = await tempPath();
    expect(await loadOrders(path, { warn: warnings().warn })).toEqual({ status: "absent", path });
  });

  it("reports an UNREADABLE file as unreadable — never as 'no orders'", async () => {
    // The distinction the whole outcome type exists for: "there are no orders" and "I
    // could not read the orders" are opposite facts about committed capital, and a
    // loader that collapsed them would render an encumbered balance as free.
    const path = await tempPath();
    await appendOrders(path, LADDER);
    await chmod(path, 0o000);

    const load = await loadOrders(path, { warn: warnings().warn });
    await chmod(path, 0o600);

    expect(load.status).toBe("unreadable");
    if (load.status !== "unreadable") return;
    expect(load.message).not.toBe("");
    // Emphatically NOT the empty-loaded shape a caller might mistake for "nothing rests".
    expect(load).not.toHaveProperty("records");
  });

  it("distinguishes an EMPTY sidecar from an absent one", async () => {
    const path = await tempPath();
    await writeFile(path, "", "utf8");
    const load = await loadOrders(path, { warn: warnings().warn });
    expect(load.status).toBe("loaded");
    expect(load.status === "loaded" && load.records).toEqual([]);
  });

  it("SKIPS an unknown kind, warns, returns the skip, and loads the rest", async () => {
    // Kinds are expected to be added over time. An older reader meeting a newer kind is
    // forward compatibility, not corruption — structurally the same problem the tenth
    // verb had — so it must not fail the whole load.
    const path = await tempPath();
    await appendOrders(path, [LADDER[0]!]);
    await writeFile(
      path,
      `${await readFile(path, "utf8")}${JSON.stringify({
        id: "rung-future",
        observedAt: "2026-01-05T10:00:00",
        kind: "orderRepriced",
        currency: "USD",
      })}\n`,
      "utf8",
    );
    await appendOrders(path, [LADDER[1]!]);

    const sink = warnings();
    const load = await loadOrders(path, { warn: sink.warn });

    expect(load.status).toBe("loaded");
    if (load.status !== "loaded") return;
    expect(load.records.map((record) => record.id)).toEqual(["rung-a", "rung-b"]);
    expect(load.skips).toEqual([
      { line: 2, problem: "unknown-kind", message: 'unknown kind "orderRepriced"' },
    ]);
    expect(sink.messages).toHaveLength(1);
    expect(sink.messages[0]).toContain("orderRepriced");
  });

  it("skips garbage and malformed lines as MALFORMED, reporting each with its line", async () => {
    const path = await tempPath();
    await writeFile(
      path,
      [
        serializeOrderRecord(LADDER[0]!),
        "{ not json",
        "",
        JSON.stringify({ ...LADDER[1]!, price: "cheap" }),
        JSON.stringify({ ...LADDER[1]!, observedAt: "2026-01-01" }),
        serializeOrderRecord(LADDER[1]!),
      ].join("\n") + "\n",
      "utf8",
    );

    const sink = warnings();
    const load = await loadOrders(path, { warn: sink.warn });

    expect(load.status).toBe("loaded");
    if (load.status !== "loaded") return;
    expect(load.records.map((record) => record.id)).toEqual(["rung-a", "rung-b"]);
    expect(load.skips.map((skip) => skip.line)).toEqual([2, 4, 5]);
    expect(load.skips.every((skip) => skip.problem === "malformed")).toBe(true);
    expect(sink.messages).toHaveLength(3);
  });

  it("never throws, whatever the file holds", async () => {
    const path = await tempPath();
    await writeFile(path, "[]\nnull\n7\n\"a string\"\n{}\n", "utf8");
    const load = await loadOrders(path, { warn: warnings().warn });
    expect(load.status).toBe("loaded");
    if (load.status !== "loaded") return;
    expect(load.records).toEqual([]);
    expect(load.skips).toHaveLength(5);
  });
});
