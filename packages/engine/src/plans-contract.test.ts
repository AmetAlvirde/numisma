/**
 * The PURE half of the `plans.jsonl` contract: the strict calendar-date predicate and
 * the two closed vocabularies.
 *
 * Every figure and every id here is SYNTHETIC and invented. The fund's real plans are
 * figures and must never enter this repository (ADR-007); these tests assert
 * PROPERTIES of the format, never a real value.
 */
import { describe, expect, it } from "vitest";
import { DCA_CADENCES, PLAN_KINDS, isIsoCalendarDate, type PlanKind } from "./plans.js";

describe("isIsoCalendarDate — strict shape AND a real calendar date", () => {
  it("accepts a legitimate end-of-month date", () => {
    // The round-trip check must not be so blunt that it rejects real dates: January
    // genuinely has a 31st, and a `dcaTime` anchor on one is ordinary.
    expect(isIsoCalendarDate("2026-01-31")).toBe(true);
    expect(isIsoCalendarDate("2026-12-31")).toBe(true);
    expect(isIsoCalendarDate("2024-02-29")).toBe(true); // a real leap day
  });

  it("REJECTS an impossible calendar date that `Date.parse` accepts", () => {
    // The whole reason the check round-trips instead of merely matching a shape:
    // `Date.parse` rolls 2026-02-30 over to March 2, so a shape-only check would
    // accept a string that SORTS as February and MEANS March.
    expect(Number.isNaN(Date.parse("2026-02-30"))).toBe(false);
    expect(isIsoCalendarDate("2026-02-30")).toBe(false);
    expect(isIsoCalendarDate("2026-13-01")).toBe(false);
    expect(isIsoCalendarDate("2025-02-29")).toBe(false); // 2025 is not a leap year
  });

  it("REJECTS non-ISO forms that would sort wrong under string comparison", () => {
    // Selection compares these as strings. "08/10/2026" sorts under "0" and would
    // silently select the wrong plan — the exact trap the runbook worked through.
    expect(isIsoCalendarDate("08/10/2026")).toBe(false);
    expect(isIsoCalendarDate("2026-7-1")).toBe(false);
    expect(isIsoCalendarDate("2026-07-01T00:00:00Z")).toBe(false);
    expect(isIsoCalendarDate("Jul 1 2026")).toBe(false);
    expect(isIsoCalendarDate("")).toBe(false);
  });

  it("REJECTS anything that is not a string", () => {
    expect(isIsoCalendarDate(20260701)).toBe(false);
    expect(isIsoCalendarDate(null)).toBe(false);
    expect(isIsoCalendarDate(new Date("2026-07-01"))).toBe(false);
  });
});

describe("the closed vocabularies live ONCE, here", () => {
  it("declares two plan kinds plus the terminator", () => {
    // The loader consumes this list and never re-declares one, so a kind added here
    // is a kind the reader recognizes — and no reader can lawfully recognize fewer.
    expect([...PLAN_KINDS]).toEqual(["dcaLadder", "dcaTime", "noPlan"]);
    const kind: PlanKind = "noPlan";
    expect(PLAN_KINDS).toContain(kind);
  });

  it("declares the dcaTime cadences", () => {
    expect([...DCA_CADENCES]).toEqual(["daily", "weekly", "monthly"]);
  });
});
