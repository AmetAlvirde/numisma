// The RELIABLE half of the hardened preferences sidecar IO. The package has no GENERAL
// write surface: seeding is the only writer, and it must be genuinely append-only (no
// whole-file overwrite — a seed onto a file of quarantined lines preserves them). The
// validating loader QUARANTINES malformed/garbage lines (bad JSON/shape, invalid ratio,
// bad splitBasis, unparseable effectiveAt) instead of throwing through or corrupting
// as-of replay; blank lines are tolerated; a non-monotonic file replays deterministically
// through `pickPolicyAsOf`. Prior art: #90/#93.
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { pickPolicyAsOf, resolveDataDir, type ProfitPolicyEntry } from "@numisma/engine";
import { afterEach, describe, expect, it } from "vitest";
import { loadPreferences, resolvePreferencesPath, seedDefaultPreferences } from "./preferences.js";

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

/**
 * Test-local fixture writer. The package deliberately exposes NO append entry point
 * (audit finding 34 — a plain-`appendFile` write surface with no lock and no torn-line
 * handling was DELETED rather than hardened), so loader/ordering fixtures write their
 * own lines here instead of reaching for a production writer that no longer exists.
 */
async function appendLine(path: string, value: ProfitPolicyEntry): Promise<void> {
  await appendFile(path, `${JSON.stringify(value)}\n`, "utf8");
}

describe("seedDefaultPreferences — the only writer, and genuinely append-only", () => {
  it("writes exactly one default line when the sidecar is absent", async () => {
    const path = await tempPath();
    const seeded = await seedDefaultPreferences(path, "2026-06-01", "sink-usdt");
    expect(seeded).toHaveLength(1);
    expect(seeded[0]?.splitBasis).toBe("highWaterMark");
    const raw = await readFile(path, "utf8");
    expect(raw.trim().split("\n")).toHaveLength(1); // one appended line, not a rewrite
  });

  it("seeding a file whose every line is QUARANTINED appends — it never truncates them", async () => {
    // The only reachable path on which the writer meets a non-empty file: `loadPreferences`
    // returns [] (all lines quarantined) so the seed proceeds. A whole-file overwrite here
    // would destroy the very bytes an operator needs to repair the corrupt sidecar.
    const path = await tempPath();
    const garbage = `{ not valid json\n${JSON.stringify({ ...entry("2026-06-05"), splitBasis: "lifetime" })}\n`;
    await writeFile(path, garbage, "utf8");

    await seedDefaultPreferences(path, "2026-06-01", "sink-usdt");

    const after = await readFile(path, "utf8");
    expect(after.startsWith(garbage)).toBe(true); // the corrupt history is a PREFIX, not a casualty
    const loaded = await loadPreferences(path);
    expect(loaded.map((e) => e.effectiveAt)).toEqual(["2026-06-01"]);
  });

  it("does not overwrite an existing valid policy", async () => {
    const path = await tempPath();
    await appendLine(path, entry("2026-06-01", "perClose"));
    const before = await readFile(path, "utf8");
    const result = await seedDefaultPreferences(path, "2026-07-01", "sink-usdt");
    expect(result).toHaveLength(1);
    expect(result[0]?.splitBasis).toBe("perClose"); // untouched, not re-seeded
    expect(await readFile(path, "utf8")).toBe(before); // and not written at all
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

  /**
   * THE OVERFLOW DATE, which the shape check alone lets through. `"2026-02-30"` matches
   * `\d{4}-\d{2}-\d{2}` and `Date.parse` SUCCEEDS on it, rolling it over to March 2 — so
   * the pair the loader shipped with accepted a string that SORTS as February and MEANS
   * March. Under `pickPolicyAsOf`'s string comparison the entry then takes force from
   * March 1st, a month before the operator intended, on the live push path and with no
   * warning anywhere. Only the round trip (`isIsoCalendarDate`) rejects it.
   */
  it("quarantines a Date.parse-able CALENDAR OVERFLOW that would sort a month early", async () => {
    const path = await tempPath();
    const feb30 = { ...entry("2026-06-05"), effectiveAt: "2026-02-30" };
    const feb29NonLeap = { ...entry("2026-06-06"), effectiveAt: "2025-02-29" };
    await writeFile(path, `${JSON.stringify(feb30)}\n${JSON.stringify(feb29NonLeap)}\n`, "utf8");
    await expect(loadPreferences(path)).resolves.toEqual([]);
  });

  it("admits a genuine end-of-month date — the round trip rejects overflow, not February", async () => {
    // The other half of the narrowing, and the reason it is a round trip rather than a
    // stricter regex: `2026-01-31` and a real leap day must still load.
    const path = await tempPath();
    await writeFile(
      path,
      `${JSON.stringify(entry("2026-01-31"))}\n${JSON.stringify(entry("2024-02-29"))}\n`,
      "utf8",
    );
    const loaded = await loadPreferences(path);
    expect(loaded.map((e) => e.effectiveAt)).toEqual(["2026-01-31", "2024-02-29"]);
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
    await appendLine(path, entry("2026-06-10", "perClose"));
    await appendLine(path, entry("2026-06-01", "highWaterMark"));

    const loaded = await loadPreferences(path);
    expect(loaded.map((e) => e.effectiveAt)).toEqual(["2026-06-10", "2026-06-01"]); // append order kept

    expect(pickPolicyAsOf(loaded, "2026-06-05")?.splitBasis).toBe("highWaterMark");
    expect(pickPolicyAsOf(loaded, "2026-06-20")?.splitBasis).toBe("perClose");
    expect(pickPolicyAsOf(loaded)?.splitBasis).toBe("perClose");
  });
});

// R-M3: `resolvePreferencesPath` with NO argument must resolve under the shared engine
// `resolveDataDir` (the accumulus default), NEVER a CWD-relative `./data/preferences.jsonl`.
// Latent today (no runtime caller), but silent split-brain the moment the sidecar is wired
// into the read path (ADR-004). This guards the closure of the third resolver copy.
describe("resolvePreferencesPath — R-M3 no-arg resolves under accumulus, never a bare `data`", () => {
  function withoutEnvOverride<T>(fn: () => T): T {
    const saved = process.env.NUMISMA_DATA_DIR;
    try {
      delete process.env.NUMISMA_DATA_DIR;
      return fn();
    } finally {
      if (saved === undefined) {
        delete process.env.NUMISMA_DATA_DIR;
      } else {
        process.env.NUMISMA_DATA_DIR = saved;
      }
    }
  }

  it("no-arg call resolves under the accumulus default, not the CWD-relative `data`", () => {
    withoutEnvOverride(() => {
      const path = resolvePreferencesPath();
      expect(isAbsolute(path)).toBe(true);
      expect(path).toBe(join(homedir(), "Dev", "accumulus", "data", "preferences.jsonl"));
      // The pre-fix trap: a bare `"data"` default resolved to `<cwd>/data/preferences.jsonl`.
      expect(path).not.toBe(join(resolve("data"), "preferences.jsonl"));
    });
  });

  it("agrees with the shared engine resolver (no drift between the two)", () => {
    withoutEnvOverride(() => {
      expect(resolvePreferencesPath()).toBe(join(resolveDataDir(), "preferences.jsonl"));
    });
  });

  it("honors the NUMISMA_DATA_DIR override, still under the shared resolver", () => {
    const saved = process.env.NUMISMA_DATA_DIR;
    try {
      process.env.NUMISMA_DATA_DIR = "~/override-store";
      expect(resolvePreferencesPath()).toBe(
        join(homedir(), "override-store", "preferences.jsonl"),
      );
    } finally {
      if (saved === undefined) {
        delete process.env.NUMISMA_DATA_DIR;
      } else {
        process.env.NUMISMA_DATA_DIR = saved;
      }
    }
  });

  it("still honors an EXPLICIT dataDir argument verbatim (unchanged for callers/tests)", () => {
    const explicit = join(homedir(), "explicit-store");
    expect(resolvePreferencesPath(explicit)).toBe(join(explicit, "preferences.jsonl"));
  });
});
