import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseFundReview, type FundReviewData } from "@numisma/engine";

export const localFundReviewPath = "data/fund-review.local.json";

export function resolveFundReviewFilePath(args: string[]): string {
  return resolve(
    parseFundReviewFileArg(args) ??
      process.env.NUMISMA_FUND_REVIEW_FILE ??
      localFundReviewPath,
  );
}

export async function loadFundReview(
  filePath: string,
): Promise<FundReviewData> {
  try {
    const raw = await readFile(filePath, "utf8");
    return parseFundReview(JSON.parse(raw));
  } catch (error) {
    throw normalizeLoadFundReviewError(filePath, error);
  }
}

export function missingFundReviewFileMessage(filePath: string): string {
  return [
    `Fund review file not found: ${filePath}`,
    "",
    "Provide a review file with one of:",
    "- --file <path-to-review.json>",
    "- NUMISMA_FUND_REVIEW_FILE=<path-to-review.json>",
    `- create ${resolve(localFundReviewPath)} (gitignored local default)`,
  ].join("\n");
}

function parseFundReviewFileArg(args: string[]): string | undefined {
  const fileFlagIndex = args.indexOf("--file");
  if (fileFlagIndex >= 0) {
    return args[fileFlagIndex + 1];
  }
  return args.find((arg) => arg.endsWith(".json"));
}

function normalizeLoadFundReviewError(filePath: string, error: unknown): Error {
  if (hasErrorCode(error, "ENOENT")) {
    return new Error(missingFundReviewFileMessage(filePath));
  }

  if (error instanceof SyntaxError) {
    return new Error(`Review file contains invalid JSON: ${filePath}\n\n${error.message}`);
  }

  return error instanceof Error ? error : new Error(String(error));
}

function hasErrorCode(error: unknown, code: string): error is Error & { code: string } {
  return error instanceof Error && "code" in error && error.code === code;
}
