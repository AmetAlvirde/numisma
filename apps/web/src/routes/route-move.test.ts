/**
 * D11 — the route move, asserted structurally (PRD #146 slice #150).
 *
 * A MOVE, NOT A DUPLICATE. `/` becomes the glance; the composition dashboard that
 * used to live there becomes `/big-picture`, behavior-unchanged; the login route
 * keeps navigating to `/`, because the phone should land on triage.
 *
 * WHY A SOURCE-LEVEL TEST AND NOT A RENDER TEST. This repo has no RTL toolchain and
 * this increment deliberately does not add one (see docs/coverage-rationale.md §6 —
 * the `.tsx` render surfaces are outside instrumentation by decision). What is
 * asserted here is the part that can regress SILENTLY: a duplicated dashboard left
 * behind on `/`, a login redirect quietly re-pointed at `/big-picture`, or two
 * divergent copies of `Shell`. The reader must open the phone to judge the layout;
 * nothing below pretends otherwise.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(HERE, file), "utf-8");

describe("D11: the route move", () => {
  it("serves the glance at `/` — the verdict, not the composition tables", () => {
    const index = read("index.tsx");
    expect(index).toMatch(/createFileRoute\(["']\/["']\)/);
    expect(index).toMatch(/glance\/verdict\.ts/);
    // The tables moved out; `/` must not still render them.
    expect(index).not.toMatch(/SectionTable/);
  });

  it("serves the previous composition page at `/big-picture`", () => {
    const big = read("big-picture.tsx");
    expect(big).toMatch(/createFileRoute\(["']\/big-picture["']\)/);
    expect(big).toMatch(/SectionTable/);
    expect(big).toMatch(/SummaryCard/);
  });

  it("keeps login landing on `/`", () => {
    // The phone should land on triage. This is the line the spec pins by file and
    // number (`routes/login.tsx:23`), so it gets an assertion of its own.
    expect(read("login.tsx")).toMatch(/navigate\(\{\s*to:\s*["']\/["']\s*\}\)/);
  });

  it("shares ONE Shell between both surfaces", () => {
    // Two copies would drift, and the whole point of a move is that there is one
    // page's worth of chrome, not two.
    for (const file of ["index.tsx", "big-picture.tsx"]) {
      expect(read(file), file).toMatch(/components\/Shell\.tsx/);
      expect(read(file), file).not.toMatch(/function Shell\(/);
    }
  });
});
