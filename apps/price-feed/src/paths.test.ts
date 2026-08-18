/**
 * `resolvePriceFeedPaths` — the LAUNDERING seam (#348).
 *
 * The blank-data-dir refusal is enforced upstream in `resolveEventStorePaths`, and this
 * function is the one place in the repo that could defeat it without looking like it
 * was doing anything: it calls `resolve()` on its own argument BEFORE delegating, and
 * `resolve("")` is the process's CWD — an absolute path, indistinguishable at the
 * boundary from a deliberate one. The upstream guard saw a valid root and passed it, and
 * this function then produced the exact `<cwd>/events.jsonl` that the upstream error
 * message asserts can never happen. An assertion a sibling falsifies is worse than no
 * assertion, so the guard is pinned here too.
 *
 * Every fixture is an authored string. Nothing here touches a filesystem — this is pure
 * path algebra — so no test in this file can reach a real data dir.
 */
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PRICE_STORE_DIR_SEGMENT } from "@numisma/engine";
import { resolvePriceFeedPaths } from "./paths.js";

describe("resolvePriceFeedPaths — a BLANK dataDir is REFUSED before it can be laundered", () => {
  it("the CWD event log is never produced — the specific regression, named in the failure", () => {
    const cwdLog = join(process.cwd(), "events.jsonl");
    let produced: string | undefined;
    try {
      produced = resolvePriceFeedPaths("").log;
    } catch {
      produced = undefined;
    }
    expect(
      produced,
      `resolvePriceFeedPaths("") must never resolve the event log against the process CWD (${cwdLog})`,
    ).not.toBe(cwdLog);
    expect(
      produced,
      'resolvePriceFeedPaths("") must throw rather than return any path at all',
    ).toBeUndefined();
  });

  it("refuses a WHITESPACE-ONLY dataDir — the spelling that becomes a literal directory", () => {
    // `resolve("   ")` does not collapse to the CWD, it appends a directory whose name is
    // three spaces: `<cwd>/   /events.jsonl`. Measured. A guard testing only `=== ""`
    // would wave this through, and it is the spelling a shell produces most often.
    const spacesLog = join(process.cwd(), "   ", "events.jsonl");
    let produced: string | undefined;
    try {
      produced = resolvePriceFeedPaths("   ").log;
    } catch {
      produced = undefined;
    }
    expect(
      produced,
      `resolvePriceFeedPaths("   ") must never resolve into a space-named directory (${spacesLog})`,
    ).not.toBe(spacesLog);
    expect(produced).toBeUndefined();
    expect(() => resolvePriceFeedPaths("\t\n")).toThrow(
      /price-feed data directory must not be empty/,
    );
  });

  it("refuses in this resolver's own voice, naming the consequence", () => {
    let message = "";
    try {
      resolvePriceFeedPaths("");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/price-feed data directory must not be empty/);
    expect(message).toMatch(/not .?unset.?/i);
    expect(message).toMatch(/working directory/);
    expect(message).toMatch(/absolute path/);
  });

  it("an ABSOLUTE dataDir still passes through untouched — the guard rejects blanks, not everything", () => {
    // Without this, a guard that threw on EVERY input would pass every assertion above.
    const root = resolve("/tmp/numisma-authored-price-root-348");
    const paths = resolvePriceFeedPaths(root);

    expect(paths.log).toBe(join(root, "events.jsonl"));
    expect(paths.genesis).toBe(join(root, "genesis.json"));
    expect(paths.pricesDir).toBe(join(root, PRICE_STORE_DIR_SEGMENT));
    expect(paths.inbox.startsWith(root)).toBe(true);
  });

  it("a dataDir that merely CONTAINS whitespace is legal — only all-blank is refused", () => {
    // The predicate is `trim() === ""`, not "has no spaces". A real macOS path can carry
    // a space, and refusing those would be a new bug wearing this fix's clothes.
    const spaced = resolve("/tmp/numisma authored root 348");
    expect(resolvePriceFeedPaths(spaced).log).toBe(join(spaced, "events.jsonl"));
  });
});
