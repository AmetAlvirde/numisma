import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
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

  it("accepts the inline --file=<path> form", () => {
    expect(
      resolveFundReviewFilePath(["node", "script", "--file=cli-review.json"]),
    ).toBe(resolve("cli-review.json"));
  });

  it("rejects an empty inline --file= value explicitly", () => {
    expect(() => resolveFundReviewFilePath(["node", "script", "--file="]))
      .toThrowError("Missing value for --file.");
  });

  it("skips empty argv entries without treating them as paths", () => {
    expect(resolveFundReviewFilePath(["node", "script", "", "review.json"]))
      .toBe(resolve("review.json"));
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

  it("loads and parses a well-formed review file", async () => {
    const filePath = await writeReviewFile(JSON.stringify(validReviewJson()));

    await expect(loadFundReview(filePath)).resolves.toMatchObject({
      fund: { id: "fund-1", baseCurrency: "USD" },
    });
  });

  it("surfaces invalid JSON content with the invalid-json blocking message", async () => {
    const filePath = await writeReviewFile("{ not json");

    await expect(loadFundReview(filePath)).rejects.toThrowError(
      /Blocking validation error \(invalid-json\)/,
    );
  });

  it("surfaces a schema failure with the generic blocking message", async () => {
    const filePath = await writeReviewFile(JSON.stringify({ fund: {} }));

    await expect(loadFundReview(filePath)).rejects.toThrowError(
      /Blocking validation error \(schema-error\)/,
    );
  });

  it("surfaces an unreadable file as a not-readable error", async () => {
    if (process.getuid?.() === 0) {
      // root bypasses the mode bits, so EACCES can't be provoked; the branch is
      // exercised on non-root dev/CI. Documented in docs/coverage-rationale.md.
      return;
    }
    const filePath = await writeReviewFile(JSON.stringify(validReviewJson()));
    await chmod(filePath, 0o000);

    await expect(loadFundReview(filePath)).rejects.toThrowError(
      `Fund review file is not readable: ${filePath}`,
    );

    await chmod(filePath, 0o600);
  });
});

async function writeReviewFile(contents: string): Promise<string> {
  const dir = await mkdtemp(resolve(tmpdir(), "numisma-review-load-"));
  const filePath = resolve(dir, "review.json");
  await writeFile(filePath, contents, "utf8");
  return filePath;
}

function validReviewJson() {
  return {
    fund: { id: "fund-1", name: "Main Fund", baseCurrency: "USD" },
    review: { asOf: "2026-05-28", usdMxn: 20 },
    portfolios: [{ id: "core", name: "Core" }],
    accounts: [{ id: "acc-1", name: "Broker", platform: "XTB", currency: "USD" }],
    instruments: [{ id: "inst-1", name: "Apple", symbol: "AAPL", currency: "USD" }],
    reserves: [
      {
        id: "reserve-1",
        portfolioId: "core",
        tempo: "Reserve",
        executionMode: "live",
        accountId: "acc-1",
        currency: "USD",
        amount: 100,
      },
    ],
    positions: [
      {
        id: "position-1",
        portfolioId: "core",
        tempo: "Capital",
        executionMode: "live",
        accountId: "acc-1",
        instrumentId: "inst-1",
        direction: "long",
        markPrice: 10,
        currency: "USD",
        lots: [{ quantity: 1, cost: 5, tier: "c1" }],
      },
    ],
  };
}
