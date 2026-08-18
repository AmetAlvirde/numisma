// The RELIABLE half of the hardened preferences sidecar IO. The package has no GENERAL
// write surface: seeding is the only writer, and it must be genuinely append-only (no
// whole-file overwrite — a seed onto a file of quarantined lines preserves them). The
// validating loader QUARANTINES malformed/garbage lines (bad JSON/shape, invalid ratio,
// bad splitBasis, unparseable effectiveAt) instead of throwing through or corrupting
// as-of replay — AND REPORTS EVERY ONE OF THEM: the discard rides back in the
// `LoadedPreferences` envelope as an addressable record, never as silence (ADR-020, the
// Discard Channel). Blank lines are tolerated and are not discards; a non-monotonic file
// replays deterministically through `pickPolicyAsOf`. Prior art: #90/#93.
import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
// The pure contract types come from `@numisma/engine`, not `@numisma/preferences` —
// that package deliberately does not re-export them (its barrel records the rule).
import {
  pickPolicyAsOf,
  resolveDataDir,
  type PreferenceSkipReason,
  type ProfitPolicyEntry,
} from "@numisma/engine";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadPreferences,
  resolvePreferencesPath,
  seedDefaultPreferences,
  unattendedPreferencesVerdict,
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
    // returns EMPTY `entries` (every line discarded) so the seed proceeds. The same load
    // now also carries one `skipped` record per discarded line, so that state is visible
    // rather than inferred — the seeder deliberately does not read it (it is a writer, not
    // a reporting surface). A whole-file overwrite here would destroy the very bytes an
    // operator needs to repair the corrupt sidecar.
    const path = await tempPath();
    const garbage = `{ not valid json\n${JSON.stringify({ ...entry("2026-06-05"), splitBasis: "lifetime" })}\n`;
    await writeFile(path, garbage, "utf8");

    await seedDefaultPreferences(path, "2026-06-01", "sink-usdt");

    const after = await readFile(path, "utf8");
    expect(after.startsWith(garbage)).toBe(true); // the corrupt history is a PREFIX, not a casualty
    const loaded = await loadPreferences(path);
    expect(loaded.entries.map((e) => e.effectiveAt)).toEqual(["2026-06-01"]);
    // And the state the docstring used to leave inferable is now stated: the two
    // pre-existing lines are reported as discards, not silently absent.
    expect(loaded.skipped.map((s) => s.reason)).toEqual(["not-json", "split-basis"]);
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

  it("REFUSES to seed over a sidecar it could not READ — a read gap is not an empty file", async () => {
    // A WRITE-ONLY file: the read fails with EACCES and the append would succeed. That
    // asymmetry is the whole point — without the guard the seeder sees empty `entries`
    // (the total loader's answer for a read failure), appends the default 10% policy,
    // and `pickPolicyAsOf` serves a floor the fund never set from that date forward.
    // This function's own docstring forbids exactly that: on a read gap the correct
    // behavior is the OPPOSITE of this function. Before the loader became total, the
    // read error propagated out of here and no write happened; that refusal is restored.
    const path = await tempPath();
    const real = `${JSON.stringify(entry("2026-06-01", "perClose"))}\n`;
    await writeFile(path, real, "utf8");
    await chmod(path, 0o200);
    if ((await loadPreferences(path)).load.status !== "load-failed") {
      await chmod(path, 0o600);
      return; // running as a user the mode bits do not bind (root)
    }

    const failure = await seedDefaultPreferences(path, "2026-07-01", "sink-usdt").then(
      () => undefined,
      (error: unknown) => error,
    );

    await chmod(path, 0o600);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("could not be read");
    expect((failure as Error).message).not.toContain(path); // the writer leaks no path either
    // Nothing was appended. The fund's real policy is still the only line in the file.
    expect(await readFile(path, "utf8")).toBe(real);
  });
});

describe("loadPreferences — validating loader (discard, not throw)", () => {
  it("a MISSING sidecar loads empty — the normal starting state, not a failure", async () => {
    const path = await tempPath();
    const loaded = await loadPreferences(path);
    expect(loaded.load.status).toBe("loaded"); // NOT load-failed: nothing to read is fine
    expect(loaded.entries).toEqual([]);
    expect(loaded.skipped).toEqual([]);
  });

  it("an UNREADABLE sidecar is load-failed with its message, and does not throw", async () => {
    // A directory where a file is expected: readFile fails with EISDIR, not ENOENT.
    // The loader used to rethrow this; it must now report it, so that "no policy" and
    // "the policy file could not be read" stay distinguishable downstream.
    const path = await tempPath();
    await mkdir(path, { recursive: true });
    const loaded = await loadPreferences(path);
    expect(loaded.load.status).toBe("load-failed");
    if (loaded.load.status === "load-failed") {
      expect(loaded.load.message.length).toBeGreaterThan(0);
    }
    expect(loaded.entries).toEqual([]);
    expect(loaded.skipped).toEqual([]);
  });

  it("renders a read failure as its errno CODE, never Node's path-carrying message", async () => {
    // The envelope's `message` is PROSE — `unattendedPreferencesVerdict` prints it to
    // stderr, log files and CI output. Node's fs errors interpolate the absolute path
    // they failed on, which is exactly what `SIDECAR_NAME` withholds by design. So the
    // sanitizer runs at the SOURCE and the field carries a closed-vocabulary token,
    // making the invariant structural rather than a rule each consumer must remember.
    const path = await tempPath();
    await mkdir(path, { recursive: true });
    const loaded = await loadPreferences(path);
    expect(loaded.load.status).toBe("load-failed");
    if (loaded.load.status === "load-failed") {
      expect(loaded.load.message).toBe("EISDIR");
    }
  });

  it("discards a malformed-JSON line but keeps the valid ones, and never throws", async () => {
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
    expect(loaded.entries.map((e) => e.effectiveAt)).toEqual(["2026-06-01", "2026-06-10"]);
    // The bad line is on line 2; the two blanks after it are NOT discards.
    expect(loaded.skipped).toEqual([
      { line: 2, reason: "not-json", detail: expect.any(String) },
    ]);
  });

  it("discards an invalid split RATIO (negative Reserve)", async () => {
    const path = await tempPath();
    const bad = { ...entry("2026-06-05"), split: { wealth: 60, reserve: -40 } };
    await writeFile(path, `${JSON.stringify(entry("2026-06-01"))}\n${JSON.stringify(bad)}\n`, "utf8");
    const loaded = await loadPreferences(path);
    expect(loaded.entries).toHaveLength(1);
    expect(loaded.entries[0]?.effectiveAt).toBe("2026-06-01");
    expect(loaded.skipped.map((s) => [s.line, s.reason])).toEqual([[2, "split-parts"]]);
  });

  it("discards a zero-denominator split (wealth + reserve === 0)", async () => {
    const path = await tempPath();
    const bad = { ...entry("2026-06-05"), split: { wealth: 0, reserve: 0 } };
    await writeFile(path, `${JSON.stringify(bad)}\n`, "utf8");
    const loaded = await loadPreferences(path);
    expect(loaded.entries).toEqual([]);
    expect(loaded.skipped.map((s) => [s.line, s.reason])).toEqual([[1, "split-denominator"]]);
  });

  it("discards a bad splitBasis outside the enum", async () => {
    const path = await tempPath();
    const bad = { ...entry("2026-06-05"), splitBasis: "lifetime" };
    await writeFile(path, `${JSON.stringify(bad)}\n`, "utf8");
    const loaded = await loadPreferences(path);
    expect(loaded.entries).toEqual([]);
    expect(loaded.skipped.map((s) => [s.line, s.reason])).toEqual([[1, "split-basis"]]);
    // The unrecognized token never rides in the prose.
    expect(loaded.skipped[0]?.detail).not.toContain("lifetime");
  });

  it("discards a missing or unparseable effectiveAt", async () => {
    const path = await tempPath();
    const missing = { ...entry("2026-06-05") } as Record<string, unknown>;
    delete missing.effectiveAt;
    const unparseable = { ...entry("2026-06-06"), effectiveAt: "not-a-date" };
    await writeFile(path, `${JSON.stringify(missing)}\n${JSON.stringify(unparseable)}\n`, "utf8");
    const loaded = await loadPreferences(path);
    expect(loaded.entries).toEqual([]);
    expect(loaded.skipped.map((s) => [s.line, s.reason])).toEqual([
      [1, "effective-at"],
      [2, "effective-at"],
    ]);
  });

  it("discards a Date.parse-able but non-ISO effectiveAt (would sort wrong under string as-of)", async () => {
    const path = await tempPath();
    // Both parse via Date.parse but are NOT lexicographically-chronological ISO dates:
    // a US-format date and an ISO date-TIME. `pickPolicyAsOf` compares strings, so
    // admitting these would silently select the wrong policy — quarantine instead.
    const usFormat = { ...entry("2026-06-05"), effectiveAt: "06/05/2026" };
    const dateTime = { ...entry("2026-06-06"), effectiveAt: "2026-06-06T00:00:00Z" };
    await writeFile(path, `${JSON.stringify(usFormat)}\n${JSON.stringify(dateTime)}\n`, "utf8");
    const loaded = await loadPreferences(path);
    expect(loaded.entries).toEqual([]);
    expect(loaded.skipped.map((s) => [s.line, s.reason])).toEqual([
      [1, "effective-at"],
      [2, "effective-at"],
    ]);
  });

  /**
   * THE OVERFLOW DATE, which the shape check alone lets through. `"2026-02-30"` matches
   * `\d{4}-\d{2}-\d{2}` and `Date.parse` SUCCEEDS on it, rolling it over to March 2 — so
   * the pair the loader shipped with accepted a string that SORTS as February and MEANS
   * March. Under `pickPolicyAsOf`'s string comparison the entry then takes force from
   * March 1st, a month before the operator intended, on the live push path and with no
   * warning anywhere. Only the round trip (`isIsoCalendarDate`) rejects it.
   */
  it("discards a Date.parse-able CALENDAR OVERFLOW that would sort a month early", async () => {
    const path = await tempPath();
    const feb30 = { ...entry("2026-06-05"), effectiveAt: "2026-02-30" };
    const feb29NonLeap = { ...entry("2026-06-06"), effectiveAt: "2025-02-29" };
    await writeFile(path, `${JSON.stringify(feb30)}\n${JSON.stringify(feb29NonLeap)}\n`, "utf8");
    const loaded = await loadPreferences(path);
    expect(loaded.entries).toEqual([]);
    expect(loaded.skipped.map((s) => [s.line, s.reason])).toEqual([
      [1, "effective-at"],
      [2, "effective-at"],
    ]);
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
    expect(loaded.entries.map((e) => e.effectiveAt)).toEqual(["2026-01-31", "2024-02-29"]);
    expect(loaded.skipped).toEqual([]);
  });

  it("discards an out-of-range reserveTargetPct (a NAV share must be a percentage in [0, 100])", async () => {
    const path = await tempPath();
    const overHundred = { ...entry("2026-06-05"), reserveTargetPct: 500 };
    await writeFile(path, `${JSON.stringify(entry("2026-06-01"))}\n${JSON.stringify(overHundred)}\n`, "utf8");
    const loaded = await loadPreferences(path);
    expect(loaded.entries.map((e) => e.effectiveAt)).toEqual(["2026-06-01"]);
    expect(loaded.skipped.map((s) => [s.line, s.reason])).toEqual([[2, "reserve-target-pct"]]);
  });

  it("discards a wrong-shape line (missing routingReserveId / non-object)", async () => {
    const path = await tempPath();
    const noRoute = { ...entry("2026-06-05") } as Record<string, unknown>;
    delete noRoute.routingReserveId;
    await writeFile(path, `42\n${JSON.stringify(noRoute)}\n`, "utf8");
    const loaded = await loadPreferences(path);
    expect(loaded.entries).toEqual([]);
    // Two DIFFERENT reasons, which the old bare `[]` could not tell apart.
    expect(loaded.skipped.map((s) => [s.line, s.reason])).toEqual([
      [1, "not-an-object"],
      [2, "routing-reserve-id"],
    ]);
  });
});

/**
 * THE VERDICT PARITY TABLE — acceptance criterion 5 of the discard-channel slice.
 *
 * `validateProfitPolicyEntry` changed SHAPE (it now returns which guard fired) and must
 * NOT have changed STRICTNESS. This table enumerates the accept/reject boundary of each
 * of its eight guards and pins the verdict that held BEFORE the reshape — so tightening
 * or loosening a guard later has to argue with a test instead of slipping past a
 * docstring. The `reason` column is the new information; the `accepts` column is the old
 * contract, and it is the column this test exists for.
 *
 * Every value here is authored for this table.
 */
const VERDICTS: ReadonlyArray<{
  readonly what: string;
  readonly value: unknown;
  readonly accepts: boolean;
  readonly reason?: PreferenceSkipReason;
}> = [
  // gate 0 — the JSON parse is exercised separately (a value cannot be "not JSON").
  // guard 1 — non-object
  { what: "a bare number", value: 42, accepts: false, reason: "not-an-object" },
  { what: "null", value: null, accepts: false, reason: "not-an-object" },
  { what: "a string", value: "policy", accepts: false, reason: "not-an-object" },
  // guard 2 — effectiveAt, strict ISO calendar date
  { what: "a plain valid entry", value: entry("2026-06-01"), accepts: true },
  { what: "a real end-of-month date", value: entry("2026-01-31"), accepts: true },
  { what: "a real leap day", value: entry("2024-02-29"), accepts: true },
  {
    what: "a calendar overflow (Feb 30)",
    value: { ...entry("2026-06-01"), effectiveAt: "2026-02-30" },
    accepts: false,
    reason: "effective-at",
  },
  {
    what: "a non-leap Feb 29",
    value: { ...entry("2026-06-01"), effectiveAt: "2025-02-29" },
    accepts: false,
    reason: "effective-at",
  },
  {
    what: "a US-format date",
    value: { ...entry("2026-06-01"), effectiveAt: "06/05/2026" },
    accepts: false,
    reason: "effective-at",
  },
  {
    what: "an ISO date-TIME",
    value: { ...entry("2026-06-01"), effectiveAt: "2026-06-06T00:00:00Z" },
    accepts: false,
    reason: "effective-at",
  },
  {
    what: "a missing effectiveAt",
    value: { ...entry("2026-06-01"), effectiveAt: undefined },
    accepts: false,
    reason: "effective-at",
  },
  // guard 3 — splitBasis in the enum
  { what: "the perClose basis", value: entry("2026-06-01", "perClose"), accepts: true },
  {
    what: "a basis outside the enum",
    value: { ...entry("2026-06-01"), splitBasis: "lifetime" },
    accepts: false,
    reason: "split-basis",
  },
  // guard 4 — routingReserveId a non-blank string
  {
    what: "an empty routingReserveId",
    value: { ...entry("2026-06-01"), routingReserveId: "" },
    accepts: false,
    reason: "routing-reserve-id",
  },
  {
    what: "a whitespace-only routingReserveId",
    value: { ...entry("2026-06-01"), routingReserveId: "   " },
    accepts: false,
    reason: "routing-reserve-id",
  },
  {
    what: "a non-string routingReserveId",
    value: { ...entry("2026-06-01"), routingReserveId: 7 },
    accepts: false,
    reason: "routing-reserve-id",
  },
  // guard 5 — reserveTargetPct a finite percentage in [0, 100]
  { what: "a 0% floor", value: { ...entry("2026-06-01"), reserveTargetPct: 0 }, accepts: true },
  { what: "a 100% floor", value: { ...entry("2026-06-01"), reserveTargetPct: 100 }, accepts: true },
  {
    what: "a floor just over 100",
    value: { ...entry("2026-06-01"), reserveTargetPct: 100.0001 },
    accepts: false,
    reason: "reserve-target-pct",
  },
  {
    what: "a negative floor",
    value: { ...entry("2026-06-01"), reserveTargetPct: -0.0001 },
    accepts: false,
    reason: "reserve-target-pct",
  },
  {
    what: "a non-numeric floor",
    value: { ...entry("2026-06-01"), reserveTargetPct: "10" },
    accepts: false,
    reason: "reserve-target-pct",
  },
  // guard 6 — split is an object
  {
    what: "a missing split",
    value: { ...entry("2026-06-01"), split: undefined },
    accepts: false,
    reason: "split-shape",
  },
  {
    what: "a null split",
    value: { ...entry("2026-06-01"), split: null },
    accepts: false,
    reason: "split-shape",
  },
  {
    what: "a scalar split",
    value: { ...entry("2026-06-01"), split: 60 },
    accepts: false,
    reason: "split-shape",
  },
  // guard 7 — both parts finite and non-negative
  {
    what: "a zero wealth part with positive reserve",
    value: { ...entry("2026-06-01"), split: { wealth: 0, reserve: 1 } },
    accepts: true,
  },
  {
    what: "a negative reserve part",
    value: { ...entry("2026-06-01"), split: { wealth: 60, reserve: -40 } },
    accepts: false,
    reason: "split-parts",
  },
  {
    what: "a missing wealth part",
    value: { ...entry("2026-06-01"), split: { reserve: 40 } },
    accepts: false,
    reason: "split-parts",
  },
  // guard 8 — positive denominator
  {
    what: "a 0/0 split",
    value: { ...entry("2026-06-01"), split: { wealth: 0, reserve: 0 } },
    accepts: false,
    reason: "split-denominator",
  },
];

describe("validateProfitPolicyEntry — the SHAPE changed, the VERDICT did not", () => {
  it.each(VERDICTS)("$what → $accepts", async ({ value, accepts, reason }) => {
    const path = await tempPath();
    await writeFile(path, `${JSON.stringify(value)}\n`, "utf8");
    const loaded = await loadPreferences(path);
    expect(loaded.entries).toHaveLength(accepts ? 1 : 0);
    expect(loaded.skipped.map((s) => s.reason)).toEqual(reason === undefined ? [] : [reason]);
  });

  it("the JSON gate rejects a line that does not parse", async () => {
    const path = await tempPath();
    await writeFile(path, "{ not valid json\n", "utf8");
    const loaded = await loadPreferences(path);
    expect(loaded.entries).toEqual([]);
    expect(loaded.skipped.map((s) => s.reason)).toEqual(["not-json"]);
  });
});

describe("loadPreferences — the discard channel reports every skip it makes", () => {
  it("reports one addressable, categorized record per discarded line", async () => {
    const path = await tempPath();
    // Line 1 valid, line 2 not JSON, line 3 JSON but outside the splitBasis enum.
    const contents = [
      JSON.stringify(entry("2026-06-01")),
      "{ not valid json",
      JSON.stringify({ ...entry("2026-06-05"), splitBasis: "lifetime" }),
    ].join("\n");
    await writeFile(path, `${contents}\n`, "utf8");

    const loaded = await loadPreferences(path);

    expect(loaded.load.status).toBe("loaded");
    expect(loaded.entries.map((e) => e.effectiveAt)).toEqual(["2026-06-01"]);
    expect(loaded.skipped).toHaveLength(2);
    expect(loaded.skipped.map((s) => s.line)).toEqual([2, 3]); // 1-BASED
    expect(loaded.skipped.map((s) => s.reason)).toEqual(["not-json", "split-basis"]);
    // Prose only — no substring of the rejected line ever rides in the detail.
    for (const skip of loaded.skipped) {
      expect(skip.detail.length).toBeGreaterThan(0);
      expect(skip.detail).not.toContain("lifetime");
      expect(skip.detail).not.toContain("not valid json");
    }
  });
});

describe("non-monotonic file — deterministic as-of replay through the selector", () => {
  it("loads in append order; pickPolicyAsOf sorts to the correct as-of policy", async () => {
    const path = await tempPath();
    // Appended OUT of date order on purpose.
    await appendLine(path, entry("2026-06-10", "perClose"));
    await appendLine(path, entry("2026-06-01", "highWaterMark"));

    const loaded = await loadPreferences(path);
    expect(loaded.entries.map((e) => e.effectiveAt)).toEqual(["2026-06-10", "2026-06-01"]); // append order kept

    expect(pickPolicyAsOf(loaded.entries, "2026-06-05")?.splitBasis).toBe("highWaterMark");
    expect(pickPolicyAsOf(loaded.entries, "2026-06-20")?.splitBasis).toBe("perClose");
    expect(pickPolicyAsOf(loaded.entries)?.splitBasis).toBe("perClose");
  });
});

// R-M3: `resolvePreferencesPath` with NO argument must resolve under the shared engine
// `resolveDataDir` (the accumulus default), NEVER a CWD-relative `./data/preferences.jsonl`.
// NOT latent — the read path is already wired, so the split-brain this guards is live:
// `push-core.ts` calls `loadPreferences(resolvePreferencesPath())` inside
// `loadReserveFloorAsOf`, reached from `buildGlanceForAnchor`, which the push and the
// backfill both call (ADR-004, correction 2). A CWD-relative read here would serve the
// phone a Reserve floor from a different file than the one the fund appends to. This also
// guards the closure of the third resolver copy.
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

// #348, the other half of R-M3. The no-arg case above was already guarded; the BLANK
// case was not, and it had a hole of exactly the shape R-M3 forbids. `resolvePreferencesPath`
// took its default as a default PARAMETER (`dataDir = resolveDataDir()`), and a JS default
// parameter fires on `undefined` and on NOTHING ELSE — so an explicit `""` walked straight
// past it into `resolve("")`, which is the process's CWD. Measured before the fix:
// `resolvePreferencesPath("")` returned `<cwd>/preferences.jsonl`. That is the same live
// split-brain the block above exists to prevent, entered through the door it did not watch.
describe("resolvePreferencesPath — a BLANK dataDir is REFUSED, not defaulted and never CWD (#348)", () => {
  // The `undefined` case below must be measured against the DEFAULT, so the ambient
  // env override (if the developer running this has one) is lifted for it. Local to this
  // block rather than shared with the one above so neither can restore the other's save.
  function withoutDataDirEnv<T>(fn: () => T): T {
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

  it("the CWD path is never produced — the specific regression, named in the failure", () => {
    const cwdFlavoured = join(process.cwd(), "preferences.jsonl");
    let produced: string | undefined;
    try {
      produced = resolvePreferencesPath("");
    } catch {
      produced = undefined;
    }
    expect(
      produced,
      `resolvePreferencesPath("") must never resolve against the process CWD (${cwdFlavoured})`,
    ).not.toBe(cwdFlavoured);
    // And a return of any OTHER path is equally a failure to refuse — including a quiet
    // fall-through to the accumulus default, which would hide a misconfigured knob as an
    // absent one and serve the phone a floor from the real ledger the caller did not pick.
    expect(
      produced,
      'resolvePreferencesPath("") must throw rather than return any path at all',
    ).toBeUndefined();
  });

  it("refuses both spellings of blank, in the resolver's own voice", () => {
    expect(() => resolvePreferencesPath("")).toThrow(
      /preferences data directory must not be empty/,
    );
    // Whitespace-only is the spelling a shell produces most often and the one a bare
    // `=== ""` check would wave through.
    expect(() => resolvePreferencesPath("   ")).toThrow(
      /preferences data directory must not be empty/,
    );
    expect(() => resolvePreferencesPath("\t\n")).toThrow(
      /preferences data directory must not be empty/,
    );
  });

  it("the refusal names the consequence AND the two ways out", () => {
    let message = "";
    try {
      resolvePreferencesPath("");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/not .?unset.?/i);
    expect(message).toMatch(/working directory/);
    expect(message).toMatch(/Pass no data directory/);
    expect(message).toMatch(/absolute path/);
  });

  it("a GENUINELY absent override still defaults — the refusal must not swallow `undefined`", () => {
    withoutDataDirEnv(() => {
      expect(resolvePreferencesPath(undefined)).toBe(
        join(resolveDataDir(), "preferences.jsonl"),
      );
      expect(() => resolvePreferencesPath()).not.toThrow();
    });
  });
});

/**
 * The UNATTENDED-CALLER POLICY (spec #320 seam C). It is a NAMED FUNCTION over the
 * envelope rather than a convention, precisely so these assertions are possible: the
 * discarding component never picks the consequence, so the consequence has to be a
 * value somebody can hold. Every fixture below is authored.
 */
describe("unattendedPreferencesVerdict — the policy, as a value a test can assert", () => {
  it("a clean load is zero messages and a zero exit", async () => {
    const path = await tempPath();
    await appendLine(path, entry("2026-06-01"));
    expect(unattendedPreferencesVerdict(await loadPreferences(path))).toEqual({
      exitCode: 0,
      messages: [],
    });
  });

  it("a MISSING sidecar is zero — the normal starting state, not an anomaly", async () => {
    // A fund that has not set a policy has nothing wrong with it. Marking the run on
    // day one would teach the operator that the mark means nothing.
    const path = await tempPath();
    expect(unattendedPreferencesVerdict(await loadPreferences(path))).toEqual({
      exitCode: 0,
      messages: [],
    });
  });

  it("names the file, the 1-based line and the reason — and never the line's content", async () => {
    const path = await tempPath();
    const rejected = { ...entry("2026-06-05"), routingReserveId: 17 };
    await writeFile(
      path,
      `${JSON.stringify(entry("2026-06-01"))}\n${JSON.stringify(rejected)}\n`,
      "utf8",
    );

    const { exitCode, messages } = unattendedPreferencesVerdict(await loadPreferences(path));

    expect(exitCode).toBe(1);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("preferences.jsonl");
    expect(messages[0]).toContain("line 2");
    expect(messages[0]).toContain("routing-reserve-id");
    // The rejected line, and the values inside it, stay out of the prose. Fund figures
    // echoed into a diagnostic are laundered into terminals, log files and CI output.
    expect(messages[0]).not.toContain(JSON.stringify(rejected));
    expect(messages[0]).not.toContain("sink-usdt");
  });

  it("addresses the sidecar by NAME, never by path", async () => {
    // A full path names the operator's home directory and their data store's location.
    // The file has exactly one name in ADR-004's class, and that is what is printed.
    const path = await tempPath();
    await writeFile(path, "authored garbage, not JSON\n", "utf8");
    const { messages } = unattendedPreferencesVerdict(await loadPreferences(path));
    expect(messages[0]).not.toContain(path);
  });

  it("one message per discard, in file order, and a blank line is not a discard", async () => {
    const path = await tempPath();
    await writeFile(
      path,
      `authored garbage\n\n${JSON.stringify({ ...entry("2026-06-05"), split: 4 })}\n`,
      "utf8",
    );
    const { exitCode, messages } = unattendedPreferencesVerdict(await loadPreferences(path));
    expect(exitCode).toBe(1);
    // Line 2 is blank and contributes nothing; line 3 keeps its own number regardless.
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain("line 1");
    expect(messages[1]).toContain("line 3");
  });

  it("a load-failed outcome is non-zero and says which half failed", async () => {
    // A DIRECTORY where the sidecar should be: a real read error that is not ENOENT,
    // which the loader renders as `load-failed` rather than throwing. Empty entries
    // alone would assert "this fund has no policy" when the truth is "the policy could
    // not be read" — downstream, a suppressed Reserve slot nobody can explain.
    const path = await tempPath();
    await mkdir(path, { recursive: true });
    const { exitCode, messages } = unattendedPreferencesVerdict(await loadPreferences(path));
    expect(exitCode).toBe(1);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("preferences.jsonl could not be read");
    // The CODE, and nothing that could carry a path. EISDIR is one of the few uv
    // messages that omits the filename, so asserting only on the directory fixture
    // would leave the one branch that CAN leak unasserted — see the EACCES case below.
    expect(messages[0]).toContain("EISDIR");
    expect(messages[0]).not.toContain(path);
  });

  it("a load-failed diagnostic never launders the absolute path into the prose", async () => {
    // The likeliest non-ENOENT failure, and the one whose uv message quotes the file:
    // `EACCES: permission denied, open '/Users/<user>/…/preferences.jsonl'`. A full path
    // names the operator's home directory and their data store's location, which is the
    // invariant `addresses the sidecar by NAME, never by path` pins for the skip branch.
    const path = await tempPath();
    await writeFile(path, `${JSON.stringify(entry("2026-06-01"))}\n`, "utf8");
    await chmod(path, 0o000);
    const loaded = await loadPreferences(path);
    await chmod(path, 0o600); // restore before any assertion can abort the cleanup
    if (loaded.load.status !== "load-failed") {
      // Running as a user the mode bits do not bind (root). The EISDIR assertion above
      // still pins the sanitizer; there is nothing this fixture can add here.
      return;
    }

    const { messages } = unattendedPreferencesVerdict(loaded);

    expect(messages[0]).toContain("EACCES");
    expect(messages[0]).not.toContain(path);
    expect(messages[0]).not.toContain(dirname(path));
    expect(messages[0]).not.toContain(homedir());
  });
});
