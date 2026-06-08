import {
  buildCompositionReport,
  formatCompositionReport,
} from "@numisma/engine";
import { loadFundReview, resolveFundReviewFilePath } from "./review-file.js";

try {
  const filePath = resolveFundReviewFilePath(process.argv);
  const data = await loadFundReview(filePath);
  const report = buildCompositionReport(data, {
    load: {
      status: "loaded",
      sourcePath: filePath,
      loadedAt: new Date().toISOString(),
    },
  });
  process.stdout.write(`${formatCompositionReport(report)}\n`);
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${detail}\n`);
  process.exitCode = 1;
}
