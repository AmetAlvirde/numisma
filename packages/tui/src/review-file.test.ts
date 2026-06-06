import { resolve } from "node:path";
import {
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

  it("falls back to the local default path and keeps the existing help text", () => {
    delete process.env.NUMISMA_FUND_REVIEW_FILE;

    expect(resolveFundReviewFilePath(["node", "script"]))
      .toBe(resolve(localFundReviewPath));
    expect(missingFundReviewFileMessage("/tmp/fund-review.json"))
      .toContain(resolve(localFundReviewPath));
  });
});
