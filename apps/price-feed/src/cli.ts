/**
 * `prices:fetch` entry point — wiring ONLY. It reads `process.argv`, hands it to
 * {@link runPriceFetchCli}, and assigns the exit code that comes back. Every rule
 * the command has — argument parsing, the owed/marked/absent classification, the
 * report and the exit contract — lives in `cli-main.ts` so it is unit-testable, and
 * this file deliberately holds no copy of any of it: what the tests exercise is the
 * only path a real invocation takes.
 */
import { runPriceFetchCli } from "./cli-main.js";

runPriceFetchCli({ argv: process.argv.slice(2) })
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    // Reached only by an unexpected fault, on either path — the operator-facing
    // refusals (`PriceFetchRefusal`) are rendered as plain sentences inside
    // `runPriceFetchCli` and never get here. A genuine bug keeps its stack.
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  });
