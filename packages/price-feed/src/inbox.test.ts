// Two regressions guarded here:
//
//  1. Attribution (finding 8): a corrupt/empty inbox file must fail LOUDLY and
//     NAMING the file — matching the tui's `Inbox … is not valid JSON.` — rather
//     than throwing a bare, unattributed `SyntaxError` from `JSON.parse`. The
//     parse now sits in its own try/catch inside `readInbox`, distinct from the
//     ENOENT→[] guard around `readFile`.
//
//  2. Workspace-anchored data dir (finding 7): `DEFAULT_CONFIG.dataDir` must be
//     an ABSOLUTE path anchored at the workspace root, not a CWD-relative "data".
//     A relative default lets the package-level `prices:fetch` (CWD =
//     packages/price-feed) write a divergent, commit-eligible ghost store. These
//     assertions live in this file because the review scope permits creating only
//     `inbox.test.ts`; they exercise `config.ts`'s `resolveWorkspaceDataDir`.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
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

describe("DEFAULT_CONFIG.dataDir (workspace-anchored, CWD-independent)", () => {
  it("is an absolute path whose basename is data", () => {
    expect(isAbsolute(DEFAULT_CONFIG.dataDir)).toBe(true);
    expect(basename(DEFAULT_CONFIG.dataDir)).toBe("data");
  });

  it("is anchored at the workspace root (the dir holding pnpm-workspace.yaml)", () => {
    // Its parent must contain the workspace marker — proving the store resolves
    // to the one real data plane regardless of the process CWD.
    expect(existsSync(join(dirname(DEFAULT_CONFIG.dataDir), "pnpm-workspace.yaml"))).toBe(true);
  });
});
