import { mkdir, mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  loadFundReview,
  localFundReviewPath,
  missingFundReviewFileMessage,
  resolveFundReviewFilePath,
} from "./review-file.js";
import { afterEach, describe, expect, it } from "vitest";

const originalReviewFile = process.env.NUMISMA_FUND_REVIEW_FILE;

afterEach(() => {
  if (originalReviewFile === undefined) {
    delete process.env.NUMISMA_FUND_REVIEW_FILE;
    return;
  }
  process.env.NUMISMA_FUND_REVIEW_FILE = originalReviewFile;
});

describe("@numisma/tui review file resolution", () => {
  it("prefers the explicit --file argument", () => {
    process.env.NUMISMA_FUND_REVIEW_FILE = "env-review.json";

    expect(
      resolveFundReviewFilePath(["node", "script", "--file", "cli-review.json"]),
    ).toBe(resolve("cli-review.json"));
  });

  it("resolves an absolute --file argument without changing it", () => {
    const absolutePath = resolve("/tmp/cli-review.json");

    expect(
      resolveFundReviewFilePath(["node", "script", "--file", absolutePath]),
    ).toBe(absolutePath);
  });

  it("accepts a single bare positional json path deterministically", () => {
    expect(resolveFundReviewFilePath(["node", "script", "review.json"]))
      .toBe(resolve("review.json"));
  });

  it("rejects a missing --file value explicitly", () => {
    expect(() => resolveFundReviewFilePath(["node", "script", "--file"]))
      .toThrowErrorMatchingInlineSnapshot(`
        [Error: Missing value for --file.

        Use --file <path-to-review.json> to select a Fund review file explicitly.]
      `);
  });

  it("rejects ambiguous bare positional json paths", () => {
    expect(() =>
      resolveFundReviewFilePath([
        "node",
        "script",
        "alpha-review.json",
        "beta-review.json",
      ]),
    ).toThrowErrorMatchingInlineSnapshot(`
      [Error: Ambiguous positional review file arguments: alpha-review.json, beta-review.json

      Use --file <path-to-review.json> to select the intended Fund review file.]
    `);
  });

  it("falls back to NUMISMA_FUND_REVIEW_FILE when no CLI path is provided", () => {
    process.env.NUMISMA_FUND_REVIEW_FILE = "env-review.json";

    expect(resolveFundReviewFilePath(["node", "script"]))
      .toBe(resolve("env-review.json"));
  });

  it("falls back to the local default path and keeps the existing help text", () => {
    delete process.env.NUMISMA_FUND_REVIEW_FILE;

    expect(resolveFundReviewFilePath(["node", "script"]))
      .toBe(resolve(localFundReviewPath));
    expect(missingFundReviewFileMessage("/tmp/fund-review.json"))
      .toContain(resolve(localFundReviewPath));
  });
});

describe("@numisma/tui review file loading", () => {
  it("surfaces missing-file errors with the documented help text", async () => {
    await expect(loadFundReview("/tmp/does-not-exist-review.json"))
      .rejects.toThrowError(missingFundReviewFileMessage("/tmp/does-not-exist-review.json"));
  });

  it("surfaces directory paths with an engine-agnostic error", async () => {
    const directoryPath = await mkdtemp(resolve(tmpdir(), "numisma-review-dir-"));
    await mkdir(resolve(directoryPath, "nested"));

    await expect(loadFundReview(directoryPath)).rejects.toThrowError(
      `Fund review path is a directory, not a file: ${directoryPath}`,
    );
  });
});
