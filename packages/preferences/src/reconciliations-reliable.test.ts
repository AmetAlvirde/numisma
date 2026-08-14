/**
 * The RELIABLE half of the `reconciliations.jsonl` trail IO: the loader is TOTAL over
 * every input, `absent` and `load-failed` never collapse, the skip taxonomy splits by
 * INSTRUCTION, the envelope is read first so a broken body is still attributable, the
 * `line` stamp is read-side only, the append never throws, and everything the writer
 * accepts the loader reads back.
 *
 * Every record here is SYNTHETIC and every id invented and obviously fake. The fund's
 * real fills are private and must never enter this repository (ADR-007); these tests
 * assert PROPERTIES of the IO, never a real value. The four example lines reused from
 * the spec are themselves authored. Nothing here touches the real accumulus checkout —
 * every path is a temp directory created and removed by this file.
 */
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { fillEventId, synthesizeOrderId } from "@numisma/engine";
import type {
  DeclaredAsShown,
  LoadedReconciliations,
  ReconciliationRecord,
} from "@numisma/engine";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendReconciliation,
  loadReconciliations,
  resolveReconciliationsPath,
  unattendedReconciliationsVerdict,
} from "./reconciliations.js";

const createdDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    createdDirs.map(async (dir) => {
      // A permission test may have left a file unreadable; make it removable again.
      await chmod(dir, 0o700).catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    }),
  );
  createdDirs.length = 0;
});

/** A throwaway trail path under a temp data dir. The file does not exist yet. */
async function tempPath(): Promise<string> {
  const dir = await mkdtemp(resolve(tmpdir(), "numisma-reconciliations-"));
  createdDirs.push(dir);
  const path = resolveReconciliationsPath(resolve(dir, "data"));
  await mkdir(dirname(path), { recursive: true });
  return path;
}

/** Write a raw file image, bypassing the writer — the only way to test a corrupt file. */
async function writeRaw(path: string, image: string): Promise<void> {
  await writeFile(path, image, "utf8");
}

/** Capture every stderr warn this module emits during `run`. */
async function warnsDuring(run: () => Promise<void>): Promise<string[]> {
  const warns: string[] = [];
  const spy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warns.push(args.map((arg) => String(arg)).join(" "));
  });
  try {
    await run();
  } finally {
    spy.mockRestore();
  }
  return warns;
}

/**
 * SYNTHESIZED ids, obviously fake and STABLE across runs — never generated at test
 * time, which would make a failure unreproducible.
 */
const LADDER_ID = "9f1c2b64-0000-4000-8000-de5060000001";

const DECLARED_ACTIVE: DeclaredAsShown = {
  status: "active",
  kind: "dcaLadder",
  planId: LADDER_ID,
  effectiveAt: "2026-08-15",
  tierOrder: ["c1", "c2"],
};

const WARNED: ReconciliationRecord = {
  positionId: "ladder-demo-01",
  eventId: "evt-demo-0007",
  fillKind: "PositionAddedTo",
  asOf: "2026-09-04",
  toldAt: "2026-09-04T18:12:07-06:00",
  lotTier: "c3",
  declared: DECLARED_ACTIVE,
  mismatches: ["tierNotInPlan"],
};

const CLEAN: ReconciliationRecord = {
  positionId: "ladder-demo-01",
  eventId: "evt-demo-0008",
  fillKind: "PositionAddedTo",
  asOf: "2026-09-11",
  toldAt: "2026-09-11T18:03:44-06:00",
  lotTier: "c2",
  declared: DECLARED_ACTIVE,
  mismatches: [],
};

const NO_PLAN: ReconciliationRecord = {
  positionId: "ladder-demo-02",
  eventId: "evt-demo-0011",
  fillKind: "PositionOpened",
  asOf: "2026-09-12",
  toldAt: "2026-09-12T18:01:19-06:00",
  lotTier: "c1",
  declared: { status: "none" },
  mismatches: ["noPlanInForce"],
};

const PLANS_UNREADABLE: ReconciliationRecord = {
  positionId: "ladder-demo-03",
  eventId: "evt-demo-0012",
  fillKind: "PositionOpened",
  asOf: "2026-09-13",
  toldAt: "2026-09-13T18:00:52-06:00",
  lotTier: "c2",
  declared: { status: "unreadable" },
  mismatches: [],
};

const ENDED: ReconciliationRecord = {
  positionId: "ladder-demo-04",
  eventId: "evt-demo-0013",
  fillKind: "PositionAddedTo",
  asOf: "2026-09-14",
  toldAt: "2026-09-14T18:04:11-06:00",
  lotTier: "c1",
  declared: { status: "ended", effectiveAt: "2026-09-01" },
  mismatches: ["noPlanInForce"],
};

const PENDING: ReconciliationRecord = {
  positionId: "ladder-demo-05",
  eventId: "evt-demo-0014",
  fillKind: "PositionOpened",
  asOf: "2026-09-15",
  toldAt: "2026-09-15T18:02:33-06:00",
  lotTier: "c1",
  declared: {
    status: "pending",
    kind: "dcaTime",
    effectiveAt: "2026-09-02",
    tierOrder: ["c1"],
  },
  mismatches: [],
};

/** Every authored record, covering all four `declared` arms and both mismatch kinds. */
const EVERY_ARM: ReconciliationRecord[] = [WARNED, CLEAN, NO_PLAN, PLANS_UNREADABLE, ENDED, PENDING];

/**
 * §4.1's four example JSONL lines, authored by the spec and reused VERBATIM. They are
 * the format's own worked example, so a reader that cannot read them back is wrong
 * about the format rather than about these tests.
 */
const SPEC_EXAMPLE_LINES = [
  '{"positionId":"ladder-demo-01","eventId":"evt-demo-0007","fillKind":"PositionAddedTo","asOf":"2026-09-04","toldAt":"2026-09-04T18:12:07-06:00","lotTier":"c3","declared":{"status":"active","kind":"dcaLadder","planId":"9f1c2b64-0000-4000-8000-de5060000001","effectiveAt":"2026-08-15","tierOrder":["c1","c2"]},"mismatches":["tierNotInPlan"]}',
  '{"positionId":"ladder-demo-01","eventId":"evt-demo-0008","fillKind":"PositionAddedTo","asOf":"2026-09-11","toldAt":"2026-09-11T18:03:44-06:00","lotTier":"c2","declared":{"status":"active","kind":"dcaLadder","planId":"9f1c2b64-0000-4000-8000-de5060000001","effectiveAt":"2026-08-15","tierOrder":["c1","c2"]},"mismatches":[]}',
  '{"positionId":"ladder-demo-02","eventId":"evt-demo-0011","fillKind":"PositionOpened","asOf":"2026-09-12","toldAt":"2026-09-12T18:01:19-06:00","lotTier":"c1","declared":{"status":"none"},"mismatches":["noPlanInForce"]}',
  '{"positionId":"ladder-demo-03","eventId":"evt-demo-0012","fillKind":"PositionOpened","asOf":"2026-09-13","toldAt":"2026-09-13T18:00:52-06:00","lotTier":"c2","declared":{"status":"unreadable"},"mismatches":[]}',
];

describe("loadReconciliations is TOTAL — no input throws", () => {
  it("returns ABSENT for a file that is not there, and never `loaded`", async () => {
    const path = await tempPath();

    const loaded = await loadReconciliations(path);

    // The whole of F5: absence of a MACHINE-WRITTEN file is its own fact, not the
    // normal starting state `loadPlans` folds into `loaded`.
    expect(loaded.load).toEqual({ status: "absent", sourcePath: path });
    expect(loaded.reconciliations).toEqual([]);
    expect(loaded.skipped).toEqual([]);
  });

  it("returns LOAD-FAILED when a directory sits where the file should be", async () => {
    const path = await tempPath();
    await mkdir(path, { recursive: true });

    const loaded = await loadReconciliations(path);

    expect(loaded.load.status).toBe("load-failed");
    expect(loaded.load.sourcePath).toBe(path);
    expect(loaded.reconciliations).toEqual([]);
  });

  it.skipIf(process.getuid?.() === 0)(
    "returns LOAD-FAILED for a file it may not read",
    async () => {
      const path = await tempPath();
      await writeRaw(path, `${SPEC_EXAMPLE_LINES[0]}\n`);
      await chmod(path, 0o000);

      const loaded = await loadReconciliations(path);

      expect(loaded.load.status).toBe("load-failed");
    },
  );

  it("reads an empty file as LOADED with empty buckets", async () => {
    const path = await tempPath();
    await writeRaw(path, "");

    const loaded = await loadReconciliations(path);

    expect(loaded.load).toEqual({ status: "loaded", sourcePath: path });
    expect(loaded.reconciliations).toEqual([]);
    expect(loaded.skipped).toEqual([]);
  });

  it("reads a file of pure garbage as LOADED, with every line reported", async () => {
    const path = await tempPath();
    await writeRaw(path, "not json at all\n\u0000\u0001\u0002\n{ oh no\n");

    const loaded = await loadReconciliations(path);

    expect(loaded.load.status).toBe("loaded");
    expect(loaded.reconciliations).toEqual([]);
    expect(loaded.skipped.map((skip) => skip.line)).toEqual([1, 2, 3]);
  });

  it("reads a truncated final line as LOADED, keeping the whole lines before it", async () => {
    const path = await tempPath();
    await writeRaw(path, `${SPEC_EXAMPLE_LINES[0]}\n${SPEC_EXAMPLE_LINES[1]?.slice(0, 60)}`);

    const loaded = await loadReconciliations(path);

    expect(loaded.load.status).toBe("loaded");
    expect(loaded.reconciliations).toHaveLength(1);
    expect(loaded.skipped).toEqual([{ line: 2, reason: "invalid", detail: "line is not JSON" }]);
  });

  it("reads a file whose every line is valid — the spec's own four examples", async () => {
    const path = await tempPath();
    await writeRaw(path, `${SPEC_EXAMPLE_LINES.join("\n")}\n`);

    const loaded = await loadReconciliations(path);

    expect(loaded.load.status).toBe("loaded");
    expect(loaded.skipped).toEqual([]);
    expect(loaded.reconciliations.map((record) => record.eventId)).toEqual([
      "evt-demo-0007",
      "evt-demo-0008",
      "evt-demo-0011",
      "evt-demo-0012",
    ]);
  });

  it("tolerates a BOM and CRLF terminators without calling line 1 corrupt", async () => {
    const path = await tempPath();
    await writeRaw(path, `\uFEFF${SPEC_EXAMPLE_LINES[0]}\r\n${SPEC_EXAMPLE_LINES[1]}\r\n`);

    const loaded = await loadReconciliations(path);

    expect(loaded.skipped).toEqual([]);
    expect(loaded.reconciliations).toHaveLength(2);
  });
});

describe("the three load arms never collapse", () => {
  it("distinguishes absent from load-failed from loaded over the same path", async () => {
    const path = await tempPath();
    const absent = await loadReconciliations(path);
    await writeRaw(path, `${SPEC_EXAMPLE_LINES[0]}\n`);
    const loaded = await loadReconciliations(path);
    await rm(path);
    await mkdir(path);
    const failed = await loadReconciliations(path);

    expect([absent.load.status, loaded.load.status, failed.load.status]).toEqual([
      "absent",
      "loaded",
      "load-failed",
    ]);
    // A `load-failed` carries the fact that made it fail; the other two never do.
    expect("message" in failed.load).toBe(true);
    expect("message" in absent.load).toBe(false);
  });
});

describe("the read-side `line` stamp", () => {
  it("equals the record's 1-based file position, blank lines included", async () => {
    const path = await tempPath();
    await writeRaw(
      path,
      `\n${SPEC_EXAMPLE_LINES[0]}\n   \n${SPEC_EXAMPLE_LINES[1]}\n`,
    );

    const loaded = await loadReconciliations(path);

    expect(loaded.reconciliations.map((record) => record.line)).toEqual([2, 4]);
  });

  it("is NEVER written — a loaded record round-trips back without one", async () => {
    const source = await tempPath();
    await writeRaw(source, `${SPEC_EXAMPLE_LINES[0]}\n`);
    const loaded = await loadReconciliations(source);
    const record = loaded.reconciliations[0];
    expect(record?.line).toBe(1);

    // The defect this guards: `LoadedReconciliationRecord` is structurally a
    // `ReconciliationRecord`, so this call typechecks perfectly and would persist an
    // immediately-stale second identity into an append-only file.
    const target = await tempPath();
    await appendReconciliation(target, record as ReconciliationRecord);

    const image = await readFile(target, "utf8");
    expect(image).not.toContain('"line"');
    expect(JSON.parse(image.trim())).not.toHaveProperty("line");
  });
});

describe("the skip taxonomy splits by INSTRUCTION", () => {
  it("skips an unrecognized `mismatches` member as UNSUPPORTED, not invalid", async () => {
    const path = await tempPath();
    const line = JSON.stringify({
      ...CLEAN,
      mismatches: ["tierNotInPlan", "cadenceOffGrid"],
    });
    await writeRaw(path, `${line}\n`);

    const loaded = await loadReconciliations(path);

    expect(loaded.skipped).toHaveLength(1);
    expect(loaded.skipped[0]?.reason).toBe("unsupported");
    expect(loaded.skipped[0]?.detail).toContain("pull and retry");
    // NOT silently dropped from an otherwise-accepted record: the whole line is
    // withheld, because the member this checkout cannot name might be a warning.
    expect(loaded.reconciliations).toEqual([]);
  });

  it("never echoes the unrecognized token itself — it is arbitrary file content", async () => {
    const path = await tempPath();
    const line = JSON.stringify({ ...CLEAN, mismatches: ["forged\nrow"] });
    await writeRaw(path, `${line}\n`);

    const loaded = await loadReconciliations(path);

    expect(loaded.skipped[0]?.detail).not.toContain("forged");
    expect(loaded.skipped[0]?.detail).not.toContain("\n");
  });

  it("calls a corrupt line INVALID — this file is machine-written, so that is an incident", async () => {
    const path = await tempPath();
    await writeRaw(path, `${JSON.stringify({ ...CLEAN, lotTier: "c9" })}\n`);

    const loaded = await loadReconciliations(path);

    expect(loaded.skipped[0]?.reason).toBe("invalid");
  });
});

describe("ENVELOPE FIRST — a broken body is still attributable", () => {
  it("scrapes positionId and asOf off a line whose body is unreadable", async () => {
    const path = await tempPath();
    // Every envelope field intact; the body's `declared` copy is missing entirely.
    const line = JSON.stringify({
      positionId: "ladder-demo-01",
      eventId: "evt-demo-0009",
      fillKind: "PositionAddedTo",
      asOf: "2026-09-05",
      toldAt: "2026-09-05T18:00:00-06:00",
      lotTier: "c1",
      mismatches: [],
    });
    await writeRaw(path, `${line}\n`);

    const loaded = await loadReconciliations(path);

    expect(loaded.skipped[0]?.positionId).toBe("ladder-demo-01");
    expect(loaded.skipped[0]?.asOf).toBe("2026-09-05");
  });

  it("leaves a broken envelope UNATTRIBUTABLE — it belongs to no position", async () => {
    const path = await tempPath();
    // A `positionId` holding a newline is the forged-row hazard, so it is not rendered
    // and therefore not attributed by either.
    const line = JSON.stringify({ ...CLEAN, positionId: "ladder\ndemo" });
    await writeRaw(path, `${line}\n`);

    const loaded = await loadReconciliations(path);

    // ATTRIBUTION IS BY POSITION, and this line names none — so it belongs to no
    // position and is counted file-globally rather than blacking one out. The date is
    // still scraped where it reads, exactly as `readPlanLine` scrapes `effectiveAt`:
    // the two envelope fields are read independently, and a readable one is a fact.
    expect(loaded.skipped[0]?.positionId).toBeUndefined();
    expect(loaded.skipped[0]?.asOf).toBe("2026-09-11");
  });

  it("scrapes NOTHING when the whole envelope is broken", async () => {
    const path = await tempPath();
    await writeRaw(
      path,
      `${JSON.stringify({ ...CLEAN, positionId: "", asOf: "the eleventh" })}\n`,
    );

    const loaded = await loadReconciliations(path);

    expect(loaded.skipped[0]?.positionId).toBeUndefined();
    expect(loaded.skipped[0]?.asOf).toBeUndefined();
  });

  it("attributes by position even when the DATE is what could not be read", async () => {
    const path = await tempPath();
    await writeRaw(path, `${JSON.stringify({ ...CLEAN, asOf: "2026-9-11" })}\n`);

    const loaded = await loadReconciliations(path);

    expect(loaded.skipped[0]?.positionId).toBe("ladder-demo-01");
    expect(loaded.skipped[0]?.asOf).toBeUndefined();
  });
});

describe("appendReconciliation NEVER throws", () => {
  it("round-trips every declared arm and both mismatch kinds", async () => {
    const path = await tempPath();
    for (const record of EVERY_ARM) {
      await appendReconciliation(path, record);
    }

    const loaded = await loadReconciliations(path);

    expect(loaded.load.status).toBe("loaded");
    expect(loaded.skipped).toEqual([]);
    // The `line` stamp is the only difference between what went in and what came out.
    expect(loaded.reconciliations.map(({ line, ...record }) => record)).toEqual(EVERY_ARM);
    expect(loaded.reconciliations.map((record) => record.line)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("warns and writes NOTHING when the echo rejects the line", async () => {
    const path = await tempPath();
    await appendReconciliation(path, CLEAN);
    const before = await readFile(path, "utf8");

    // A `toldAt` with no offset serializes fine and the loader refuses it — exactly the
    // asymmetry the echo exists to catch before a byte reaches the disk.
    const warns = await warnsDuring(async () => {
      await appendReconciliation(path, { ...WARNED, toldAt: "2026-09-04T18:12:07" });
    });

    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("could not read the line back");
    expect(await readFile(path, "utf8")).toBe(before);
  });

  it("warns and writes NOTHING when the serializer refuses an unrenderable positionId", async () => {
    const path = await tempPath();
    await appendReconciliation(path, CLEAN);
    const before = await readFile(path, "utf8");

    const warns = await warnsDuring(async () => {
      await appendReconciliation(path, { ...CLEAN, positionId: "ladder\ndemo" });
    });

    expect(warns).toHaveLength(1);
    expect(await readFile(path, "utf8")).toBe(before);
  });

  it("warns and returns normally when the write itself cannot happen", async () => {
    const path = await tempPath();
    // A FILE where the trail's parent directory must be: `mkdir` fails ENOTDIR before
    // anything is locked or written. No mock — the filesystem refuses this for real.
    const blocked = join(path, "nested", "reconciliations.jsonl");
    await writeRaw(path, "");

    const warns = await warnsDuring(async () => {
      await appendReconciliation(blocked, CLEAN);
    });

    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("append failed");
  });

  it("repairs a final line that lacks its newline instead of concatenating onto it", async () => {
    const path = await tempPath();
    // No trailing terminator — the torn tail a crashed writer would leave.
    await writeRaw(path, SPEC_EXAMPLE_LINES[0] ?? "");

    await appendReconciliation(path, CLEAN);

    const loaded = await loadReconciliations(path);
    expect(loaded.skipped).toEqual([]);
    expect(loaded.reconciliations.map((record) => record.eventId)).toEqual([
      "evt-demo-0007",
      "evt-demo-0008",
    ]);
  });

  it("leaves no lock or temp sibling behind on the happy path", async () => {
    const path = await tempPath();
    await appendReconciliation(path, CLEAN);

    const { readdir } = await import("node:fs/promises");
    expect(await readdir(dirname(path))).toEqual(["reconciliations.jsonl"]);
  });
});

/**
 * The event id a REAL fill carries, composed exactly the way the fill path composes
 * it — the engine's own `fillEventId` over its own `synthesizeOrderId` — from
 * INVENTED order components. No real trade is involved and none may be: the venue,
 * symbol, side, price and stamp below are authored, and the only thing this id is
 * used for is its SHAPE and its LENGTH.
 *
 * That length is the whole point. Every other `eventId` fixture in this file is 13
 * characters, so none of them can catch a rule that binds above 64 — and the rule
 * that did bind above 64 rejected every id the repo can actually produce, silently,
 * for every real fill.
 */
const AUTHORED_FILL_EVENT_ID = fillEventId(
  synthesizeOrderId({
    venue: "demovenue",
    symbol: "ZZZUSDT",
    side: "buy",
    price: "1234.5",
    observedAt: "2026-09-11T18:00:00",
  }),
  "2026-09-11T18:00:00",
);

describe("a REAL fill's eventId survives the writer and the loader", () => {
  it("is longer than a RENDERABLE id may be — the shape every fixture here lacks", () => {
    // Not an incidental property of the components above: `fill:` + a synthesized
    // order id + `@` + a stamp clears 64 for any plausible rung, so a 64-character
    // bound on this field is a bound on the whole population rather than an edge.
    expect(AUTHORED_FILL_EVENT_ID.length).toBeGreaterThan(64);
  });

  it("writes the line and reads it back — real appender, real loader, no warn", async () => {
    const path = await tempPath();

    const warns = await warnsDuring(async () => {
      await appendReconciliation(path, { ...CLEAN, eventId: AUTHORED_FILL_EVENT_ID });
    });

    // A warn here means the echo refused and NOTHING was written — the trail would
    // never come into existence, on every real fill, forever.
    expect(warns).toEqual([]);
    const loaded = await loadReconciliations(path);
    expect(loaded.load.status).toBe("loaded");
    expect(loaded.skipped).toEqual([]);
    expect(loaded.reconciliations.map((record) => record.eventId)).toEqual([
      AUTHORED_FILL_EVENT_ID,
    ]);
  });

  it("still refuses an empty eventId — identity, and length is the only rule dropped", async () => {
    const path = await tempPath();
    await writeRaw(path, `${JSON.stringify({ ...CLEAN, eventId: "" })}\n`);

    const loaded = await loadReconciliations(path);

    expect(loaded.reconciliations).toEqual([]);
    expect(loaded.skipped[0]?.reason).toBe("invalid");
  });

  it("still refuses an eventId holding a control character — it reaches diagnostics", async () => {
    const path = await tempPath();
    await writeRaw(path, `${JSON.stringify({ ...CLEAN, eventId: "fill:demo\nfill:other" })}\n`);

    const loaded = await loadReconciliations(path);

    expect(loaded.reconciliations).toEqual([]);
    expect(loaded.skipped[0]?.reason).toBe("invalid");
  });

  it("writes nothing when the WRITER is handed a control-character eventId", async () => {
    const path = await tempPath();

    const warns = await warnsDuring(async () => {
      await appendReconciliation(path, { ...CLEAN, eventId: "fill:demo\nfill:other" });
    });

    // Writer and loader hold the SAME rule: what one refuses the other refuses.
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("could not read the line back");
    expect(await loadReconciliations(path)).toMatchObject({ load: { status: "absent" } });
  });
});

describe("unattendedReconciliationsVerdict", () => {
  it("exits 0 for ABSENT and still says what absence means", async () => {
    const path = await tempPath();

    const verdict = unattendedReconciliationsVerdict(await loadReconciliations(path));

    expect(verdict.exitCode).toBe(0);
    expect(verdict.messages).toHaveLength(1);
    expect(verdict.messages[0]).toContain("never succeeded");
  });

  it("exits 0 with no messages for a clean read", async () => {
    const path = await tempPath();
    await writeRaw(path, `${SPEC_EXAMPLE_LINES.join("\n")}\n`);

    const verdict = unattendedReconciliationsVerdict(await loadReconciliations(path));

    expect(verdict).toEqual({ exitCode: 0, messages: [] });
  });

  it("exits 1 for load-failed", async () => {
    const path = await tempPath();
    await mkdir(path, { recursive: true });

    const verdict = unattendedReconciliationsVerdict(await loadReconciliations(path));

    expect(verdict.exitCode).toBe(1);
  });

  it("exits 1 for ANY skip, naming the line number and the reason", async () => {
    const path = await tempPath();
    await writeRaw(path, `${SPEC_EXAMPLE_LINES[0]}\nnot json\n`);

    const verdict = unattendedReconciliationsVerdict(await loadReconciliations(path));

    expect(verdict.exitCode).toBe(1);
    expect(verdict.messages[0]).toContain("line 2");
    expect(verdict.messages[0]).toContain("invalid");
    // The machine-written diagnosis, which is the whole divergence from the plans verdict.
    expect(verdict.messages[0]).toContain("machine-written");
  });

  it("exits 1 on an unsupported skip too — an unnamed member might be a warning", async () => {
    const path = await tempPath();
    await writeRaw(path, `${JSON.stringify({ ...CLEAN, mismatches: ["somethingNew"] })}\n`);

    const verdict = unattendedReconciliationsVerdict(await loadReconciliations(path));

    expect(verdict.exitCode).toBe(1);
  });
});

describe("NOTHING this module emits carries a figure or quotes the file", () => {
  /**
   * A sentinel that could only have come off the disk. Any diagnostic containing it
   * laundered file content into a terminal, a log file or CI output.
   */
  const SENTINEL = "918273645";

  it("never lets file content reach a skip detail, a verdict message or a warn", async () => {
    const path = await tempPath();
    await writeRaw(
      path,
      [
        // Figures where the format has none, on lines corrupt in three different ways.
        JSON.stringify({ ...CLEAN, lotTier: SENTINEL, priceUsd: Number(SENTINEL) }),
        JSON.stringify({ ...CLEAN, positionId: `p${SENTINEL}\n`, sizeUsd: Number(SENTINEL) }),
        JSON.stringify({ ...CLEAN, mismatches: [SENTINEL] }),
        `{"balanceUsd":${SENTINEL},`,
      ].join("\n"),
    );

    const loaded = await loadReconciliations(path);
    const verdict = unattendedReconciliationsVerdict(loaded);
    const warns = await warnsDuring(async () => {
      await appendReconciliation(path, { ...CLEAN, positionId: `p${SENTINEL}\n` });
    });

    const emitted = [
      ...loaded.skipped.map((skip) => `${skip.detail} ${skip.positionId ?? ""}`),
      ...verdict.messages,
      ...warns,
    ];
    expect(emitted).not.toHaveLength(0);
    for (const message of emitted) {
      expect(message).not.toContain(SENTINEL);
    }
  });

  it("drops figure-shaped extras rather than carrying them onto a record", async () => {
    const path = await tempPath();
    await writeRaw(
      path,
      `${JSON.stringify({ ...CLEAN, priceUsd: 1, rungs: [{ id: "r", priceUsd: 1, sizeUsd: 1 }] })}\n`,
    );

    const loaded = await loadReconciliations(path);

    expect(loaded.reconciliations).toHaveLength(1);
    expect(loaded.reconciliations[0]).not.toHaveProperty("priceUsd");
    expect(loaded.reconciliations[0]).not.toHaveProperty("rungs");
    expect(loaded.reconciliations[0]?.declared).not.toHaveProperty("rungs");
  });
});

/**
 * The spec's §5 header, reproduced here so the comparison is CHARACTER FOR CHARACTER
 * against a second copy rather than against a paraphrase someone approved in review.
 * If this block and the module's own disagree, one of them was "improved" — and the
 * paragraph most likely to be improved away is WHY IT DENORMALIZES, which is the
 * file's whole right to sit in `TRACKED_FILES`.
 */
const SPEC_HEADER = ` * \`data/reconciliations.jsonl\` — THE RECORD THAT THE OPERATOR WAS TOLD.
 *
 * Not a record of what is true. \`plans.jsonl\` is what was declared and
 * \`events.jsonl\` is what the fund did; this file records only that, at a
 * named moment, a reader compared them and showed the operator the result.
 *
 * AUTHORITY. \`plans.jsonl\` is authoritative, always. A line here NEVER
 * overrides it, corrects it, or is read in preference to it. A reader that
 * needs to know what a plan declares reads the sidecar; a reader that needs
 * to know what the operator was shown on some past day reads this.
 *
 * WHY IT DENORMALIZES, DELIBERATELY. Each line carries a copy of the
 * declared values as shown. That copy is not redundancy: plan supersession
 * is APPEND, and \`pickPlanAsOf\` selects the latest \`effectiveAt <= asOf\`,
 * so a line appended later but DATED EARLIER retroactively changes what
 * re-derivation returns for a fill already recorded. The verdict as shown
 * is therefore not recoverable from the sidecar at any later date.
 *
 * A DISAGREEMENT IS A FINDING, NOT A CORRUPTION. When a trail line and a
 * fresh re-derivation differ, the file is not stale and the sidecar is not
 * wrong: a past plan was rewritten after the fact. That divergence is
 * recorded nowhere else, and surfacing it is this file's whole reason to
 * be durable rather than printed.
 *
 * BEST-EFFORT, AND NEVER PART OF THE ACT. The fill is durable before this
 * file is touched. Every failure here degrades to a loud stderr warn and
 * returns; nothing in this file can refuse a fill, roll one back, or block
 * a return. A reader that finds no line for a fill reports UNKNOWN, never
 * clean.
 *
 * NEVER FOLDED. Not a \`PortfolioEvent\`. \`parseEvent\` never sees it,
 * \`foldEvents\` never reads it, and it changes no value NAV folds from
 * (ADR-004, ADR-013). It is durable, non-re-derivable truth by ADR-006's
 * membership test, which is what admits it to \`TRACKED_FILES\` — and that
 * admission rests on the denormalized copy above, not on the verdict.`;

describe("the §5 file header is on the IO module, VERBATIM", () => {
  it("appears character for character as the module doc, so a paraphrase fails", async () => {
    const source = await readFile(
      fileURLToPath(new URL("./reconciliations.ts", import.meta.url)),
      "utf8",
    );

    // It opens the file: the header is the module doc, not a comment further down.
    expect(source.startsWith(`/**\n${SPEC_HEADER}\n`)).toBe(true);
  });
});

/** A compile-time reminder that the loader's return type is the engine's, not a local one. */
const _typeCheck: (loaded: LoadedReconciliations) => number = (loaded) =>
  loaded.reconciliations.length;
void _typeCheck;
