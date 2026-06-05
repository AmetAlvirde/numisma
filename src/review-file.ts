import { resolve } from "node:path";

export const localFundReviewPath = "data/fund-review.local.json";

export function resolveFundReviewFilePath(args: string[]): string {
  return resolve(
    parseFundReviewFileArg(args) ??
      process.env.NUMISMA_FUND_REVIEW_FILE ??
      localFundReviewPath,
  );
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
