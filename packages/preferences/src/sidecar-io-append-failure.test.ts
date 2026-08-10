/**
 * THE FAILING APPEND — the one path on which `appendSidecarLines` can leave litter
 * behind, and the reason it needs a test file of its own.
 *
 * The append writes a unique temp sibling and `rename`s it over the sidecar. On the
 * happy path the rename CONSUMES the temp file, so a passing success case proves
 * exactly nothing about cleanup. That is not a hypothetical distinction: the reliable
 * suite carried a test titled "leaves no temp or lock sibling behind" that asserted
 * only the lock half, and the temp half leaked underneath its name.
 *
 * The window is between `writeFile` and `rename`, and no arrangement of real files
 * opens it — every candidate (a directory at the target, a read-only parent) fails the
 * READ or the LOCK first, before a temp file has been created, so the test passes
 * vacuously. So `rename` is mocked, and only `rename`: everything else is the real
 * filesystem in a real temp directory. This file exists separately because that mock
 * is module-wide and has no business near the format tests.
 *
 * What it locks: a failed append leaves NOTHING beside the sidecar. Without it,
 * `plans.jsonl.<pid>.<n>.tmp` accumulates one per failed attempt, forever and
 * invisibly — accumulus ignores `/data/*.tmp`, so nothing on the durability path would
 * ever surface it.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/** Flipped by a test to make the next `rename` fail the way a full volume would. */
let renameFails = false;

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: async (from: string, to: string) => {
      if (renameFails) {
        throw Object.assign(new Error("ENOSPC: no space left on device, rename"), {
          code: "ENOSPC",
        });
      }
      return actual.rename(from, to);
    },
  };
});

const { appendSidecarLines } = await import("./sidecar-io.js");

const createdDirs: string[] = [];

afterEach(async () => {
  renameFails = false;
  await Promise.all(createdDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  createdDirs.length = 0;
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(resolve(tmpdir(), "numisma-sidecar-io-"));
  createdDirs.push(dir);
  return dir;
}

describe("appendSidecarLines cleans up after ITSELF when the rename fails", () => {
  it("leaves no temp sibling behind, and does not create the sidecar", async () => {
    const dir = await tempDir();
    const path = join(dir, "plans.jsonl");
    renameFails = true;

    await expect(appendSidecarLines(path, ['{"kind":"noPlan"}'])).rejects.toThrow(/ENOSPC/);

    // The whole directory, not a guess at the temp's name: anything at all left here
    // is litter, including a name a future `tempPathFor` might choose instead.
    expect(await readdir(dir)).toEqual([]);
  });

  it("leaves the PRIOR image untouched — a failed append loses no committed record", async () => {
    const dir = await tempDir();
    const path = join(dir, "plans.jsonl");
    await appendSidecarLines(path, ['{"kind":"noPlan","n":1}']);

    renameFails = true;
    await expect(appendSidecarLines(path, ['{"kind":"noPlan","n":2}'])).rejects.toThrow(/ENOSPC/);

    // Crash-atomicity is the entire warrant for writing through a temp at all, so the
    // cleanup must not have cost it: the file still holds exactly what it held before.
    expect(await readdir(dir)).toEqual(["plans.jsonl"]);
    const { readFile } = await import("node:fs/promises");
    expect(await readFile(path, "utf8")).toBe('{"kind":"noPlan","n":1}\n');
  });

  it("releases the lock as well, so the next writer is not locked out", async () => {
    const dir = await tempDir();
    const path = join(dir, "plans.jsonl");
    renameFails = true;
    await expect(appendSidecarLines(path, ['{"kind":"noPlan"}'])).rejects.toThrow(/ENOSPC/);

    renameFails = false;
    await appendSidecarLines(path, ['{"kind":"noPlan","n":2}']);
    expect(await readdir(dir)).toEqual(["plans.jsonl"]);
  });
});
