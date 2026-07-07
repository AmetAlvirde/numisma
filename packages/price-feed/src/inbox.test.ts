// Two regressions guarded here:
//
//  1. Attribution (finding 8): a corrupt/empty inbox file must fail LOUDLY and
//     NAMING the file — matching the tui's `Inbox … is not valid JSON.` — rather
//     than throwing a bare, unattributed `SyntaxError` from `JSON.parse`. The
//     parse now sits in its own try/catch inside `readInbox`, distinct from the
//     ENOENT→[] guard around `readFile`.
//
//  2. Sibling-repo data dir (grill decision): `DEFAULT_CONFIG.dataDir` must be an
//     ABSOLUTE path in the sibling private `accumulus` repo (`~/Dev/accumulus/data`),
//     derived from `os.homedir()` — never a CWD-relative "data" (which would let the
//     package-level `prices:fetch`, CWD = packages/price-feed, write a divergent,
//     commit-eligible ghost store) and never a hardcoded `/Users/...`. These
//     assertions live in this file because the review scope permits creating only
//     `inbox.test.ts`; they exercise `config.ts`'s `resolveWorkspaceDataDir`.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emitMarksToInbox } from "./inbox.js";
import { DEFAULT_CONFIG } from "./config.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "inbox-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("emitMarksToInbox / readInbox", () => {
  it("throws an attributed error (not a bare SyntaxError) for a corrupt inbox", async () => {
    const inbox = join(dir, "inbox.json");
    await writeFile(inbox, "{ this is not json");

    await expect(emitMarksToInbox(inbox, [])).rejects.toThrow(
      `Inbox ${inbox} is not valid JSON.`,
    );
  });

  it("throws an attributed error for an empty inbox file", async () => {
    const inbox = join(dir, "inbox.json");
    await writeFile(inbox, "");

    await expect(emitMarksToInbox(inbox, [])).rejects.toThrow(
      `Inbox ${inbox} is not valid JSON.`,
    );
  });

  it("still rejects a well-formed-but-non-array inbox with its own message", async () => {
    const inbox = join(dir, "inbox.json");
    await writeFile(inbox, "{}");

    await expect(emitMarksToInbox(inbox, [])).rejects.toThrow(
      `Inbox ${inbox} must be a JSON array of transactions.`,
    );
  });

  it("treats a missing inbox as empty (ENOENT → no-op) rather than erroring", async () => {
    const inbox = join(dir, "does-not-exist.json");
    // No fresh marks + no existing file: leaves nothing behind, returns 0.
    await expect(emitMarksToInbox(inbox, [])).resolves.toBe(0);
    expect(existsSync(inbox)).toBe(false);
  });
});

describe("DEFAULT_CONFIG.dataDir (accumulus sibling repo, CWD-independent)", () => {
  it("is an absolute path whose basename is data", () => {
    expect(isAbsolute(DEFAULT_CONFIG.dataDir)).toBe(true);
    expect(basename(DEFAULT_CONFIG.dataDir)).toBe("data");
  });

  it("defaults into the sibling accumulus repo, derived from homedir (never hardcoded, CWD-independent)", () => {
    // The grill decision: the durable log lives in `~/Dev/accumulus/data`, resolved
    // from os.homedir() so it holds on any machine/user — not a CWD-relative "data"
    // and not a hardcoded /Users/... path. (NUMISMA_DATA_DIR overrides this; not set
    // here, so DEFAULT_CONFIG reflects the pure default computed at import time.)
    expect(DEFAULT_CONFIG.dataDir).toBe(join(homedir(), "Dev", "accumulus", "data"));
  });
});
