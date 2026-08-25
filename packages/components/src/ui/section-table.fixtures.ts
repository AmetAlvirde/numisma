import type { DashboardSection } from "@numisma/engine";
import type { BigPictureView } from "./section-table";

/**
 * `SectionTable`'s two prop literals, beside the component (spec #439 §4.3).
 *
 * THE COMPONENT TAKES TWO PROPS AND ONLY ONE OF THEM IS A VIEW. `section` is the wire's
 * own `DashboardSection` and carries the labels and the figures; the view carries which
 * of them may be shown and what each is compared against. A fixture file holding only
 * the view would not let anything render.
 *
 * A LITERAL, NEVER A COMPOSE CALL, and that is forced rather than chosen.
 * `composeBigPicture` stays in `apps/web/src/glance/row-view.ts` with every line of its
 * logic, and `seam-isolation.test.ts` forbids the workbench importing from there. What
 * keeps these honest instead is the type direction: this package DECLARES
 * `BigPictureView` and that module returns it, so a field that moves stops compiling on
 * both sides rather than drifting on one.
 *
 * `rows` IS A `ReadonlyMap`. An object literal typechecks against nothing here, which is
 * the one shape to get right; the failure is a fixture that will not compile.
 *
 * SYNTHESIZED. `Portfolios`, `Alpha`, `Beta` and every figure below are placeholders. No
 * ledger output has been near this file.
 */

/** Two composition rows, one of which the views below suppress. */
export function section(): DashboardSection {
  return {
    id: "portfolios",
    title: "Portfolios",
    rows: [
      {
        id: "row-a",
        kind: "portfolio",
        label: "Alpha",
        usdValue: 600,
        percentOfFund: 60,
      },
      {
        id: "row-b",
        kind: "portfolio",
        label: "Beta",
        usdValue: 400,
        percentOfFund: 40,
      },
    ],
  };
}

/**
 * Both deltas render on `row-a`; `row-b` is suppressed with a named cause.
 *
 * `row-a` gets a POSITIVE anchor delta and a NEGATIVE cost-basis one deliberately: the
 * two sign colours are two arms of one ternary and cannot both paint from one delta, so
 * one row rendering one of each is what puts both on screen at once.
 *
 * `row-b` carries FOUR SEPARATELY NAMED CAUSES across its four em dashes — the row's own
 * cause reaches two cells, and each delta column names its own. A `Row` that collapsed
 * them into one would still print an em dash everywhere.
 */
export function anchoredView(): BigPictureView {
  return {
    reference: { asOf: "2026-01-01", label: "Thu 1 Jan" },
    costBasisLabel: "cost basis",
    percentOfFundRendered: true,
    fundValueRendered: true,
    rows: new Map([
      [
        "row-a",
        {
          rendered: true,
          vsAnchor: { rendered: true, usdValue: 25, percent: 4.35 },
          vsCostBasis: { rendered: true, usdValue: -10, percent: -1.64 },
        },
      ],
      [
        "row-b",
        {
          rendered: false,
          suppressedBy: "unexpected-absence" as const,
          vsAnchor: { rendered: false, suppressedBy: "no-earlier-anchor" as const },
          vsCostBasis: { rendered: false, suppressedBy: "no-cost-basis" as const },
        },
      ],
    ]),
  };
}

/**
 * The genesis arm: no anchor to name, and NAV withheld, so the % column is absent too.
 *
 * `reference` IS DESTRUCTURED OUT, NOT SET TO `undefined`. `exactOptionalPropertyTypes`
 * is on in this package, so the two are different types and only one of them is
 * `BigPictureView`. It is also the only arm in which the anchor column's header renders
 * "no earlier anchor" instead of a date, which is the only place this component's third
 * `--nms-muted-foreground` read appears at all.
 */
export function anchorlessView(): BigPictureView {
  const { reference: _reference, ...rest } = anchoredView();
  return { ...rest, percentOfFundRendered: false };
}
