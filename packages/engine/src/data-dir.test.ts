// Shared-resolver contract/drift test. The `NUMISMA_DATA_DIR` resolution body was
// once byte-identical duplicated across the tui event-store and the price-feed
// config, each carrying "keep in sync" comments. Now there is ONE copy in the
// engine (`resolveDataDir`) that every plane imports, so cross-plane drift is
// structurally impossible — but this enumerated-input contract is retained as the
// anti-regression guard: if anyone changes the `~`-expansion, the empty/whitespace
// fall-through, the absolute-normalization, or the relative-rejection, it fails here.
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDataDir } from "./data-dir.js";

const ACCUMULUS_DEFAULT = join(homedir(), "Dev", "accumulus", "data");

describe("resolveDataDir — the single durable-ledger data-root resolver", () => {
  it("falls through to the absolute, homedir-derived accumulus default when unset", () => {
    expect(resolveDataDir({})).toBe(ACCUMULUS_DEFAULT);
  });

  it("treats an empty value as unset (fall-through to the default)", () => {
    expect(resolveDataDir({ NUMISMA_DATA_DIR: "" })).toBe(ACCUMULUS_DEFAULT);
  });

  it("treats a whitespace-only value as unset (fall-through to the default)", () => {
    expect(resolveDataDir({ NUMISMA_DATA_DIR: "  " })).toBe(ACCUMULUS_DEFAULT);
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
