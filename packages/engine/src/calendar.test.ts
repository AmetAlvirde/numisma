/**
 * The `asOf` calendar arithmetic, locked in its new single home. Every date here
 * is synthetic — this exercises string/UTC arithmetic, not any fund data.
 *
 * The UTC assertions are the point: a local-time implementation passes the happy
 * path in Greenwich and silently returns the PREVIOUS day west of it, which is how
 * a liveness detector ends up calling a Monday a Sunday. Both helpers are pinned
 * against an explicitly non-UTC process timezone below so that regression cannot
 * hide behind the machine the suite happens to run on.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, daysBetween } from "./calendar.js";

const originalTz = process.env.TZ;

// UTC-8: the failure mode the docstring names only reproduces west of Greenwich.
beforeAll(() => {
  process.env.TZ = "America/Los_Angeles";
});
afterAll(() => {
  process.env.TZ = originalTz;
});

describe("addDays", () => {
  it("walks forward and back in whole calendar days", () => {
    expect(addDays("2026-07-26", 1)).toBe("2026-07-27");
    expect(addDays("2026-07-26", -1)).toBe("2026-07-25");
    expect(addDays("2026-07-26", 0)).toBe("2026-07-26");
  });

  it("stays on the UTC day west of Greenwich", () => {
    // A local-time implementation renders UTC midnight as the previous evening
    // and returns "2026-07-25" here.
    expect(addDays("2026-07-26", 0)).toBe("2026-07-26");
  });

  it("crosses month, year and leap-day boundaries", () => {
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("throws rather than returning a silent garbage date", () => {
    expect(() => addDays("not-a-date", 1)).toThrow(
      'addDays: "not-a-date" is not a calendar date',
    );
  });
});

describe("daysBetween", () => {
  it("counts whole calendar days, signed by direction", () => {
    expect(daysBetween("2026-07-26", "2026-07-29")).toBe(3);
    expect(daysBetween("2026-07-29", "2026-07-26")).toBe(-3);
    expect(daysBetween("2026-07-26", "2026-07-26")).toBe(0);
  });

  it("counts across a DST transition as whole days, not 23- or 25-hour spans", () => {
    // US DST springs forward 2026-03-08. In local time this window is 23 hours
    // short of two days; in UTC — the only reading that makes a day-count honest —
    // it is exactly 2.
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
  });

  it("throws on either endpoint being unparseable", () => {
    expect(() => daysBetween("not-a-date", "2026-07-26")).toThrow(/daysBetween/);
    expect(() => daysBetween("2026-07-26", "not-a-date")).toThrow(/daysBetween/);
  });
});
