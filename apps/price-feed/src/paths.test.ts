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
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { INBOX_PATH_SEGMENTS, PRICE_STORE_DIR_SEGMENT } from "@numisma/engine";
import { assertDataDirContract } from "@numisma/engine/testkit";
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

// The LAUNDERING door runs the same table as the other four (#369). It is the door the
// table most needs, because its failure mode is invisible at the boundary it delegates
// across: it used to `resolve()` its argument first, which turns every value the upstream
// resolver refuses into one it accepts. `resolve("data")` is `<cwd>/data` — absolute,
// valid-looking, and a different store on every CWD.
//
// It is also the one door with NO `undefined` arm: its `dataDir` is required, so there is
// no default for a caller to fall into. The table asserts that absence rather than
// skipping it, so a later edit that adds a default has to come back through here.
//
// The root is read back off `pricesDir`, NOT off `log`. `log`, `genesis` and `inbox` are
// all built by the delegated `resolveEventStorePaths`, so a table driven through any of
// them measures the EVENT-STORE door's normalization a second time and says nothing about
// this one. `pricesDir` is the only field this function assembles from its own `base`, so
// it is the only field through which the table can see this door at all: a regression
// that fed `join(dataDir, PRICE_STORE_DIR_SEGMENT)` the raw argument would keep every
// delegated field correct and split the price marks off to `<cwd>/~/scratch/prices`,
// invisibly, if the table kept reading `log`.
assertDataDirContract({
  name: "resolvePriceFeedPaths",
  subject: /a price-feed data directory/,
  root: (dataDir) => dirname(resolvePriceFeedPaths(dataDir).pricesDir),
});

describe("resolvePriceFeedPaths — all four locations agree on ONE base", () => {
  // The table drives this door through `pricesDir` alone (see above), which proves this
  // function's own normalization but not that its own half and its delegated half landed
  // on the SAME root. That agreement is the whole reason this function exists rather than
  // each caller assembling four paths itself, and it is exactly what a split would break:
  // marks written under one root while the log, genesis and inbox live under another is
  // not a crash, it is a fund whose prices silently stop reaching its positions.
  //
  // The two inputs are the two the argument doors used to get wrong. `~/…` is #369's
  // ruling (three doors produced `<cwd>/~/…`), and a padded absolute path is the trim's
  // new reach at the argument doors — the one whose halves would disagree if only one of
  // them normalized.
  const assertOneBase = (dataDir: string, base: string): void => {
    const paths = resolvePriceFeedPaths(dataDir);
    expect(paths.pricesDir).toBe(join(base, PRICE_STORE_DIR_SEGMENT));
    expect(paths.genesis).toBe(join(base, "genesis.json"));
    expect(paths.log).toBe(join(base, "events.jsonl"));
    expect(paths.inbox).toBe(join(base, ...INBOX_PATH_SEGMENTS));
  };

  it("a `~` path expands once, for the price store and the delegated log alike", () => {
    // `homedir()` at runtime — never a `/Users/...` literal, which ADR-006 forbids and
    // which would publish the operator's directory layout in a public repo.
    assertOneBase("~/scratch/numisma-authored-price-root", join(homedir(), "scratch", "numisma-authored-price-root"));
  });

  it("a whitespace-padded path is trimmed once, not by one half only", () => {
    const root = resolve("/tmp/numisma-authored-price-root-369");
    assertOneBase(`  ${root}  `, root);
  });
});
