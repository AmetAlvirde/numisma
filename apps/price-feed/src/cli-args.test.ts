// The `prices:fetch` argument parser (R3.1) — the command's FIRST parsing seam,
// so every rule here is a new precedent rather than an inherited one. The tests
// that matter most are the refusals: a silently-ignored `--asof=2026-08-14` would
// run the DAILY job, report success, and look exactly like a completed recovery —
// #356's own failure shape, re-created inside the fix for #356.
import { describe, expect, it } from "vitest";
import { parsePriceFetchArgs } from "./cli-args.js";

describe("parsePriceFetchArgs — the no-flag live path", () => {
  it("returns no asOf for an empty argv", () => {
    expect(parsePriceFetchArgs([])).toEqual({});
  });
});

describe("parsePriceFetchArgs — both --as-of spellings", () => {
  it("parses the joined form --as-of=<date>", () => {
    expect(parsePriceFetchArgs(["--as-of=2026-08-14"])).toEqual({ asOf: "2026-08-14" });
  });

  it("parses the separated form --as-of <date>", () => {
    expect(parsePriceFetchArgs(["--as-of", "2026-08-14"])).toEqual({ asOf: "2026-08-14" });
  });
});

describe("parsePriceFetchArgs — refuses loudly rather than ignoring", () => {
  it("refuses an unknown flag, echoing it and naming the only flag there is", () => {
    // The dangerous typo: one silently-dropped character turns a recovery into a
    // green daily run.
    expect(() => parsePriceFetchArgs(["--asof=2026-08-14"])).toThrow(/--asof=2026-08-14/);
    expect(() => parsePriceFetchArgs(["--asof=2026-08-14"])).toThrow(/--as-of/);
  });

  it("refuses an unknown flag even when a valid --as-of is also present", () => {
    expect(() => parsePriceFetchArgs(["--as-of=2026-08-14", "--dry-run"])).toThrow(/--dry-run/);
  });

  it("refuses a bare positional argument", () => {
    expect(() => parsePriceFetchArgs(["2026-08-14"])).toThrow(/2026-08-14/);
  });

  it("refuses --as-of with no value at all", () => {
    expect(() => parsePriceFetchArgs(["--as-of"])).toThrow(/needs a date/i);
  });

  it("refuses --as-of= with an empty value", () => {
    expect(() => parsePriceFetchArgs(["--as-of="])).toThrow(/needs a date/i);
  });

  it("refuses --as-of followed by another flag rather than eating it as the date", () => {
    expect(() => parsePriceFetchArgs(["--as-of", "--other"])).toThrow(/needs a date/i);
  });

  it("refuses a malformed date shape", () => {
    expect(() => parsePriceFetchArgs(["--as-of=2026-8-14"])).toThrow(/YYYY-MM-DD/);
    expect(() => parsePriceFetchArgs(["--as-of=yesterday"])).toThrow(/YYYY-MM-DD/);
  });

  it("refuses a second --as-of: one date per run, a range is a shell loop", () => {
    expect(() => parsePriceFetchArgs(["--as-of=2026-08-14", "--as-of=2026-08-15"])).toThrow(
      /once/i,
    );
  });
});

describe("parsePriceFetchArgs — the semantic half is NOT its job (R2.2 owns it)", () => {
  it("passes a well-shaped but impossible date straight through to runPriceFetch", () => {
    // Shape here, calendar reality and past-ness in `runPriceFetch` — so a
    // programmatic caller crosses the same validation boundary the operator does.
    expect(parsePriceFetchArgs(["--as-of=2026-02-30"])).toEqual({ asOf: "2026-02-30" });
  });
});
