import {
  buildCompositionReport,
  buildDashboardDetail,
  type FundReviewData,
} from "@numisma/engine";
import { describe, expect, it } from "vitest";
import { buildDashboardLines, type DashboardLine } from "./dashboard.js";
import {
  findNextSelectableLine,
  keepSelectionInView,
  mapKeyToIntent,
  normalizeSelection,
  reduce,
  reloadOutcome,
  renderLine,
  type InteractionState,
  type Relayout,
} from "./interaction-core.js";

// A relayout that should never be consulted (move/non-open activations don't
// rebuild the view); calling it fails the test loudly.
const noRelayout: Relayout = () => {
  throw new Error("relayout should not be called");
};

function line(partial: Partial<DashboardLine>): DashboardLine {
  return { content: "", selectable: false, ...partial };
}

describe("@numisma/tui interaction-core: selection normalization", () => {
  it("keeps a selection that already lands on a selectable line", () => {
    const lines = [line({ selectable: false }), line({ selectable: true })];
    expect(normalizeSelection(lines, 1)).toBe(1);
  });

  it("falls back to the first selectable line when the selection is a label", () => {
    const lines = [
      line({ selectable: false }),
      line({ selectable: false }),
      line({ selectable: true }),
    ];
    expect(normalizeSelection(lines, 0)).toBe(2);
  });

  it("returns 0 when no line is selectable", () => {
    const lines = [line({ selectable: false }), line({ selectable: false })];
    expect(normalizeSelection(lines, 1)).toBe(0);
  });
});

describe("@numisma/tui interaction-core: next-selectable skip + wrap-around", () => {
  const lines = [
    line({ selectable: true }), // 0
    line({ selectable: false }), // 1
    line({ selectable: false }), // 2
    line({ selectable: true }), // 3
  ];

  it("skips non-selectable lines moving forward", () => {
    expect(findNextSelectableLine(lines, 0, 1)).toBe(3);
  });

  it("wraps around to the first selectable line past the end", () => {
    expect(findNextSelectableLine(lines, 3, 1)).toBe(0);
  });

  it("skips non-selectable lines moving backward", () => {
    expect(findNextSelectableLine(lines, 3, -1)).toBe(0);
  });

  it("wraps around to the last selectable line before the start", () => {
    expect(findNextSelectableLine(lines, 0, -1)).toBe(3);
  });

  it("returns 0 for an empty line list", () => {
    expect(findNextSelectableLine([], 0, 1)).toBe(0);
  });

  it("stays put when no line is selectable", () => {
    const dead = [line({ selectable: false }), line({ selectable: false })];
    expect(findNextSelectableLine(dead, 1, 1)).toBe(1);
  });
});

describe("@numisma/tui interaction-core: cursor-glyph rendering", () => {
  it("draws the '>' cursor on the selected selectable line", () => {
    expect(renderLine(line({ content: "Row", selectable: true }), 2, 2)).toBe(
      "> Row",
    );
  });

  it("draws a leading space on an unselected selectable line", () => {
    expect(renderLine(line({ content: "Row", selectable: true }), 1, 2)).toBe(
      "  Row",
    );
  });

  it("indents a non-selectable line without a cursor", () => {
    expect(renderLine(line({ content: "Label", selectable: false }), 2, 2)).toBe(
      "  Label",
    );
  });
});

describe("@numisma/tui interaction-core: viewport scroll math", () => {
  const base = { lineCount: 50, viewportHeight: 10, scrollTop: 10 };

  it("leaves scrollTop unchanged when the selection is already visible", () => {
    expect(keepSelectionInView({ ...base, selectedLine: 15 })).toBe(10);
  });

  it("scrolls up to reveal a selection above the viewport top", () => {
    expect(keepSelectionInView({ ...base, selectedLine: 4 })).toBe(4);
  });

  it("scrolls down to reveal a selection below the viewport bottom", () => {
    // bottom = 10 + 10 - 1 = 19; selecting 25 -> 25 - 10 + 1 = 16
    expect(keepSelectionInView({ ...base, selectedLine: 25 })).toBe(16);
  });

  it("returns scrollTop unchanged for an empty or zero-height viewport", () => {
    expect(
      keepSelectionInView({ selectedLine: 5, lineCount: 0, viewportHeight: 10, scrollTop: 3 }),
    ).toBe(3);
    expect(
      keepSelectionInView({ selectedLine: 5, lineCount: 50, viewportHeight: 0, scrollTop: 3 }),
    ).toBe(3);
  });
});

describe("@numisma/tui interaction-core: key->intent mapper", () => {
  it("maps quit bindings", () => {
    expect(mapKeyToIntent({ name: "q" })).toEqual({ type: "quit" });
    expect(mapKeyToIntent({ name: "c", ctrl: true })).toEqual({ type: "quit" });
  });

  it("does not quit on a bare 'c' without ctrl", () => {
    expect(mapKeyToIntent({ name: "c" })).toBeUndefined();
  });

  it("maps the reload binding", () => {
    expect(mapKeyToIntent({ name: "r" })).toEqual({ type: "reload" });
  });

  it("maps forward movement (j / down)", () => {
    expect(mapKeyToIntent({ name: "j" })).toEqual({ type: "move", delta: 1 });
    expect(mapKeyToIntent({ name: "down" })).toEqual({ type: "move", delta: 1 });
  });

  it("maps backward movement (k / up)", () => {
    expect(mapKeyToIntent({ name: "k" })).toEqual({ type: "move", delta: -1 });
    expect(mapKeyToIntent({ name: "up" })).toEqual({ type: "move", delta: -1 });
  });

  it("maps every activate binding (return / enter / linefeed / \\r / \\n)", () => {
    expect(mapKeyToIntent({ name: "return" })).toEqual({ type: "activate" });
    expect(mapKeyToIntent({ name: "enter" })).toEqual({ type: "activate" });
    expect(mapKeyToIntent({ name: "linefeed" })).toEqual({ type: "activate" });
    expect(mapKeyToIntent({ sequence: "\r" })).toEqual({ type: "activate" });
    expect(mapKeyToIntent({ sequence: "\n" })).toEqual({ type: "activate" });
  });

  it("ignores unbound keys", () => {
    expect(mapKeyToIntent({ name: "x" })).toBeUndefined();
    expect(mapKeyToIntent({})).toBeUndefined();
  });
});

describe("@numisma/tui interaction-core: move + activate reducer", () => {
  const navLines = [
    line({ selectable: false }), // 0
    line({ selectable: true }), // 1
    line({ selectable: false }), // 2
    line({ selectable: true }), // 3
  ];

  it("move advances the cursor to the next selectable line", () => {
    const next = reduce(
      navLines,
      { selectedLine: 1 },
      { type: "move", delta: 1 },
      noRelayout,
    );
    expect(next.selectedLine).toBe(3);
  });

  it("move backward wraps to the last selectable line", () => {
    const next = reduce(
      navLines,
      { selectedLine: 1 },
      { type: "move", delta: -1 },
      noRelayout,
    );
    expect(next.selectedLine).toBe(3);
  });

  it("activate on a line with no action leaves state unchanged", () => {
    const state: InteractionState = { selectedLine: 0 };
    expect(reduce(navLines, state, { type: "activate" }, noRelayout)).toBe(state);
  });

  it("activate open-detail opens the row, clears any record, and jumps to the collapse-detail row", () => {
    const lines = [
      line({ selectable: false }),
      line({
        selectable: true,
        action: { type: "open-detail", rowId: "account:xtb-usd" },
      }),
    ];
    // The relayout returns the freshly-built lines for the opened row; the
    // collapse-detail line sits at index 4 here.
    const relayout: Relayout = (rowId, recordId) => {
      expect(rowId).toBe("account:xtb-usd");
      expect(recordId).toBeUndefined();
      return [
        line({ selectable: false }),
        line({ selectable: false }),
        line({ selectable: false }),
        line({ selectable: false }),
        line({
          selectable: true,
          action: { type: "collapse-detail", rowId: "account:xtb-usd" },
        }),
      ];
    };

    const next = reduce(
      lines,
      { selectedLine: 1, activeRecordId: "stale-record" },
      { type: "activate" },
      relayout,
    );
    expect(next).toEqual({
      selectedLine: 4,
      activeRowId: "account:xtb-usd",
      activeRecordId: undefined,
    });
  });

  it("activate collapse-detail clears the open row and record", () => {
    const lines = [
      line({
        selectable: true,
        action: { type: "collapse-detail", rowId: "account:xtb-usd" },
      }),
    ];
    const next = reduce(
      lines,
      { selectedLine: 0, activeRowId: "account:xtb-usd", activeRecordId: "rec-1" },
      { type: "activate" },
      noRelayout,
    );
    expect(next).toEqual({
      selectedLine: 0,
      activeRowId: undefined,
      activeRecordId: undefined,
    });
  });

  it("activate expand-record opens the tier table for the record", () => {
    const lines = [
      line({
        selectable: true,
        action: { type: "expand-record", recordId: "rec-1" },
      }),
    ];
    const next = reduce(
      lines,
      { selectedLine: 0, activeRowId: "account:xtb-usd" },
      { type: "activate" },
      noRelayout,
    );
    expect(next).toEqual({
      selectedLine: 0,
      activeRowId: "account:xtb-usd",
      activeRecordId: "rec-1",
    });
  });

  it("activate collapse-record closes the expanded tier table", () => {
    const lines = [
      line({
        selectable: true,
        action: { type: "collapse-record", recordId: "rec-1" },
      }),
    ];
    const next = reduce(
      lines,
      { selectedLine: 0, activeRowId: "account:xtb-usd", activeRecordId: "rec-1" },
      { type: "activate" },
      noRelayout,
    );
    expect(next).toEqual({
      selectedLine: 0,
      activeRowId: "account:xtb-usd",
      activeRecordId: undefined,
    });
  });

  it("drives the post-open jump against real engine-built lines", () => {
    const data = makeMinimalFixture();
    const report = buildCompositionReport(data);
    const relayout: Relayout = (rowId, recordId) =>
      buildDashboardLines(
        report,
        rowId ? buildDashboardDetail(data, report, rowId) : undefined,
        recordId,
      );

    const collapsedLines = relayout(undefined, undefined);
    const openIndex = collapsedLines.findIndex(
      (l) => l.action?.type === "open-detail",
    );
    expect(openIndex).toBeGreaterThanOrEqual(0);

    const next = reduce(
      collapsedLines,
      { selectedLine: openIndex },
      { type: "activate" },
      relayout,
    );

    const openedLines = relayout(next.activeRowId, next.activeRecordId);
    expect(openedLines[next.selectedLine]?.action?.type).toBe("collapse-detail");
  });
});

describe("@numisma/tui interaction-core: reload-outcome decision", () => {
  it("keeps the open detail on a successful reload", () => {
    const state: InteractionState = {
      selectedLine: 3,
      activeRowId: "account:xtb-usd",
      activeRecordId: "rec-1",
    };
    expect(reloadOutcome(state, { ok: true })).toBe(state);
  });

  it("clears activeRowId on a failed reload while keeping selection and record", () => {
    const next = reloadOutcome(
      { selectedLine: 3, activeRowId: "account:xtb-usd", activeRecordId: "rec-1" },
      { ok: false },
    );
    expect(next).toEqual({
      selectedLine: 3,
      activeRowId: undefined,
      activeRecordId: "rec-1",
    });
  });
});

function makeMinimalFixture(): FundReviewData {
  return {
    fund: { id: "fund-1", name: "Main Fund", baseCurrency: "USD" },
    review: { asOf: "2026-05-28", usdMxn: 20 },
    portfolios: [{ id: "core", name: "Core" }],
    accounts: [
      { id: "xtb-usd", name: "Main Broker", platform: "XTB", currency: "USD" },
    ],
    instruments: [
      { id: "aapl-usd", name: "Apple Inc.", symbol: "AAPL", currency: "USD" },
    ],
    reserves: [
      {
        id: "reserve-usd-live",
        portfolioId: "core",
        tempo: "Reserve",
        executionMode: "live",
        accountId: "xtb-usd",
        currency: "USD",
        amount: 250,
      },
    ],
    positions: [
      {
        id: "aapl-core",
        portfolioId: "core",
        tempo: "Capital",
        executionMode: "live",
        accountId: "xtb-usd",
        instrumentId: "aapl-usd",
        direction: "long",
        lots: [{ quantity: 2, cost: 100, tier: "c1" }],
        markPrice: 150,
        currency: "USD",
      },
    ],
  };
}
