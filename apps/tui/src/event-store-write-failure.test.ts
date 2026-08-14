/**
 * THE FAILING LOG-IMAGE WRITE — the one path on which `writeLogImage` can leave litter
 * behind, and the reason it needs a test file of its own.
 *
 * `writeLogImage` writes a unique temp sibling (`<log>.<pid>.<tick>.tmp`) and `rename`s
 * it over the log. On the happy path the rename CONSUMES the temp, so every passing
 * success case — including the four-writer concurrency case in `event-store.test.ts`,
 * where every writer succeeds — proves exactly nothing about the `catch { rm }`. Delete
 * the whole try/catch and those tests stay green.
 *
 * The window is between `writeFile` and `rename`, and no arrangement of real files opens
 * it: every candidate (a directory at the target, a read-only parent) fails BEFORE a temp
 * file exists, so the test would pass vacuously. So `rename` is mocked, and only
 * `rename`: everything else is the real filesystem in a real temp directory. This file is
 * separate because that mock is module-wide and has no business near the ingest tests.
 *
 * What it locks: a failed image write leaves NOTHING beside the log, and the caller sees
 * the TRUE cause. Without the first, `events.jsonl.<pid>.<n>.tmp` accumulates one
 * multi-megabyte orphan per failed attempt, forever and invisibly — accumulus ignores
 * `/data/*.tmp`, so nothing on the durability path would ever surface it. Without the
 * second, a cleanup that throws in turn (the dir went read-only, which is often WHY the
 * write failed) replaces "the log image failed to publish" with an `unlink` error naming
 * a temp file the operator has never heard of.
 *
 * Every fixture here is authored filler — no real event, price or balance.
 */
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/** Flipped by a test to make the next `rename` fail the way a full volume would. */
let renameFails = false;
/**
 * Flipped to make the CLEANUP fail too. Real-file arrangements cannot stage this
 * reliably — making the dir read-only mid-flight races the `writeFile` — and the
 * masking bug it targets is exactly a two-failure sequence, so both failures are
 * injected rather than provoked.
 */
let cleanupFails = false;

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
    rm: async (path: string, options?: Parameters<typeof actual.rm>[1]) => {
      if (cleanupFails) {
        throw Object.assign(new Error(`EACCES: permission denied, unlink '${path}'`), {
          code: "EACCES",
        });
      }
      return actual.rm(path, options);
    },
  };
});

const { writeLogImage } = await import("./event-store.js");

const PRIOR_IMAGE = '{"kind":"synthetic","n":1}\n';
const NEXT_IMAGE = '{"kind":"synthetic","n":1}\n{"kind":"synthetic","n":2}\n';

const createdDirs: string[] = [];

afterEach(async () => {
  renameFails = false;
  cleanupFails = false;
  for (const dir of createdDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  createdDirs.length = 0;
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(resolve(tmpdir(), "numisma-log-image-"));
  createdDirs.push(dir);
  return dir;
}

describe("writeLogImage cleans up after ITSELF when the write cannot land", () => {
  it("leaves no temp sibling behind, and does not create the log", async () => {
    const dir = await tempDir();
    const logPath = join(dir, "events.jsonl");
    renameFails = true;

    await expect(writeLogImage(logPath, NEXT_IMAGE)).rejects.toThrow(/ENOSPC/);

    // The whole directory, not a guess at the temp's name: anything at all left here is
    // litter, including a name a future revision of the scheme might choose instead.
    expect(await readdir(dir)).toEqual([]);
  });

  it("leaves the PRIOR image untouched — a failed write loses no committed line", async () => {
    const dir = await tempDir();
    const logPath = join(dir, "events.jsonl");
    await writeLogImage(logPath, PRIOR_IMAGE);

    renameFails = true;
    await expect(writeLogImage(logPath, NEXT_IMAGE)).rejects.toThrow(/ENOSPC/);

    // Crash-atomicity is the entire warrant for writing through a temp, so the cleanup
    // must not have cost it: the log still holds exactly what it held before.
    expect(await readdir(dir)).toEqual(["events.jsonl"]);
    expect(await readFile(logPath, "utf8")).toBe(PRIOR_IMAGE);
  });

  it("reports the WRITE's failure even when the cleanup cannot run either", async () => {
    // The masking scenario, as seen on a data dir that goes read-only mid-flight: the
    // rename fails, and the `rm` of the orphaned temp then fails EACCES in turn. `force:
    // true` swallows only ENOENT, so without a `.catch` the caller is handed
    // "EACCES: permission denied, unlink '…events.jsonl.<pid>.<n>.tmp'" and the true
    // cause — the durable log image failed to publish — is gone. On a spine contracted
    // to fail loud WITH the true cause, that is the operator pointed at the wrong file.
    const dir = await tempDir();
    const logPath = join(dir, "events.jsonl");
    renameFails = true;
    cleanupFails = true;

    await expect(writeLogImage(logPath, NEXT_IMAGE)).rejects.toThrow(/ENOSPC/);
    // And specifically NOT the cleanup's error wearing the failure's place.
    await expect(writeLogImage(logPath, NEXT_IMAGE)).rejects.not.toThrow(/EACCES/);
  });
});
