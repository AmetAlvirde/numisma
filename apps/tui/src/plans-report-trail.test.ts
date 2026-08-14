/**
 * D8 AT THE PIXEL — the plans report's reading of the `reconciliations.jsonl` trail.
 *
 * The rule this file exists to hold: **a missing or unreadable trail renders
 * UNKNOWN, never clean.** D6 makes gaps possible, and a gap displayed as a clean
 * `active` row is false assurance — worse than not reading the trail at all. So the
 * assertions below are over the RENDERED TEXT, never over the verdict type: a
 * selector that returns the right arm and a renderer that prints the same glyph for
 * clean and for unknown would satisfy every type-level test and still ship the exact
 * defect. Six renderings — clean, warned, and each of the four unknown reasons —
 * must be six visibly different rows.
 *
 * Every id, date, tier and event id below is SYNTHETIC and authored for these tests.
 * The fund's real fills, plans and trail lines never enter this repository (ADR-007).
 */
import type {
  LoadedPlans,
  LoadedReconciliationRecord,
  LoadedReconciliations,
  SkippedReconciliationLine,
} from "@numisma/engine";
import { describe, expect, it } from "vitest";
import { formatPlansReport } from "./plans-report.js";

const AS_OF = "2026-09-20";
const PLANS_PATH = "/tmp/synthetic/plans.jsonl";
const TRAIL_PATH = "/tmp/synthetic/reconciliations.jsonl";

/** The one position every rendering test looks at — born, so its row is `active`. */
const POSITION = "ladder-demo-01";
const EXISTING = new Set([POSITION]);

/** A synthetic sidecar naming exactly one position, in force at {@link AS_OF}. */
function plansFixture(): LoadedPlans {
  return {
    load: { status: "loaded", sourcePath: PLANS_PATH },
    plans: [
      {
        kind: "dcaLadder",
        id: "9f1c2b64-0000-4000-8000-de5060000001",
        positionId: POSITION,
        effectiveAt: "2026-08-15",
        tierOrder: ["c1", "c2"],
        rungs: [{ id: "r1", priceUsd: 41000, sizeUsd: 250 }],
        line: 1,
      },
    ],
    skipped: [],
  };
}

/** One authored trail line. `declared` and `mismatches` are the caller's business. */
function trailLine(
  overrides: Partial<LoadedReconciliationRecord> & { line: number },
): LoadedReconciliationRecord {
  return {
    positionId: POSITION,
    eventId: `evt-demo-${String(overrides.line).padStart(4, "0")}`,
    fillKind: "PositionAddedTo",
    asOf: "2026-09-04",
    toldAt: "2026-09-04T18:12:07-06:00",
    lotTier: "c1",
    declared: {
      status: "active",
      kind: "dcaLadder",
      planId: "9f1c2b64-0000-4000-8000-de5060000001",
      effectiveAt: "2026-08-15",
      tierOrder: ["c1", "c2"],
    },
    mismatches: [],
    ...overrides,
  };
}

function loadedTrail(
  reconciliations: LoadedReconciliationRecord[],
  skipped: SkippedReconciliationLine[] = [],
): LoadedReconciliations {
  return { load: { status: "loaded", sourcePath: TRAIL_PATH }, reconciliations, skipped };
}

/** Render the one-position sidecar against a given trail, and hand back the page. */
function render(
  reconciliations: LoadedReconciliations,
  options: { loaded?: LoadedPlans; existing?: ReadonlySet<string> } = {},
): { text: string; exitCode: 0 | 1 } {
  return formatPlansReport({
    loaded: options.loaded ?? plansFixture(),
    asOf: AS_OF,
    existingPositionIds: options.existing ?? EXISTING,
    sourcePath: PLANS_PATH,
    reconciliations,
  });
}

/** The one row for `positionId`, so an assertion reads the row and not the page. */
function row(text: string, positionId: string): string {
  const found = text.split("\n").find((line) => line.trim().startsWith(positionId));
  expect(found, `no row rendered for ${positionId}`).toBeDefined();
  return found as string;
}

const ABSENT: LoadedReconciliations = {
  load: { status: "absent", sourcePath: TRAIL_PATH },
  reconciliations: [],
  skipped: [],
};

describe("a missing trail renders UNKNOWN, never clean", () => {
  it("qualifies the active row explicitly rather than leaving it a plain plan row", () => {
    const { text } = render(ABSENT);
    const active = row(text, POSITION);

    // The row still says what the sidecar says…
    expect(active).toContain("active");
    // …and then says, in as many words, that the trail could not answer for it.
    expect(active).toMatch(/no trail/i);

    // And it is NOT the row a clean fill would have produced. This is the assertion
    // the whole slice exists for: same plan, same date, same position — different row.
    const clean = row(render(loadedTrail([trailLine({ line: 1 })])).text, POSITION);
    expect(active).not.toBe(clean);
  });
});

describe("clean, warned and the four unknown reasons are SIX distinct rows", () => {
  /** The six scenarios, each producing the row for the same position at the same date. */
  const scenarios: Array<{ name: string; render: () => string }> = [
    {
      name: "clean",
      render: () => row(render(loadedTrail([trailLine({ line: 1 })])).text, POSITION),
    },
    {
      name: "warned",
      render: () =>
        row(
          render(loadedTrail([trailLine({ line: 1, lotTier: "c3", mismatches: ["tierNotInPlan"] })]))
            .text,
          POSITION,
        ),
    },
    { name: "no-trail", render: () => row(render(ABSENT).text, POSITION) },
    { name: "no-line", render: () => row(render(loadedTrail([])).text, POSITION) },
    {
      name: "trail-unreadable",
      render: () =>
        row(
          render({
            load: { status: "load-failed", sourcePath: TRAIL_PATH, message: "EACCES" },
            reconciliations: [],
            skipped: [],
          }).text,
          POSITION,
        ),
    },
    {
      name: "plans-were-unreadable",
      render: () =>
        row(
          render(loadedTrail([trailLine({ line: 1, declared: { status: "unreadable" } })])).text,
          POSITION,
        ),
    },
  ];

  it("renders no two of them the same", () => {
    const rendered = new Map<string, string>();
    for (const scenario of scenarios) {
      rendered.set(scenario.name, scenario.render());
    }
    expect(new Set(rendered.values()).size, `six renderings collapsed: ${[...rendered].join(" | ")}`)
      .toBe(6);
  });

  it("names each unknown reason on the row, and prints NOTHING extra for clean", () => {
    const byName = new Map(scenarios.map((scenario) => [scenario.name, scenario.render()]));

    // Clean is the plan row and only the plan row: no qualifier, no marker.
    const clean = byName.get("clean")!;
    const bare = row(
      formatPlansReport({
        loaded: plansFixture(),
        asOf: AS_OF,
        existingPositionIds: EXISTING,
        sourcePath: PLANS_PATH,
        // A clean trail is the only trail whose row equals the un-annotated row.
        reconciliations: loadedTrail([trailLine({ line: 1 })]),
      }).text,
      POSITION,
    );
    expect(clean).toBe(bare);
    expect(clean).not.toMatch(/unknown|no trail|unreadable|disagree/i);

    // Each unknown names its own reason, so the operator's next move is on the row.
    expect(byName.get("no-trail")!).toMatch(/no trail/i);
    expect(byName.get("no-line")!).toMatch(/no trail line/i);
    expect(byName.get("trail-unreadable")!).toMatch(/trail unreadable/i);
    expect(byName.get("plans-were-unreadable")!).toMatch(/plans were unreadable/i);

    // And warned is loud, naming the mismatch and the FILL's own date.
    const warned = byName.get("warned")!;
    expect(warned).toContain("tierNotInPlan");
    expect(warned).toContain("2026-09-04");
  });

  it("carries no price, size, amount or balance in any annotation", () => {
    for (const scenario of scenarios) {
      const rendered = scenario.render();
      // The plan body's own rung COUNT is the row's, not the annotation's; nothing
      // the trail contributes may carry a figure or a currency mark.
      const annotation = rendered.slice(rendered.indexOf("rung(s)"));
      expect(annotation).not.toMatch(/\$|usd/i);
      expect(annotation).not.toMatch(/\d[\d,]*\.\d/);
    }
  });
});

describe("D8's scoping: the mark follows the LATEST fill, not any fill", () => {
  it("a later clean fill CLEARS a warned mark", () => {
    const { text } = render(
      loadedTrail([
        trailLine({ line: 1, asOf: "2026-09-04", lotTier: "c3", mismatches: ["tierNotInPlan"] }),
        trailLine({ line: 2, asOf: "2026-09-11" }),
      ]),
    );
    expect(row(text, POSITION)).not.toContain("tierNotInPlan");
  });

  it("breaks a same-DATE tie by line, so the later line decides", () => {
    // Two fills on the same day. Without the read-side `line` stamp these have no
    // order at all, and "a later clean fill clears the mark" is undefined for exactly
    // the case it most needs to cover.
    const warnedFirst = render(
      loadedTrail([
        trailLine({ line: 1, asOf: "2026-09-04", lotTier: "c3", mismatches: ["tierNotInPlan"] }),
        trailLine({ line: 2, asOf: "2026-09-04" }),
      ]),
    );
    expect(row(warnedFirst.text, POSITION)).not.toContain("tierNotInPlan");

    const cleanFirst = render(
      loadedTrail([
        trailLine({ line: 1, asOf: "2026-09-04" }),
        trailLine({ line: 2, asOf: "2026-09-04", lotTier: "c3", mismatches: ["tierNotInPlan"] }),
      ]),
    );
    expect(row(cleanFirst.text, POSITION)).toContain("tierNotInPlan");
  });
});

describe("the annotation is scoped to `active` rows", () => {
  it("leaves a `pending` row exactly as it renders today", () => {
    // A pending position does not exist, so it has no fills and would carry `no-line`
    // forever — noise on every pending row.
    const withTrail = render(ABSENT, { existing: new Set<string>() });
    const withoutTrail = formatPlansReport({
      loaded: plansFixture(),
      asOf: AS_OF,
      existingPositionIds: new Set<string>(),
      sourcePath: PLANS_PATH,
      reconciliations: loadedTrail([trailLine({ line: 1 })]),
    });
    const pending = row(withTrail.text, POSITION);
    expect(pending).toContain("pending");
    expect(pending).toBe(row(withoutTrail.text, POSITION));
    expect(pending).not.toMatch(/no trail/i);
  });
});

describe("an unattributable trail skip is NOT a blackout", () => {
  it("counts it file-globally and blanks no position", () => {
    // One broken envelope, three healthy positions with clean fills.
    const born = new Set(["pos-a", "pos-b", "pos-c"]);
    const plans: LoadedPlans = {
      load: { status: "loaded", sourcePath: PLANS_PATH },
      plans: [...born].map((positionId, index) => ({
        kind: "dcaTime" as const,
        positionId,
        effectiveAt: "2026-08-01",
        cadence: "weekly" as const,
        anchorAt: "2026-08-03",
        amountUsd: 25,
        tierOrder: ["c1" as const],
        line: index + 1,
      })),
      skipped: [],
    };
    const trail = loadedTrail(
      [...born].map((positionId, index) =>
        trailLine({ line: index + 1, positionId, declared: { status: "active", kind: "dcaTime", effectiveAt: "2026-08-01", tierOrder: ["c1"] } }),
      ),
      [{ line: 4, reason: "invalid", detail: "line is not a JSON object" }],
    );

    const { text, exitCode } = render(trail, { loaded: plans, existing: born });
    for (const positionId of born) {
      expect(row(text, positionId)).not.toMatch(/no trail line|trail unreadable/i);
    }
    // The count prints on its own line, and the skip still costs a non-zero exit.
    expect(text).toContain("unattributable trail line(s): 1");
    expect(exitCode).toBe(1);
  });
});

describe("the composed exit code", () => {
  it("is 0 only when BOTH verdicts are 0", () => {
    expect(render(loadedTrail([trailLine({ line: 1 })])).exitCode).toBe(0);
  });

  it("is 0 for an ABSENT trail — before the first fill, absence is normal", () => {
    expect(render(ABSENT).exitCode).toBe(0);
  });

  it("is 1 when the trail could not be read, on an otherwise-clean sidecar", () => {
    expect(
      render({
        load: { status: "load-failed", sourcePath: TRAIL_PATH, message: "EACCES" },
        reconciliations: [],
        skipped: [],
      }).exitCode,
    ).toBe(1);
  });

  it("is 1 when the SIDECAR is broken and the trail is clean", () => {
    const broken: LoadedPlans = {
      load: { status: "load-failed", sourcePath: PLANS_PATH, message: "EACCES" },
      plans: [],
      skipped: [],
    };
    expect(render(loadedTrail([]), { loaded: broken }).exitCode).toBe(1);
  });
});
