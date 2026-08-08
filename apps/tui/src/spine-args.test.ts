// The spine's argv/env operator knobs, tested at their own seam. These parsers used
// to live in `event-store.ts` (audit finding 35): pure string→value functions with no
// filesystem, no durable log, and no reason to be reachable from the module that owns
// the append path. Extracting them left BEHAVIOR untouched — the cases below are the
// ones that guarded them there, plus the `--as-of` shape guard startup relies on.
import { describe, expect, it } from "vitest";
import {
  parseAsOfArg,
  parseMagnitudeThresholdArg,
  SPINE_MAGNITUDE_THRESHOLD_ENV,
} from "./spine-args.js";

describe("parseAsOfArg — the windowed-fold flag, fail-loud on a bad value", () => {
  it("returns undefined when the flag is absent (fold to current state)", () => {
    expect(parseAsOfArg(["node", "spine"])).toBeUndefined();
  });

  it("reads the space-separated --as-of <date>", () => {
    expect(parseAsOfArg(["node", "spine", "--as-of", "2026-06-04"])).toBe("2026-06-04");
  });

  it("reads --as-of=<date>", () => {
    expect(parseAsOfArg(["node", "spine", "--as-of=2026-06-04"])).toBe("2026-06-04");
  });

  it("ignores argv[0..1] (the node binary and the script path)", () => {
    // A script literally named `--as-of=2026-01-01` must not be read as the flag.
    expect(parseAsOfArg(["node", "--as-of=2026-01-01"])).toBeUndefined();
  });

  it("fails loud on a malformed value", () => {
    expect(() => parseAsOfArg(["node", "spine", "--as-of", "nope"])).toThrow(/--as-of/);
  });

  it("fails loud on a missing value", () => {
    expect(() => parseAsOfArg(["node", "spine", "--as-of"])).toThrow(/--as-of/);
  });
});

describe("parseMagnitudeThresholdArg — opt-in operator override, fail-loud on garbage", () => {
  it("returns undefined when neither flag nor env is set (the default run)", () => {
    expect(parseMagnitudeThresholdArg(["node", "spine"], {})).toBeUndefined();
  });

  it("reads --magnitude-threshold=<n>", () => {
    expect(parseMagnitudeThresholdArg(["node", "spine", "--magnitude-threshold=1.5"], {})).toBe(1.5);
  });

  it("reads the space-separated --magnitude-threshold <n>", () => {
    expect(parseMagnitudeThresholdArg(["node", "spine", "--magnitude-threshold", "0.75"], {})).toBe(0.75);
  });

  it("reads the env var when no flag is present", () => {
    expect(
      parseMagnitudeThresholdArg(["node", "spine"], { [SPINE_MAGNITUDE_THRESHOLD_ENV]: "2" }),
    ).toBe(2);
  });

  it("lets the flag win over the env var", () => {
    expect(
      parseMagnitudeThresholdArg(["node", "spine", "--magnitude-threshold=1.5"], {
        [SPINE_MAGNITUDE_THRESHOLD_ENV]: "9",
      }),
    ).toBe(1.5);
  });

  it("fails loud on a non-numeric value", () => {
    expect(() => parseMagnitudeThresholdArg(["node", "spine", "--magnitude-threshold=huge"], {})).toThrow(
      /Invalid magnitude-threshold/,
    );
  });

  it("fails loud on a non-positive value", () => {
    expect(() => parseMagnitudeThresholdArg(["node", "spine"], { [SPINE_MAGNITUDE_THRESHOLD_ENV]: "0" })).toThrow(
      /Invalid magnitude-threshold/,
    );
  });

  it("fails loud on a missing flag value", () => {
    expect(() => parseMagnitudeThresholdArg(["node", "spine", "--magnitude-threshold"], {})).toThrow(
      /Missing value for --magnitude-threshold/,
    );
  });
});
