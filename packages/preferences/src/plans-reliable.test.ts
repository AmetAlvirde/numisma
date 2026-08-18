/**
 * The RELIABLE half of the `plans.jsonl` sidecar IO: the loader is TOTAL, the skip
 * taxonomy splits by INSTRUCTION, diagnostics never quote the file, the append is
 * genuine, and everything the writer accepts the loader reads back.
 *
 * Every plan here is SYNTHETIC and every figure invented and round. The fund's real
 * ladder is figures and must never enter this repository (ADR-007); these tests assert
 * PROPERTIES of the IO, never a real value. Nothing here touches the real accumulus
 * checkout — every path is a temp directory created and removed by this file.
 */
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveDataDir,
  type DcaLadderPlanRecord,
  type DcaTimePlanRecord,
  type LoadedPlanRecord,
  type PlanRecord,
} from "@numisma/engine";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendNoPlan,
  appendPlan,
  loadPlans,
  resolvePlansPath,
  unattendedPlansVerdict,
} from "./plans.js";

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(createdDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  createdDirs.length = 0;
});

/** Every entry in `dir`, sorted — the append's siblings, litter included. */
async function siblingsOf(dir: string): Promise<string[]> {
  return (await readdir(dir)).sort();
}

/** A throwaway `plans.jsonl` path under a temp data dir. The file does not exist yet. */
async function tempPath(): Promise<string> {
  const dir = await mkdtemp(resolve(tmpdir(), "numisma-plans-"));
  createdDirs.push(dir);
  const path = resolvePlansPath(resolve(dir, "data"));
  await mkdir(dirname(path), { recursive: true });
  return path;
}

/** Write a raw file image, bypassing the writer — the only way to test a corrupt file. */
async function writeRaw(path: string, image: string): Promise<void> {
  await writeFile(path, image, "utf8");
}

/**
 * SYNTHESIZED UUIDs, obviously fake and STABLE across runs — never generated at test
 * time, which would make a failure unreproducible. Every one of them is a canonical
 * UUID by shape (36 characters, hex and hyphens) and visibly authored by counting.
 */
const LADDER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_LADDER_ID = "00000000-0000-4000-8000-000000000002";

const LADDER: DcaLadderPlanRecord = {
  kind: "dcaLadder",
  id: LADDER_ID,
  positionId: "position-synthetic",
  effectiveAt: "2026-08-01",
  tierOrder: ["c2", "c1"],
  rungs: [
    { id: "rung-1", priceUsd: 100, sizeUsd: 10 },
    { id: "rung-2", priceUsd: 90, sizeUsd: 10 },
  ],
};

const TIMED: DcaTimePlanRecord = {
  kind: "dcaTime",
  positionId: "position-synthetic",
  effectiveAt: "2026-10-01",
  cadence: "weekly",
  anchorAt: "2026-01-01",
  amountUsd: 10,
  tierOrder: ["c2"],
};

describe("resolvePlansPath — ADR-006's invariant, at every door", () => {
  it("resolves ABSOLUTE with no argument, under the shared data dir", () => {
    const path = resolvePlansPath();
    expect(isAbsolute(path)).toBe(true);
    expect(path).toBe(join(resolveDataDir(), "plans.jsonl"));
  });

  it('an explicit "" is REFUSED — never CWD-relative, and no longer a silent default (#348)', () => {
    // `resolve("")` is the process's working directory, and `""` is exactly what an
    // unset shell variable expands to. A durable, git-tracked artifact written into
    // whatever directory a script started in is a split-brain ledger — so `""` must
    // never become a path at all. It used to fall through to the default instead;
    // that hid a MISCONFIGURED knob as an ABSENT one and aimed it at the real ledger.
    expect(() => resolvePlansPath("")).toThrow(
      /sidecar data directory must not be empty/,
    );
    expect(() => resolvePlansPath("   ")).toThrow(
      /sidecar data directory must not be empty/,
    );

    // The CWD point still holds, and the throw is now what enforces it: `""` yields no
    // path at all, so nothing it returns can be CWD-flavoured. Pinned as a value check
    // and not just as `toThrow`, because the failure mode this guards is a RETURN of
    // `resolve("")/plans.jsonl` — which a throw-shaped assertion alone would not name.
    let produced: string | undefined;
    try {
      produced = resolvePlansPath("");
    } catch {
      produced = undefined;
    }
    expect(produced).toBeUndefined();
    expect(produced).not.toBe(join(process.cwd(), "plans.jsonl"));
  });

  it("a GENUINELY absent override still defaults — the refusal must not swallow `undefined`", () => {
    expect(resolvePlansPath(undefined)).toBe(join(resolveDataDir(), "plans.jsonl"));
    expect(() => resolvePlansPath()).not.toThrow();
  });

  it("the blank refusal names the consequence AND the two ways out", () => {
    // The caller must be able to tell the blank case apart from the absent one: the
    // defect was that a misconfigured argument was indistinguishable from no argument.
    let message = "";
    try {
      resolvePlansPath("");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/not .?unset.?/i);
    expect(message).toMatch(/REAL default ledger/);
    expect(message).toMatch(/Pass no data directory/);
    expect(message).toMatch(/absolute path/);
  });

  it("honors an ABSOLUTE override verbatim", () => {
    expect(resolvePlansPath(resolve("/synthetic/data"))).toBe(
      resolve("/synthetic/data/plans.jsonl"),
    );
  });

  it("THROWS LOUDLY on a relative override rather than splitting the store", () => {
    expect(() => resolvePlansPath("data")).toThrow(/absolute/i);
    expect(() => resolvePlansPath("./data")).toThrow(/absolute/i);
    expect(() => resolvePlansPath("../accumulus/data")).toThrow(/absolute/i);
  });
});

describe("loadPlans is TOTAL — it never throws, on any input", () => {
  it("an ABSENT file is `loaded` with empty buckets — the normal starting state", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "numisma-plans-"));
    createdDirs.push(dir);
    const loaded = await loadPlans(resolvePlansPath(resolve(dir, "never-created")));
    expect(loaded.load.status).toBe("loaded");
    expect(loaded.plans).toEqual([]);
    expect(loaded.skipped).toEqual([]);
  });

  it("any OTHER read error is `load-failed` with empty buckets, and does not throw", async () => {
    // A directory where a file should be: readFile fails with EISDIR, which is a
    // stand-in for the real cases (permissions, a half-mounted data directory).
    const dir = await mkdtemp(resolve(tmpdir(), "numisma-plans-"));
    createdDirs.push(dir);
    const path = resolvePlansPath(resolve(dir, "data"));
    await mkdir(path, { recursive: true });

    const loaded = await loadPlans(path);
    expect(loaded.load.status).toBe("load-failed");
    if (loaded.load.status === "load-failed") {
      expect(loaded.load.message).not.toBe("");
    }
    // The distinction is load-bearing: empty buckets WITHOUT the outcome would assert
    // "this fund has no plans" when the truth is "the file could not be read".
    expect(loaded.plans).toEqual([]);
    expect(loaded.skipped).toEqual([]);
  });
});

describe("file-shape edges — forgiving of shape, strict about content", () => {
  it("an EMPTY file loads clean", async () => {
    const path = await tempPath();
    await writeRaw(path, "");
    const loaded = await loadPlans(path);
    expect(loaded.load.status).toBe("loaded");
    expect(loaded.plans).toEqual([]);
    expect(loaded.skipped).toEqual([]);
  });

  it("CRLF terminators read as records, not as corrupt lines", async () => {
    const path = await tempPath();
    await writeRaw(path, `${JSON.stringify(LADDER)}\r\n${JSON.stringify(TIMED)}\r\n`);
    const loaded = await loadPlans(path);
    expect(loaded.skipped).toEqual([]);
    expect(loaded.plans.map((plan) => plan.effectiveAt)).toEqual(["2026-08-01", "2026-10-01"]);
  });

  it("a leading BOM does not make line 1 look corrupt", async () => {
    // An editor prepends it invisibly. A loader that did not strip it would report the
    // FIRST line of a perfectly good hand-authored file as broken.
    const path = await tempPath();
    await writeRaw(path, `﻿${JSON.stringify(LADDER)}\n`);
    const loaded = await loadPlans(path);
    expect(loaded.skipped).toEqual([]);
    expect(loaded.plans).toHaveLength(1);
    expect(loaded.plans[0]?.line).toBe(1);
  });

  it("a WHITESPACE-ONLY line is tolerated, not skipped", async () => {
    const path = await tempPath();
    await writeRaw(path, `${JSON.stringify(LADDER)}\n   \n${JSON.stringify(TIMED)}\n`);
    const loaded = await loadPlans(path);
    expect(loaded.skipped).toEqual([]);
    // The line NUMBERS still count it — they are the file's, not the reader's.
    expect(loaded.plans.map((plan) => plan.line)).toEqual([1, 3]);
  });

  it("valid JSON that is NOT an object is an `invalid` skip", async () => {
    const path = await tempPath();
    await writeRaw(path, '["dcaLadder"]\n42\n"noPlan"\n');
    const loaded = await loadPlans(path);
    expect(loaded.plans).toEqual([]);
    expect(loaded.skipped.map((skip) => [skip.line, skip.reason])).toEqual([
      [1, "invalid"],
      [2, "invalid"],
      [3, "invalid"],
    ]);
  });

  it("a line that is not JSON at all is an `invalid` skip", async () => {
    const path = await tempPath();
    await writeRaw(path, `{"kind":"dcaLadder",\n${JSON.stringify(TIMED)}\n`);
    const loaded = await loadPlans(path);
    expect(loaded.plans).toHaveLength(1);
    expect(loaded.skipped).toEqual([{ line: 1, reason: "invalid", detail: "line is not JSON" }]);
  });
});

describe("the envelope is parsed FIRST, so a broken body is still attributable", () => {
  it("attributes a malformed BODY to its position and date", async () => {
    const path = await tempPath();
    await writeRaw(
      path,
      `${JSON.stringify({ ...LADDER, rungs: [] })}\n`,
    );
    const loaded = await loadPlans(path);
    expect(loaded.plans).toEqual([]);
    // Without envelope-first parsing this skip would name no position at all, and the
    // selector could not tell "this position is unreadable" from "the fund is".
    expect(loaded.skipped[0]?.positionId).toBe("position-synthetic");
    expect(loaded.skipped[0]?.effectiveAt).toBe("2026-08-01");
    expect(loaded.skipped[0]?.reason).toBe("invalid");
  });

  it("attributes an UNSUPPORTED kind to its position and date too", async () => {
    const path = await tempPath();
    await writeRaw(
      path,
      `${JSON.stringify({ kind: "dcaPyramid", positionId: "position-future", effectiveAt: "2026-08-01" })}\n`,
    );
    const loaded = await loadPlans(path);
    expect(loaded.skipped[0]).toMatchObject({
      line: 1,
      reason: "unsupported",
      positionId: "position-future",
      effectiveAt: "2026-08-01",
    });
  });

  it("a plan naming an UNBORN position is LEGAL — nothing here validates against the fold", async () => {
    const path = await tempPath();
    await appendPlan(path, { ...LADDER, positionId: "position-not-yet-opened" });
    const loaded = await loadPlans(path);
    expect(loaded.skipped).toEqual([]);
    expect(loaded.plans[0]?.positionId).toBe("position-not-yet-opened");
  });
});

describe("skips split by INSTRUCTION: `unsupported` = pull, `invalid` = fix the line", () => {
  it("an unrecognized `kind` is `unsupported`, never `invalid`", async () => {
    const path = await tempPath();
    await writeRaw(
      path,
      `${JSON.stringify({ kind: "dcaPyramid", positionId: "p", effectiveAt: "2026-08-01" })}\n`,
    );
    const loaded = await loadPlans(path);
    expect(loaded.skipped[0]?.reason).toBe("unsupported");
    expect(loaded.skipped[0]?.detail).toMatch(/pull/);
  });

  it("an unrecognized `cadence` is `unsupported` — the same rule, one level down", async () => {
    const path = await tempPath();
    await writeRaw(path, `${JSON.stringify({ ...TIMED, cadence: "fortnightly" })}\n`);
    const loaded = await loadPlans(path);
    expect(loaded.skipped[0]?.reason).toBe("unsupported");
    expect(loaded.skipped[0]?.detail).toMatch(/pull/);
  });

  it("a non-strict `effectiveAt` is `invalid` — the line is corrupt, not the checkout", async () => {
    const path = await tempPath();
    await writeRaw(
      path,
      [
        JSON.stringify({ ...LADDER, effectiveAt: "08/10/2026" }),
        JSON.stringify({ ...LADDER, effectiveAt: "2026-7-1" }),
        JSON.stringify({ ...LADDER, effectiveAt: "2026-02-30" }),
        JSON.stringify({ ...LADDER, effectiveAt: "2026-01-31" }),
      ].join("\n") + "\n",
    );
    const loaded = await loadPlans(path);
    expect(loaded.skipped.map((skip) => [skip.line, skip.reason])).toEqual([
      [1, "invalid"],
      [2, "invalid"],
      [3, "invalid"],
    ]);
    // The legitimate end-of-month date survives — strictness must not cost real dates.
    expect(loaded.plans.map((plan) => plan.effectiveAt)).toEqual(["2026-01-31"]);
  });

  it("an unrecognized `tierOrder` entry is `invalid`, NOT `unsupported`", async () => {
    // `tierOrder` is CLOSED where `kind` and `cadence` are open: it is consumed to
    // route capital, so an unrecognized tier is unusable, not merely unreadable.
    const path = await tempPath();
    await writeRaw(path, `${JSON.stringify({ ...LADDER, tierOrder: ["c1", "c9"] })}\n`);
    const loaded = await loadPlans(path);
    expect(loaded.skipped[0]?.reason).toBe("invalid");
    expect(loaded.skipped[0]?.detail).not.toMatch(/pull/);
  });

  it("a repeated tier, an empty rung list and a non-positive figure are all `invalid`", async () => {
    const path = await tempPath();
    await writeRaw(
      path,
      [
        JSON.stringify({ ...LADDER, tierOrder: ["c1", "c1"] }),
        JSON.stringify({ ...LADDER, rungs: [] }),
        JSON.stringify({ ...LADDER, rungs: [{ id: "r", priceUsd: 0, sizeUsd: 10 }] }),
        JSON.stringify({ ...LADDER, rungs: [{ id: "r", priceUsd: 10, sizeUsd: null }] }),
        JSON.stringify({
          ...LADDER,
          rungs: [
            { id: "same", priceUsd: 10, sizeUsd: 10 },
            { id: "same", priceUsd: 20, sizeUsd: 10 },
          ],
        }),
        JSON.stringify({ ...TIMED, amountUsd: -5 }),
        JSON.stringify({ ...TIMED, anchorAt: "2026-02-30" }),
      ].join("\n") + "\n",
    );
    const loaded = await loadPlans(path);
    expect(loaded.plans).toEqual([]);
    expect(loaded.skipped).toHaveLength(7);
    expect(loaded.skipped.every((skip) => skip.reason === "invalid")).toBe(true);
  });
});

/**
 * THE LADDER'S OWN IDENTITY, AND THE DEGENERATE DECLARATION (#286).
 *
 * A ladder is keyed for supersession by `positionId + effectiveAt`, which gives a
 * superseded ladder no stable identity a later record can point at and leaves rung ids
 * unique only WITHIN one plan. `id` is that identity — a UUID, a JOIN KEY and never a
 * label — and the two guards below are what make it usable as one: a duplicated `id`
 * makes two ladders indistinguishable to a fill that names one, and two rungs at the
 * same price make the price-match FALLBACK ambiguous by construction.
 *
 * MUTATION-CHECKED, each guard against its own assertions (fix reverted, suite re-run,
 * fix restored):
 *
 *   - `M-A` drop the `isRenderableId(value.id)` gate         → "an id that is empty …"
 *   - `M-B` drop the cross-file uniqueness check             → "two lines sharing an id …"
 *   - `M-C` name no id in the duplicate detail               → the `toContain(LADDER_ID)`
 *   - `M-D` drop the duplicate-`priceUsd` check in `rungsProblem` → "two rungs at one price …"
 *   - `M-E` name no price in that detail                     → the `toContain("90")`
 *
 * Each mutation made exactly the named assertion fail, and for the right reason: `M-A`
 * loaded a ladder whose id nothing would render, `M-B` loaded both duplicate lines,
 * `M-D` loaded the collided ladder, and `M-C`/`M-E` refused correctly while leaving the
 * operator no way to find WHICH declaration to repair.
 */
describe("a ladder declares its own id, and no two rungs share a price", () => {
  it("carries the id through the loader, and a canonical UUID passes every check", async () => {
    const path = await tempPath();
    await writeRaw(path, `${JSON.stringify(LADDER)}\n`);
    const loaded = await loadPlans(path);
    expect(loaded.skipped).toEqual([]);
    expect(loaded.plans).toHaveLength(1);
    expect(loaded.plans[0]).toMatchObject({ kind: "dcaLadder", id: LADDER_ID });
    // 36 characters, hex and hyphens — the EXPECTED form, and it clears the same bound
    // and control-character gates `positionId` is held to.
    expect(LADDER_ID).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  });

  it("an id that is empty, over-long or control-bearing is `invalid`", async () => {
    const path = await tempPath();
    await writeRaw(
      path,
      [
        JSON.stringify({ ...LADDER, id: "" }),
        JSON.stringify({ ...LADDER, id: "u".repeat(65) }),
        JSON.stringify({ ...LADDER, id: "one\ntwo" }),
        JSON.stringify({ ...LADDER, id: 42 }),
      ].join("\n") + "\n",
    );
    const loaded = await loadPlans(path);
    expect(loaded.plans).toEqual([]);
    expect(loaded.skipped.map((skip) => skip.line)).toEqual([1, 2, 3, 4]);
    expect(loaded.skipped.every((skip) => skip.reason === "invalid")).toBe(true);
    // The line is still ATTRIBUTABLE: the envelope was read before the body, so the
    // operator is told whose declaration is broken even though its id is not.
    expect(loaded.skipped[0]?.positionId).toBe("position-synthetic");
  });

  it("two lines sharing an id are a degenerate declaration — the second is refused", async () => {
    const path = await tempPath();
    await writeRaw(
      path,
      [
        JSON.stringify(LADDER),
        JSON.stringify({ ...LADDER, effectiveAt: "2026-09-01" }),
        JSON.stringify({ ...LADDER, id: OTHER_LADDER_ID, effectiveAt: "2026-10-01" }),
      ].join("\n") + "\n",
    );
    const loaded = await loadPlans(path);
    // FIRST WINS, and only the repeat is refused: an append-only file's earlier line is
    // the one every existing reference already points at.
    expect(loaded.plans.map((plan) => plan.line)).toEqual([1, 3]);
    expect(loaded.skipped).toHaveLength(1);
    expect(loaded.skipped[0]?.line).toBe(2);
    expect(loaded.skipped[0]?.reason).toBe("invalid");
    // NAMING THE ID IS THE POINT — a refusal the operator cannot locate is a refusal
    // they cannot act on, and the id has already cleared the renderability gate.
    expect(loaded.skipped[0]?.detail).toContain(LADDER_ID);
  });

  it("two rungs at one price are refused, and the detail names the duplicated price", async () => {
    const path = await tempPath();
    await writeRaw(
      path,
      `${JSON.stringify({
        ...LADDER,
        rungs: [
          { id: "rung-1", priceUsd: 100, sizeUsd: 10 },
          { id: "rung-2", priceUsd: 90, sizeUsd: 10 },
          { id: "rung-3", priceUsd: 90, sizeUsd: 20 },
        ],
      })}\n`,
    );
    const loaded = await loadPlans(path);
    expect(loaded.plans).toEqual([]);
    expect(loaded.skipped[0]?.reason).toBe("invalid");
    expect(loaded.skipped[0]?.detail).toContain("90");
  });

  it("a ladder of eight DISTINCT prices still loads, and `pnpm plans` still exits 0", async () => {
    // The live fund's ladder is eight rungs at eight distinct prices. This one is
    // SYNTHESIZED to that SHAPE — round invented figures, never the fund's — because
    // what the guard must not do is refuse the declaration the operator actually holds.
    const path = await tempPath();
    await writeRaw(
      path,
      `${JSON.stringify({
        ...LADDER,
        rungs: [100, 90, 80, 70, 60, 50, 40, 30].map((priceUsd, index) => ({
          id: `rung-${index + 1}`,
          priceUsd,
          sizeUsd: 10 * (index + 1),
        })),
      })}\n`,
    );
    const loaded = await loadPlans(path);
    expect(loaded.skipped).toEqual([]);
    expect(loaded.plans).toHaveLength(1);
    expect(unattendedPlansVerdict(loaded)).toEqual({ exitCode: 0, messages: [] });
  });

  it("REFUSES to append a ladder whose id its own loader would not render", async () => {
    const path = await tempPath();
    await expect(appendPlan(path, { ...LADDER, id: "one\ntwo" })).rejects.toThrow(/id/);
  });
});

describe("M3 — diagnostics are PROSE-ONLY and never quote the line", () => {
  it("names an arbitrary `kind` only as a bounded sanitized token, never in the prose", async () => {
    // The unknown-kind path is the one where `kind` is ARBITRARY file content; on the
    // body-malformed path it is already one of three literals. So this is where an
    // implementation that interpolates would leak, and this is where it is locked.
    const path = await tempPath();
    const hostileKind =
      'dcaLadder-v2 sizeUsd=1234.56 priceUsd=98765.43\n{"kind":"forged","positionId":"p"}' +
      "x".repeat(4096);
    await writeRaw(
      path,
      `${JSON.stringify({ kind: hostileKind, positionId: "position-synthetic", effectiveAt: "2026-08-01" })}\n`,
    );

    const loaded = await loadPlans(path);
    const skip = loaded.skipped[0];
    expect(skip?.reason).toBe("unsupported");

    // The prose is FIXED. Asserting equality — not a `not.toContain` — is what makes
    // this fail against ANY implementation that interpolates, including one that
    // interpolates a value this test did not think to plant.
    expect(skip?.detail).toBe(
      "unrecognized plan kind; this checkout may be older than the file — pull and retry",
    );
    expect(skip?.detail).not.toContain("1234.56");
    expect(skip?.detail).not.toContain("98765.43");

    // The raw value rides in a typed field: bounded, and stripped of anything that
    // could forge a second log line.
    expect(skip?.kindToken).toBe("dcaLadder-v2sizeUsd12345");
    expect(skip?.kindToken?.length).toBeLessThanOrEqual(24);
    expect(skip?.kindToken).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("carries no `kindToken` at all when nothing token-shaped survives sanitization", async () => {
    const path = await tempPath();
    await writeRaw(
      path,
      `${JSON.stringify({ kind: "€€ ¥¥", positionId: "p", effectiveAt: "2026-08-01" })}\n`,
    );
    const loaded = await loadPlans(path);
    expect(loaded.skipped[0]?.reason).toBe("unsupported");
    expect(loaded.skipped[0]?.kindToken).toBeUndefined();
  });

  /**
   * `positionId` RIDES THE SAME ENVELOPE AS `kind`, and the sanitizing argument above
   * applies to it whole: unbounded operator-authored content that could hold a newline
   * forging a second row. It travels further than `kind` does — into a `PlanRow` and
   * onto the desk page, padded into a column — so it is the field where a forged line
   * would actually be READ, on the exact page the runbook says to check against.
   *
   * It is VALIDATED rather than sanitized because it is identity: a mangled id would
   * attribute a plan to the wrong position or to none, silently, which is worse than
   * the leak. So an unsafe id makes the line corrupt AND unattributable — the loader
   * will not render an id it will not vouch for.
   */
  it("an id holding a newline is corrupt and UNATTRIBUTABLE, never a forged row", async () => {
    const path = await tempPath();
    const forging = 'position-synthetic\n  pos-forged   active   ladder, 4 rungs @ 2026-08-01';
    await writeRaw(
      path,
      `${JSON.stringify({ kind: "noPlan", positionId: forging, effectiveAt: "2026-08-01" })}\n`,
    );

    const loaded = await loadPlans(path);
    expect(loaded.skipped[0]?.reason).toBe("invalid");
    // The id is withheld from the skip, so nothing downstream can render or attribute
    // by it. An unattributable line belongs to no position — which is the honest bucket.
    expect(loaded.skipped[0]?.positionId).toBeUndefined();
    expect(loaded.skipped[0]?.detail).not.toContain("pos-forged");
    expect(loaded.plans).toHaveLength(0);
  });

  it("bounds the id's length, because one long id sets the column width for every row", async () => {
    const path = await tempPath();
    const loaded = await loadPlans(path);
    expect(loaded.plans).toHaveLength(0);

    await writeRaw(
      path,
      [
        JSON.stringify({ kind: "noPlan", positionId: "p".repeat(65), effectiveAt: "2026-08-01" }),
        JSON.stringify({ kind: "noPlan", positionId: "p".repeat(64), effectiveAt: "2026-08-01" }),
      ].join("\n") + "\n",
    );

    const reloaded = await loadPlans(path);
    // 64 is the boundary and it is INCLUSIVE — the bound rejects the absurd, not the
    // merely long, so a legitimate id is never quietly turned into a corrupt line.
    expect(reloaded.skipped.map((skip) => skip.line)).toEqual([1]);
    expect(reloaded.plans.map((plan) => plan.positionId)).toEqual(["p".repeat(64)]);
  });

  it("REFUSES to append an id its own loader would not render", async () => {
    // The writer and the reader are the same code (M5), so the rule binds both ends
    // with no second list to keep in sync. Asserted rather than assumed.
    const path = await tempPath();
    await expect(
      appendNoPlan(path, { positionId: "position\nsynthetic", effectiveAt: "2026-08-01" }),
    ).rejects.toThrow(/positionId/);
  });

  it("no skip detail anywhere quotes the body of the line it describes", async () => {
    const path = await tempPath();
    await writeRaw(
      path,
      [
        // Invalid for a reason that has NOTHING to do with the figures it carries —
        // an unknown tier — so any figure in a diagnostic came from the line.
        JSON.stringify({
          ...LADDER,
          tierOrder: ["c9"],
          rungs: [{ id: "r", priceUsd: 424242, sizeUsd: 313131 }],
        }),
        JSON.stringify({ ...TIMED, cadence: "fortnightly", amountUsd: 515151 }),
        JSON.stringify({ ...TIMED, amountUsd: 626262, anchorAt: "nope" }),
      ].join("\n") + "\n",
    );
    const loaded = await loadPlans(path);
    expect(loaded.skipped).toHaveLength(3);
    for (const skip of loaded.skipped) {
      for (const figure of ["424242", "313131", "515151", "626262"]) {
        expect(skip.detail).not.toContain(figure);
      }
    }
  });
});

describe("M5 — the round-trip invariant: what the writer accepts, the loader reads back", () => {
  it("reads back EVERY kind byte-for-byte through the loader's own predicates", async () => {
    const path = await tempPath();
    const written: PlanRecord[] = [
      LADDER,
      { kind: "noPlan", positionId: "position-synthetic", effectiveAt: "2026-09-01", reason: "paused" },
      TIMED,
      { kind: "noPlan", positionId: "position-synthetic", effectiveAt: "2026-11-01" },
    ];
    for (const record of written) {
      await appendPlan(path, record);
    }

    const loaded = await loadPlans(path);
    expect(loaded.load.status).toBe("loaded");
    expect(loaded.skipped).toEqual([]);
    // The read shape is the write shape PLUS the read-side line stamp, and nothing else.
    expect(loaded.plans).toEqual(
      written.map((record, index) => ({ ...record, line: index + 1 })),
    );
  });

  it("REFUSES to write a record its own loader could not read back", async () => {
    const path = await tempPath();
    // An append-only file is the one place where writing something unreadable is
    // unrecoverable, so the refusal is loud and nothing lands.
    await expect(
      appendPlan(path, { ...LADDER, effectiveAt: "08/10/2026" }),
    ).rejects.toThrow(/could not read back/);
    await expect(appendPlan(path, { ...LADDER, rungs: [] })).rejects.toThrow(/could not read back/);
    await expect(
      appendPlan(path, { ...TIMED, tierOrder: ["c1", "c1"] }),
    ).rejects.toThrow(/could not read back/);

    const loaded = await loadPlans(path);
    expect(loaded.plans).toEqual([]);
  });

  it("NEVER stamps the read-side `line` into the file", async () => {
    // `LoadedPlanRecord` is structurally a `PlanRecord`, so round-tripping a loaded
    // record through the writer typechecks perfectly. The serializer is field-by-field
    // precisely so that call cannot persist a second, immediately-stale identity.
    const path = await tempPath();
    const loadedShape: LoadedPlanRecord = { ...LADDER, line: 7 };
    await appendPlan(path, loadedShape);

    const image = await readFile(path, "utf8");
    expect(image).not.toContain('"line"');
    const reloaded = await loadPlans(path);
    expect(reloaded.plans[0]?.line).toBe(1);
  });

  it("appendNoPlan takes ONE OBJECT, so a positionId/effectiveAt swap is unrepresentable", async () => {
    const path = await tempPath();
    await appendNoPlan(path, {
      positionId: "position-synthetic",
      effectiveAt: "2026-09-01",
      reason: "paused",
    });
    const loaded = await loadPlans(path);
    expect(loaded.plans).toEqual([
      {
        kind: "noPlan",
        positionId: "position-synthetic",
        effectiveAt: "2026-09-01",
        reason: "paused",
        line: 1,
      },
    ]);
  });
});

describe("M4 — the append is GENUINE, to the event store's standard", () => {
  it("appending after a terminator-less final line yields TWO readable records", async () => {
    // The prototype's suffix-only `appendFile` CONCATENATED onto the torn line and
    // lost both records unattributably. The repair is supplying the missing newline.
    const path = await tempPath();
    await writeRaw(path, JSON.stringify(LADDER)); // no trailing "\n"

    await appendPlan(path, TIMED);

    const loaded = await loadPlans(path);
    expect(loaded.skipped).toEqual([]);
    expect(loaded.plans).toHaveLength(2);
    expect(loaded.plans.map((plan) => plan.effectiveAt)).toEqual(["2026-08-01", "2026-10-01"]);
  });

  it("preserves EVERY prior record across successive appends", async () => {
    const path = await tempPath();
    await appendPlan(path, LADDER);
    await appendPlan(path, TIMED);
    await appendNoPlan(path, { positionId: "position-synthetic", effectiveAt: "2026-12-01" });

    const loaded = await loadPlans(path);
    expect(loaded.plans.map((plan) => plan.kind)).toEqual(["dcaLadder", "dcaTime", "noPlan"]);
  });

  it("leaves no temp or lock sibling behind, and creates the data directory", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "numisma-plans-"));
    createdDirs.push(dir);
    const path = resolvePlansPath(resolve(dir, "nested", "data"));

    await appendPlan(path, LADDER);

    const loaded = await loadPlans(path);
    expect(loaded.plans).toHaveLength(1);
    await expect(readFile(`${path}.lock`, "utf8")).rejects.toThrow();
    // The TEMP half of this test's own title, which it used to leave uncovered.
    expect(await siblingsOf(dirname(path))).toEqual(["plans.jsonl"]);
  });

  // The FAILING append — the only path that can leak, since a successful `rename`
  // consumes the temp file — needs `rename` itself to fail, which no arrangement of
  // real files induces without failing the read first. It lives in
  // `sidecar-io-append-failure.test.ts`, which mocks that one call.
});

describe("the unattended-caller exit policy", () => {
  it("exits 0 with nothing to say on a clean load", async () => {
    const path = await tempPath();
    await appendPlan(path, LADDER);
    const verdict = unattendedPlansVerdict(await loadPlans(path));
    expect(verdict).toEqual({ exitCode: 0, messages: [] });
  });

  it("exits 0 on an ABSENT file — not authoring plans yet is not a failure", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "numisma-plans-"));
    createdDirs.push(dir);
    const verdict = unattendedPlansVerdict(
      await loadPlans(resolvePlansPath(resolve(dir, "never-created"))),
    );
    expect(verdict.exitCode).toBe(0);
  });

  it("warns loudly AND exits NON-ZERO on `load-failed`", async () => {
    // The warrant is the daily-fetch script's own finding: a launchd job's stderr goes
    // to an unread log, so a "loud warning" reaches no one. An exit code is a CHECKED
    // value; a warning is a thing someone must happen to read.
    const dir = await mkdtemp(resolve(tmpdir(), "numisma-plans-"));
    createdDirs.push(dir);
    const path = resolvePlansPath(resolve(dir, "data"));
    await mkdir(path, { recursive: true });

    const verdict = unattendedPlansVerdict(await loadPlans(path));
    expect(verdict.exitCode).toBe(1);
    expect(verdict.messages.length).toBeGreaterThan(0);
  });

  it("exits NON-ZERO on ANY skip, including an `unsupported` one", async () => {
    const path = await tempPath();
    await writeRaw(
      path,
      `${JSON.stringify({ kind: "dcaPyramid", positionId: "p", effectiveAt: "2026-08-01" })}\n`,
    );
    const verdict = unattendedPlansVerdict(await loadPlans(path));
    expect(verdict.exitCode).toBe(1);
    expect(verdict.messages).toHaveLength(1);
    expect(verdict.messages[0]).toMatch(/line 1/);
  });

  it("its messages are prose-only — no line content reaches the terminal", async () => {
    const path = await tempPath();
    await writeRaw(
      path,
      `${JSON.stringify({
        ...LADDER,
        rungs: [
          { id: "same", priceUsd: 777777, sizeUsd: 888888 },
          { id: "same", priceUsd: 777777, sizeUsd: 888888 },
        ],
      })}\n`,
    );
    const verdict = unattendedPlansVerdict(await loadPlans(path));
    expect(verdict.exitCode).toBe(1);
    for (const message of verdict.messages) {
      expect(message).not.toContain("777777");
      expect(message).not.toContain("888888");
    }
  });
});
