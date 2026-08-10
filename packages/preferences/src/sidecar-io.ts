/**
 * The two mechanics EVERY sidecar in ADR-004's class needs, extracted because two
 * real call sites now need them: where the file lives, and how a line gets added to
 * it without losing one.
 *
 * Neither carries any FORMAT policy — no record shape, no validation, no vocabulary.
 * That is what makes this shareable at all: `orders.ts` and `plans.ts` disagree
 * about almost everything except "resolve under the data dir" and "append
 * atomically", and those two rules belong to the filesystem and to ADR-006, not to
 * either file's contract.
 */
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { resolveDataDir } from "@numisma/engine";

/**
 * Resolve `<dataDir>/<fileName>` under ADR-006's invariant: ABSOLUTE and
 * homedir-derived, NEVER CWD-relative.
 *
 * The three cases, and why each is what it is:
 *
 *   - **No override, or a blank/whitespace-only one** → the shared engine
 *     `resolveDataDir()` (the `NUMISMA_DATA_DIR` env knob, or the accumulus
 *     default). An explicit `""` MUST land here and not on `resolve("")`, which is
 *     the process's CWD: a durable, git-tracked artifact written relative to
 *     whatever directory a script happened to start in is a split-brain ledger
 *     waiting to happen, and `""` is exactly the value an unset shell variable
 *     expands to at the one call site most likely to produce it.
 *   - **An absolute override** → honored verbatim (normalized). Tests pass one.
 *   - **A relative override** → THROWN, loudly. It resolves differently depending
 *     on the working directory, so silently accepting it splits the store; the
 *     engine's `resolveDataDir` refuses the same value for the same reason and this
 *     resolver must not be the softer door around it.
 */
export function resolveSidecarPath(fileName: string, dataDir?: string): string {
  if (dataDir === undefined || dataDir.trim() === "") {
    return join(resolveDataDir(), fileName);
  }
  const raw = dataDir.trim();
  if (!isAbsolute(raw)) {
    throw new Error(
      `a sidecar data directory must be an absolute path (got "${raw}"). ` +
        `A relative value resolves differently depending on the working directory, ` +
        `so it is rejected to prevent a split-brain ledger.`,
    );
  }
  return join(resolve(raw), fileName);
}

/**
 * Per-process counter behind the temp file's unique name. Combined with the pid it
 * makes the name unique across BOTH concurrency axes — two processes, and two
 * overlapping `await`s inside one — which a fixed `.tmp` sibling is unique across
 * neither.
 */
let tempCounter = 0;

/**
 * A UNIQUE, same-directory temp sibling for one append.
 *
 * Same directory is the non-negotiable half: rename(2) is only atomic within a
 * filesystem, and atomicity is the sole reason this module writes through a temp at
 * all. Unique is the half a fixed `${path}.tmp` was missing — two concurrent appends
 * shared one temp name, so writer A's rename moved the file out from under writer B
 * and B's rename then failed ENOENT having already discarded its batch. The suffix
 * stays `.tmp` so accumulus's `/data/*.tmp` ignore rule still covers it.
 */
function tempPathFor(path: string): string {
  tempCounter += 1;
  return `${path}.${process.pid}.${tempCounter}.tmp`;
}

/**
 * Read a file that may not exist, mapping ENOENT to `undefined`.
 *
 * A DELIBERATE PRIVATE COPY OF `@numisma/event-store`'s `readOptional`, NOT DRIFT
 * (#198). Importing the canonical one would draw a permanent `@numisma/preferences
 * -> @numisma/event-store` edge — this package's only dependency today is
 * `@numisma/engine`. ADR-013 makes the sidecar's separation from the durable log
 * load-bearing: a sidecar line is recorded BESIDE `events.jsonl`, `parseEvent` never
 * sees one, and the module that writes a sidecar has no business knowing the event
 * store exists.
 *
 * The duplication is affordable because the helper carries ZERO POLICY — its entire
 * content is "ENOENT means absent", a rule of the filesystem rather than of any file
 * format. There is nothing here that can drift into disagreeing with the other copy.
 */
async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

/** How long a waiter sleeps between attempts to take the append lock. */
const LOCK_RETRY_MS = 20;
/** How long a waiter keeps trying before it REFUSES rather than write over a peer. */
const LOCK_TIMEOUT_MS = 10_000;

function isEexist(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

/**
 * Serialize the read-modify-write of a whole sidecar image, across processes.
 *
 * A unique temp name alone is NOT enough, and the difference is the whole point. The
 * append reads the existing image, adds to it and renames the result over the file —
 * so two overlapping appends can both read image `I`, and the second rename silently
 * DISCARDS the first one's batch. That is a lost record with no torn line, no error
 * and no trace: exactly the unattributable loss this module exists to prevent. The
 * CLIs that write here (`orders:import`, `orders:cancel`) are separate processes, so
 * an in-process mutex would not see each other.
 *
 * `open(…, "wx")` is the primitive: an EXCLUSIVE create is atomic in the kernel, so
 * the winner is decided by the filesystem and not by our own read of it.
 *
 * A holder that dies without releasing leaves the lock behind, and a waiter then
 * REFUSES after `LOCK_TIMEOUT_MS` with the path to delete. That is deliberate:
 * breaking a lock we cannot prove is stale would reintroduce the very race, and a
 * loud refusal an operator clears by hand is cheaper than a batch that vanishes.
 */
async function withAppendLock<T>(path: string, write: () => Promise<T>): Promise<T> {
  const lockPath = `${path}.lock`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    let handle;
    try {
      handle = await open(lockPath, "wx");
    } catch (error) {
      if (!isEexist(error)) {
        throw error;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `another writer holds ${lockPath} and did not release it within ` +
            `${LOCK_TIMEOUT_MS}ms; nothing was written. If no sidecar writer is running, ` +
            `delete that file by hand.`,
        );
      }
      await delay(LOCK_RETRY_MS);
      continue;
    }
    try {
      await handle.close();
      return await write();
    } finally {
      await rm(lockPath, { force: true });
    }
  }
}

/**
 * Genuinely APPEND-ONLY writer: add serialized lines without touching prior ones, to
 * the repo's own standard (`apps/tui/src/event-store.ts`).
 *
 * Build the full next image, write it to a sibling temp file, then `rename` over the
 * sidecar. rename(2) within a directory is atomic, so a crash mid-write leaves the
 * prior file intact and a reader never sees a truncated final line. This is O(n) in
 * the existing file rather than an O(1) `appendFile`, and that is the deliberate
 * price of the crash-atomicity — the event store's own comment rejects `appendFile`
 * "for exactly this."
 *
 * The `prefix` is the other half, and the half the plans-sidecar prototype omitted:
 * if the existing file's last line lacks its terminator, a suffix write CONCATENATES
 * the new record onto that torn line and BOTH are lost — unattributably, because
 * neither parses and neither is recoverable from the mangled result. Supplying the
 * missing newline REPAIRS the torn line instead of compounding it.
 *
 * Caller-side contract: `lines` are already serialized and already validated. This
 * function knows nothing about what a line means.
 */
export async function appendSidecarLines(path: string, lines: string[]): Promise<void> {
  if (lines.length === 0) {
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await withAppendLock(path, async () => {
    const body = lines.join("\n");
    const existing = await readOptional(path);
    const prefix = existing && existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    const next = `${existing ?? ""}${prefix}${body}\n`;
    const tempPath = tempPathFor(path);
    await writeFile(tempPath, next, "utf8");
    await rename(tempPath, path);
  });
}
