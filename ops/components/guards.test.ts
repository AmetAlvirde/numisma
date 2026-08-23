import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  atDirectoryMessage,
  findAtDirectory,
  radixDependencies,
  radixDependencyMessage,
} from "./guards.ts";

describe("findAtDirectory", () => {
  let root = "";

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "nms-at-"));
    mkdirSync(join(root, "src"), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("finds nothing in a clean package", () => {
    expect(findAtDirectory(root)).toBeNull();
  });

  it("finds the directory at the package root", () => {
    mkdirSync(join(root, "@", "ui"), { recursive: true });
    expect(findAtDirectory(root)).toBe(join(root, "@"));
  });

  it("finds it under src too", () => {
    mkdirSync(join(root, "src", "@"), { recursive: true });
    expect(findAtDirectory(root)).toBe(join(root, "src", "@"));
  });

  it("ignores a FILE named @", () => {
    writeFileSync(join(root, "@"), "");
    expect(findAtDirectory(root)).toBeNull();
  });
});

describe("atDirectoryMessage", () => {
  it("names the path and says what to do about it", () => {
    const message = atDirectoryMessage("/x/packages/components/@");
    expect(message).toContain("/x/packages/components/@");
    expect(message).toContain("paths");
    expect(message).toContain("Delete");
  });
});

describe("radixDependencies", () => {
  it("passes a base-vega manifest", () => {
    expect(
      radixDependencies({
        dependencies: { "@base-ui/react": "1.7.0", clsx: "2.1.1" },
      }),
    ).toEqual([]);
  });

  it("catches the meta package and the scoped ones, wherever they sit", () => {
    // `new-york` pulls `radix-ui` in. It was hit and reverted once already;
    // the point of the check is that the next time it happens, the add fails
    // rather than the manifest quietly gaining a second primitive library.
    expect(
      radixDependencies({
        dependencies: { "radix-ui": "1.0.0" },
        devDependencies: { "@radix-ui/react-slot": "1.0.0" },
      }),
    ).toEqual(["@radix-ui/react-slot", "radix-ui"]);
  });

  it("survives a manifest with no dependency blocks at all", () => {
    expect(radixDependencies({})).toEqual([]);
  });
});

describe("radixDependencyMessage", () => {
  it("names the offenders and the setting that causes it", () => {
    const message = radixDependencyMessage(["radix-ui"]);
    expect(message).toContain("radix-ui");
    expect(message).toContain("base-vega");
  });
});
