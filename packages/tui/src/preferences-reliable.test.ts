// The RELIABLE half of the hardened preferences sidecar IO: the genuinely
// append-only writer
// preserves ALL prior entries; the validating loader QUARANTINES malformed/garbage
// lines (bad JSON/shape, invalid ratio, bad splitBasis, unparseable effectiveAt)
// instead of throwing through or corrupting as-of replay; blank lines are tolerated;
// a non-monotonic file replays deterministically through `pickPolicyAsOf`; and seeding
// goes through the append path (no whole-file overwrite). Prior art: #90/#93.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pickPolicyAsOf, type ProfitPolicyEntry } from "@numisma/engine";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendPreference,
  loadPreferences,
  resolvePreferencesPath,
  seedDefaultPreferences,
} from "./preferences.js";

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(createdDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  createdDirs.length = 0;
});

async function tempPath(): Promise<string> {
  const dir = await mkdtemp(resolve(tmpdir(), "numisma-prefs-"));
  createdDirs.push(dir);
  const path = resolvePreferencesPath(resolve(dir, "data"));
  await mkdir(dirname(path), { recursive: true });
  return path;
}

function entry(
  effectiveAt: string,
  splitBasis: "highWaterMark" | "perClose" = "highWaterMark",
): ProfitPolicyEntry {
  return {
    effectiveAt,
    split: { wealth: 60, reserve: 40 },
    splitBasis,
    routingReserveId: "sink-usdt",
    reserveTargetPct: 10,
  };
}

describe("appendPreference — genuinely append-only", () => {
  it("preserves ALL prior entries across successive appends", async () => {
    const path = await tempPath();
    await appendPreference(path, entry("2026-06-01", "highWaterMark"));
    await appendPreference(path, entry("2026-06-10", "perClose"));
    await appendPreference(path, entry("2026-06-20", "highWaterMark"));

    const loaded = await loadPreferences(path);
    expect(loaded.map((e) => e.effectiveAt)).toEqual(["2026-06-01", "2026-06-10", "2026-06-20"]);
    expect(loaded.map((e) => e.splitBasis)).toEqual(["highWaterMark", "perClose", "highWaterMark"]);
  });

  it("does not truncate a pre-existing file when adding one line", async () => {
    const path = await tempPath();
    await appendPreference(path, entry("2026-06-01"));
    const before = await readFile(path, "utf8");
    await appendPreference(path, entry("2026-06-10", "perClose"));
    const after = await readFile(path, "utf8");
    expect(after.startsWith(before)).toBe(true); // history is a prefix of the new file
    expect((await loadPreferences(path)).length).toBe(2);
  });
});

describe("seedDefaultPreferences — seeds via the append path", () => {
  it("writes exactly one default line when the sidecar is absent", async () => {
    const path = await tempPath();
    const seeded = await seedDefaultPreferences(path, "2026-06-01", "sink-usdt");
    expect(seeded).toHaveLength(1);
    expect(seeded[0]?.splitBasis).toBe("highWaterMark");
    const raw = await readFile(path, "utf8");
    expect(raw.trim().split("\n")).toHaveLength(1); // one appended line, not a rewrite
  });

  it("does not overwrite an existing valid policy", async () => {
    const path = await tempPath();
    await appendPreference(path, entry("2026-06-01", "perClose"));
    const result = await seedDefaultPreferences(path, "2026-07-01", "sink-usdt");
    expect(result).toHaveLength(1);
    expect(result[0]?.splitBasis).toBe("perClose"); // untouched, not re-seeded
  });
});

describe("loadPreferences — validating loader (quarantine, not throw)", () => {
  it("returns [] for a missing sidecar (log folds standalone)", async () => {
    const path = await tempPath();
    await expect(loadPreferences(path)).resolves.toEqual([]);
  });

  it("quarantines a malformed-JSON line but keeps the valid ones, and never throws", async () => {
    const path = await tempPath();
    const contents = [
      JSON.stringify(entry("2026-06-01", "highWaterMark")),
      "{ not valid json",
      "",
      "   ",
      JSON.stringify(entry("2026-06-10", "perClose")),
    ].join("\n");
    await writeFile(path, `${contents}\n`, "utf8");

    const loaded = await loadPreferences(path);
    expect(loaded.map((e) => e.effectiveAt)).toEqual(["2026-06-01", "2026-06-10"]);
  });

  it("quarantines an invalid split RATIO (negative Reserve)", async () => {
    const path = await tempPath();
    const bad = { ...entry("2026-06-05"), split: { wealth: 60, reserve: -40 } };
    await writeFile(path, `${JSON.stringify(entry("2026-06-01"))}\n${JSON.stringify(bad)}\n`, "utf8");
    const loaded = await loadPreferences(path);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.effectiveAt).toBe("2026-06-01");
  });

  it("quarantines a zero-denominator split (wealth + reserve === 0)", async () => {
    const path = await tempPath();
    const bad = { ...entry("2026-06-05"), split: { wealth: 0, reserve: 0 } };
    await writeFile(path, `${JSON.stringify(bad)}\n`, "utf8");
    await expect(loadPreferences(path)).resolves.toEqual([]);
  });

  it("quarantines a bad splitBasis outside the enum", async () => {
    const path = await tempPath();
    const bad = { ...entry("2026-06-05"), splitBasis: "lifetime" };
    await writeFile(path, `${JSON.stringify(bad)}\n`, "utf8");
    await expect(loadPreferences(path)).resolves.toEqual([]);
  });

  it("quarantines a missing or unparseable effectiveAt", async () => {
    const path = await tempPath();
    const missing = { ...entry("2026-06-05") } as Record<string, unknown>;
    delete missing.effectiveAt;
    const unparseable = { ...entry("2026-06-06"), effectiveAt: "not-a-date" };
    await writeFile(path, `${JSON.stringify(missing)}\n${JSON.stringify(unparseable)}\n`, "utf8");
    await expect(loadPreferences(path)).resolves.toEqual([]);
  });

  it("quarantines a Date.parse-able but non-ISO effectiveAt (would sort wrong under string as-of)", async () => {
    const path = await tempPath();
    // Both parse via Date.parse but are NOT lexicographically-chronological ISO dates:
    // a US-format date and an ISO date-TIME. `pickPolicyAsOf` compares strings, so
    // admitting these would silently select the wrong policy — quarantine instead.
    const usFormat = { ...entry("2026-06-05"), effectiveAt: "06/05/2026" };
    const dateTime = { ...entry("2026-06-06"), effectiveAt: "2026-06-06T00:00:00Z" };
    await writeFile(path, `${JSON.stringify(usFormat)}\n${JSON.stringify(dateTime)}\n`, "utf8");
    await expect(loadPreferences(path)).resolves.toEqual([]);
  });

  it("quarantines an out-of-range reserveTargetPct (a NAV share must be a percentage in [0, 100])", async () => {
    const path = await tempPath();
    const overHundred = { ...entry("2026-06-05"), reserveTargetPct: 500 };
    await writeFile(path, `${JSON.stringify(entry("2026-06-01"))}\n${JSON.stringify(overHundred)}\n`, "utf8");
    const loaded = await loadPreferences(path);
    expect(loaded.map((e) => e.effectiveAt)).toEqual(["2026-06-01"]);
  });

  it("quarantines a wrong-shape line (missing routingReserveId / non-object)", async () => {
    const path = await tempPath();
    const noRoute = { ...entry("2026-06-05") } as Record<string, unknown>;
    delete noRoute.routingReserveId;
    await writeFile(path, `42\n${JSON.stringify(noRoute)}\n`, "utf8");
    await expect(loadPreferences(path)).resolves.toEqual([]);
  });
});

describe("non-monotonic file — deterministic as-of replay through the selector", () => {
  it("loads in append order; pickPolicyAsOf sorts to the correct as-of policy", async () => {
    const path = await tempPath();
    // Appended OUT of date order on purpose.
    await appendPreference(path, entry("2026-06-10", "perClose"));
    await appendPreference(path, entry("2026-06-01", "highWaterMark"));

    const loaded = await loadPreferences(path);
    expect(loaded.map((e) => e.effectiveAt)).toEqual(["2026-06-10", "2026-06-01"]); // append order kept

    expect(pickPolicyAsOf(loaded, "2026-06-05")?.splitBasis).toBe("highWaterMark");
    expect(pickPolicyAsOf(loaded, "2026-06-20")?.splitBasis).toBe("perClose");
    expect(pickPolicyAsOf(loaded)?.splitBasis).toBe("perClose");
  });
});
