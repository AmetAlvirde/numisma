import { resolve } from "node:path";
import {
  buildCompositionReport,
  formatCompositionReport,
  loadFundReview,
} from "./fund-composition.js";

const filePath = resolve(process.argv[2] ?? "data/fund-review.sample.json");
const data = await loadFundReview(filePath);
const report = buildCompositionReport(data);

process.stdout.write(`${formatCompositionReport(report)}\n`);
