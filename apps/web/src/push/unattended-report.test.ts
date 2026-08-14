/**
 * The run's operator channel (spec #320 seams C/D). What is pinned here is CO-TENANCY:
 * the preferences discard report is the first kind on this surface and must not be the
 * last, so every assertion below drives it alongside an invented second kind.
 *
 * The second kind is a stand-in, not a prediction. Its point is that nothing in the
 * first kind's shape claims the surface — the same three calls file it, the same bound
 * protects it, and neither kind can starve the other.
 */
import { describe, expect, it } from "vitest";
import { MAX_LINES_PER_KIND, RunReport } from "./unattended-report.ts";

/** An authored stand-in co-tenant. Any second diagnostic kind would do. */
const OTHER_KIND = "co-tenant";
const PREFS = "preferences";

describe("RunReport — the shared, bounded, per-kind operator channel", () => {
  it("is empty until something files, and a kind with nothing to say leaves no trace", () => {
    const channel = new RunReport();
    channel.add(PREFS, []);
    expect(channel.isEmpty).toBe(true);
    expect(channel.lines()).toEqual([]);
  });

  it("keeps every kind's lines, in the order the kinds first filed", () => {
    const channel = new RunReport();
    channel.add(PREFS, ["preferences line 2 skipped"]);
    channel.add(OTHER_KIND, ["something else worth saying"]);

    expect(channel.lines()).toEqual([
      "preferences line 2 skipped",
      "something else worth saying",
    ]);
    expect(channel.linesFor(PREFS)).toEqual(["preferences line 2 skipped"]);
  });

  it("DEDUPS WITHIN A KIND — the backfill re-finds the same discard on every anchor", () => {
    const channel = new RunReport();
    for (let anchor = 0; anchor < 40; anchor += 1) {
      channel.add(PREFS, ["preferences line 2 skipped"]);
    }
    expect(channel.linesFor(PREFS)).toHaveLength(1);
  });

  it("does not dedup ACROSS kinds — two tenants may say the same words about different things", () => {
    const channel = new RunReport();
    channel.add(PREFS, ["line 2 skipped"]);
    channel.add(OTHER_KIND, ["line 2 skipped"]);
    expect(channel.lines()).toHaveLength(2);
  });

  it("RESERVES CAPACITY PER KIND: a flood in one kind cannot starve another", () => {
    // PR #322's lesson, from the TUI's seven-line gap channel: a bounded surface that
    // slices a CONCATENATION withholds whichever kind sorts last, and a transient,
    // recurring kind can starve out a permanent finding forever. Here the flood is a
    // pathological sidecar with one discard per line.
    const channel = new RunReport();
    for (let line = 1; line <= 500; line += 1) {
      channel.add(PREFS, [`preferences line ${line} skipped`]);
    }
    channel.add(OTHER_KIND, ["the one thing the other tenant had to say"]);

    const rendered = channel.lines();

    // The co-tenant's single line survives 500 competing lines. This is the assertion
    // the whole class exists for.
    expect(rendered).toContain("the one thing the other tenant had to say");
    // And the flood took its own reserved capacity, not the budget.
    expect(
      rendered.filter((line) => line.startsWith("preferences line ")),
    ).toHaveLength(MAX_LINES_PER_KIND);
  });

  it("says when a kind was truncated, so a bound never reads as an all-clear", () => {
    const channel = new RunReport();
    for (let line = 1; line <= MAX_LINES_PER_KIND + 3; line += 1) {
      channel.add(PREFS, [`preferences line ${line} skipped`]);
    }
    const rendered = channel.lines();
    expect(rendered[rendered.length - 1]).toBe(
      `${PREFS}: 3 further diagnostic(s) not shown (per-kind cap ${MAX_LINES_PER_KIND}).`,
    );
  });

  it("emits one sink call per line, and nothing at all on a clean run", () => {
    const clean = new RunReport();
    const emitted: string[] = [];
    clean.emit((line) => emitted.push(line));
    expect(emitted).toEqual([]);

    const dirty = new RunReport();
    dirty.add(PREFS, ["a", "b"]);
    dirty.add(OTHER_KIND, ["c"]);
    dirty.emit((line) => emitted.push(line));
    expect(emitted).toEqual(["a", "b", "c"]);
  });

  it("DECIDES NO EXIT CODE — kinds do not share an exit policy", () => {
    // Structural, and deliberately so. One kind marks the run non-zero because an
    // unread stderr log is not a report; another is prose-only and exits zero because
    // its finding can never extinguish. A channel that summed codes would force one
    // policy on every tenant, so it exposes none: callers compose prose here and exit
    // codes beside it, from the same per-kind verdicts.
    const channel = new RunReport() as unknown as Record<string, unknown>;
    expect(channel.exitCode).toBeUndefined();
  });
});
