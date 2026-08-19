// Shared-resolver contract/drift test. The `NUMISMA_DATA_DIR` resolution body was
// once byte-identical duplicated across the tui event-store and the price-feed
// config, each carrying "keep in sync" comments. Now there is ONE copy in the
// engine (`resolveDataDir`) that every plane imports, so cross-plane drift is
// structurally impossible — but this enumerated-input contract is retained as the
// anti-regression guard: if anyone changes the `~`-expansion, the UNSET-ONLY
// fall-through, the blank-value refusal (#348 — a set-but-empty knob is a
// misconfigured one, not an absent one), the absolute-normalization, or the
// relative-rejection, it fails here.
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDataDir } from "./data-dir.js";
import { assertDataDirContract } from "./data-dir-contract.testkit.js";

const ACCUMULUS_DEFAULT = join(homedir(), "Dev", "accumulus", "data");

describe("resolveDataDir — the single durable-ledger data-root resolver", () => {
  it("falls through to the absolute, homedir-derived accumulus default when unset", () => {
    expect(resolveDataDir({})).toBe(ACCUMULUS_DEFAULT);
  });

  it("REFUSES an empty value rather than treating it as unset (#348)", () => {
    expect(() => resolveDataDir({ NUMISMA_DATA_DIR: "" })).toThrow(
      /NUMISMA_DATA_DIR is set to an empty value/,
    );
  });

  it("REFUSES a whitespace-only value rather than treating it as unset (#348)", () => {
    expect(() => resolveDataDir({ NUMISMA_DATA_DIR: "  " })).toThrow(
      /NUMISMA_DATA_DIR is set to an empty value/,
    );
    expect(() => resolveDataDir({ NUMISMA_DATA_DIR: "\t\n" })).toThrow(
      /NUMISMA_DATA_DIR is set to an empty value/,
    );
  });

  it("the blank refusal names the consequence AND the two ways out", () => {
    // An operator reading this must be able to tell the blank case apart from the
    // unset case: the whole defect was that a misconfigured knob was indistinguishable
    // from an absent one, and the message is where that distinction becomes visible.
    let message = "";
    try {
      resolveDataDir({ NUMISMA_DATA_DIR: "" });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/not .?unset.?/i);
    expect(message).toMatch(/REAL default ledger/);
    expect(message).toMatch(/Unset NUMISMA_DATA_DIR/);
    expect(message).toMatch(/absolute path/);
  });

  it("a GENUINELY unset knob still defaults — blank refusal must not swallow `undefined`", () => {
    expect(resolveDataDir({})).toBe(ACCUMULUS_DEFAULT);
    expect(resolveDataDir({ NUMISMA_DATA_DIR: undefined })).toBe(ACCUMULUS_DEFAULT);
    expect(() => resolveDataDir({})).not.toThrow();
  });

  it("expands a bare `~` to the home directory", () => {
    expect(resolveDataDir({ NUMISMA_DATA_DIR: "~" })).toBe(resolve(homedir()));
  });

  it("expands `~/x` against the home directory", () => {
    expect(resolveDataDir({ NUMISMA_DATA_DIR: "~/x" })).toBe(
      resolve(join(homedir(), "x")),
    );
  });

  it("normalizes an absolute path via resolve()", () => {
    const absolute = join(homedir(), "somewhere", "else");
    expect(resolveDataDir({ NUMISMA_DATA_DIR: absolute })).toBe(resolve(absolute));
  });

  it("rejects a relative value loudly (D6) — a bare `data` cannot split-brain the ledger", () => {
    expect(() => resolveDataDir({ NUMISMA_DATA_DIR: "data" })).toThrow(
      /NUMISMA_DATA_DIR must be an absolute path/,
    );
    expect(() => resolveDataDir({ NUMISMA_DATA_DIR: "./data" })).toThrow(
      /NUMISMA_DATA_DIR must be an absolute path/,
    );
    expect(() => resolveDataDir({ NUMISMA_DATA_DIR: "../ghost" })).toThrow(
      /NUMISMA_DATA_DIR must be an absolute path/,
    );
  });

  it("the default is ALWAYS absolute and homedir-derived, never CWD-relative", () => {
    expect(isAbsolute(resolveDataDir({}))).toBe(true);
    expect(resolveDataDir({}).endsWith(join("Dev", "accumulus", "data"))).toBe(true);
  });

  it("reads process.env by default (the live no-arg path)", () => {
    const saved = process.env.NUMISMA_DATA_DIR;
    try {
      delete process.env.NUMISMA_DATA_DIR;
      expect(resolveDataDir()).toBe(ACCUMULUS_DEFAULT);
    } finally {
      if (saved === undefined) {
        delete process.env.NUMISMA_DATA_DIR;
      } else {
        process.env.NUMISMA_DATA_DIR = saved;
      }
    }
  });
});

// The `NUMISMA_DATA_DIR` env knob is a data-dir DOOR like the four caller-supplied ones,
// so it runs the same table. The rows above are this door's own history — the #348 blank
// refusal, the D6 relative refusal, the message wording an operator reads — and they stay;
// the table is what proves this door and the other four still answer identically.
assertDataDirContract({
  name: "resolveDataDir (NUMISMA_DATA_DIR)",
  subject: /NUMISMA_DATA_DIR/,
  root: (dataDir) => resolveDataDir({ NUMISMA_DATA_DIR: dataDir }),
  defaultArm: {
    actual: () => resolveDataDir({}),
    expected: () => ACCUMULUS_DEFAULT,
  },
});
