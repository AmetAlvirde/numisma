// Atomicity regression (R3): an interrupted write must leave the PRIOR file
// byte-for-byte intact. We pre-write a file, then drive atomicWrite with an IO
// whose `rename` throws (simulating a crash between the temp write and the
// rename) and assert the original content survived — the temp+rename discipline
// never truncates the target.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { atomicWrite, type AtomicWriteIo } from "./atomic-write.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "atomic-write-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("atomicWrite", () => {
  it("replaces the file with the new contents on success", async () => {
    const file = join(dir, "store.jsonl");
    await writeFile(file, "OLD\n");
    await atomicWrite(file, "NEW\n");
    expect(await readFile(file, "utf8")).toBe("NEW\n");
  });

  it("leaves the prior file intact when the rename step is interrupted", async () => {
    const file = join(dir, "store.jsonl");
    await writeFile(file, "OLD\n");

    const { mkdir, writeFile: realWrite } = await import("node:fs/promises");
    const crashingIo: AtomicWriteIo = {
      mkdir,
      writeFile: realWrite,
      rename: () => Promise.reject(new Error("simulated crash before rename completes")),
    };

    await expect(atomicWrite(file, "NEW\n", crashingIo)).rejects.toThrow(/simulated crash/);
    // The interrupted write only touched the temp file; the target is unchanged.
    expect(await readFile(file, "utf8")).toBe("OLD\n");
  });
});
