/**
 * `prices:fetch` argument parsing — a pure function over an argv array, so the
 * command's first parsing seam is unit-testable without spawning a process.
 *
 * WHY THIS EXISTS RATHER THAN AN IMPORT (spec §8.4). The tui's spine already has an
 * `--as-of` flag with its own argv walk, and this is deliberately a SECOND parser,
 * not a shared one:
 *
 *  - An app may not import an app in this repo (recorded by name, with a removed
 *    prototype as the precedent), so the tui's parser is out of reach.
 *  - A shared home is barred too: ADR-001 keeps CLI flag parsing out of
 *    `@numisma/engine`, and a CLI parser does not belong in the durable-log package
 *    either.
 *  - They are not even the same contract. The spine's `--as-of` names a FOLD WINDOW;
 *    this one names a FETCH TARGET. They differ in what an out-of-range value means,
 *    and in validation strength — the spine's is shape-only (`/^\d{4}-\d{2}-\d{2}/`),
 *    which accepts `2026-02-30` and silently rolls it to March 2. This path must
 *    never coerce, so the round-trip predicate `isIsoCalendarDate` guards it.
 *  - What is genuinely shared IS shared: that predicate lives in the engine as a
 *    pure declaration. The argv walk is the cheap half, and it is the only
 *    duplicated half.
 *
 * WHERE VALIDATION SPLITS. Shape only here; calendar reality and "strictly in the
 * past" stay in `runPriceFetch` (R2.2), which is the boundary a PROGRAMMATIC caller
 * also crosses. Duplicating the semantic rules here would create two places that
 * must agree forever, with nothing forcing them to.
 */

/** The flag surface of `prices:fetch`. One flag, one value, no range, no dry run. */
export interface PriceFetchArgs {
  /**
   * The past trading day to recover (`YYYY-MM-DD`), or absent for the ordinary
   * daily run. Shape-checked only; `runPriceFetch` decides whether the day is real
   * and whether it is in the past.
   */
  asOf?: string;
}

const AS_OF_FLAG = "--as-of";
/** Shape only — `isIsoCalendarDate` in `runPriceFetch` owns calendar reality. */
const ISO_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

const USAGE =
  "usage: pnpm prices:fetch [--as-of=YYYY-MM-DD]\n" +
  "  no flag        fetch today's closes (the daily job)\n" +
  "  --as-of <date> recover one past trading day; for several days, loop the\n" +
  "                 command — the inbox merge makes repetition safe.";

/**
 * Parse `prices:fetch` arguments, throwing an operator-readable `Error` on anything
 * this command does not understand.
 *
 * UNKNOWN ARGUMENTS ARE REFUSED, NOT IGNORED, and that is the point of the whole
 * function. There is no precedent to inherit here, and one specific typo is
 * dangerous: `--asof=2026-08-14`, quietly dropped, would run the DAILY job against
 * today, report success and exit 0 — indistinguishable from a completed recovery of
 * 2026-08-14. That is #356's exact failure shape, re-created inside the fix for
 * #356. A missing or malformed value fails the same way, and for the same reason.
 *
 * @param argv the arguments AFTER the node/script pair (i.e. `process.argv.slice(2)`).
 */
export function parsePriceFetchArgs(argv: readonly string[]): PriceFetchArgs {
  let asOf: string | undefined;

  const take = (value: string | undefined, spelling: string): string => {
    if (value === undefined || value === "" || value.startsWith("-")) {
      throw new Error(
        `${AS_OF_FLAG} needs a date: write ${AS_OF_FLAG}=YYYY-MM-DD or ` +
          `${AS_OF_FLAG} YYYY-MM-DD (got "${spelling}").\n${USAGE}`,
      );
    }
    if (!ISO_SHAPE.test(value)) {
      throw new Error(
        `${AS_OF_FLAG} value "${value}" is not a date in YYYY-MM-DD form ` +
          `(zero-padded, e.g. 2026-08-14).\n${USAGE}`,
      );
    }
    return value;
  };

  const claim = (value: string): void => {
    if (asOf !== undefined) {
      // One date per run. A range is a shell loop wearing a flag, and a multi-day
      // window walks into the Banxico ordering trap the pinned one-day path avoids.
      throw new Error(
        `${AS_OF_FLAG} may be given once — this command recovers one day per run ` +
          `(got "${asOf}" and "${value}"). For several days, loop the command; the ` +
          `inbox merges by id, so repeating a day is safe.\n${USAGE}`,
      );
    }
    asOf = value;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === AS_OF_FLAG) {
      claim(take(argv[i + 1], arg));
      i++;
      continue;
    }
    if (arg.startsWith(`${AS_OF_FLAG}=`)) {
      claim(take(arg.slice(AS_OF_FLAG.length + 1), arg));
      continue;
    }
    throw new Error(
      `unknown argument "${arg}". \`prices:fetch\` takes ${AS_OF_FLAG} and nothing ` +
        `else, and refuses what it does not understand rather than ignoring it: a ` +
        `silently-dropped flag would run the ordinary daily job and report success, ` +
        `which is indistinguishable from a completed recovery.\n${USAGE}`,
    );
  }

  return asOf === undefined ? {} : { asOf };
}
