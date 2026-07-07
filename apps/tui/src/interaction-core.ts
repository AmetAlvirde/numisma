import type { DashboardAction, DashboardLine } from "./dashboard.js";

/**
 * The pure, openTUI-free interaction core for the Fund Composition dashboard.
 *
 * Every decision the interactive shell makes about selection, navigation,
 * drill-down state, cursor rendering, viewport scrolling, and reload handling
 * lives here as a pure function of its inputs. The `mountApp` wiring owns the
 * engine calls (`buildDashboardDetail`, `buildDashboardLines`) and the openTUI
 * glue, and passes the resulting `DashboardLine[]` into this core. Nothing here
 * imports openTUI or the engine, so it is directly unit-testable under Node
 * without a terminal.
 */

/** The mutable interaction state the shell threads through every keypress. */
export interface InteractionState {
  /** Index into the current `DashboardLine[]` carrying the selection cursor. */
  selectedLine: number;
  /** The row whose detail panel is open, or `undefined` when collapsed. */
  activeRowId?: string | undefined;
  /** The detail record whose tier table is expanded, or `undefined`. */
  activeRecordId?: string | undefined;
}

/** A keypress reduced to the action the shell should take, or `undefined`. */
export type InteractionIntent =
  | { type: "quit" }
  | { type: "reload" }
  | { type: "move"; delta: 1 | -1 }
  | { type: "activate" };

/** The intents that change interaction state (the rest are side effects). */
export type StateIntent = Extract<
  InteractionIntent,
  { type: "move" } | { type: "activate" }
>;

/** Minimal shape of an openTUI keypress the mapper reads. */
export interface KeyLike {
  name?: string;
  ctrl?: boolean;
  sequence?: string;
}

/**
 * Rebuild the visible lines for a given drill-down state. The wiring supplies an
 * engine-backed implementation; the core only consults it (e.g. to find where the
 * collapse-detail row lands after opening a detail), keeping the engine call out
 * of the pure layer.
 */
export type Relayout = (
  activeRowId: string | undefined,
  activeRecordId: string | undefined,
) => DashboardLine[];

/** Map an openTUI keypress to a shell intent, or `undefined` to ignore it. */
export function mapKeyToIntent(key: KeyLike): InteractionIntent | undefined {
  if (key.name === "q" || (key.ctrl && key.name === "c")) {
    return { type: "quit" };
  }
  if (key.name === "r") {
    return { type: "reload" };
  }
  if (key.name === "j" || key.name === "down") {
    return { type: "move", delta: 1 };
  }
  if (key.name === "k" || key.name === "up") {
    return { type: "move", delta: -1 };
  }
  if (
    key.name === "return" ||
    key.name === "enter" ||
    key.name === "linefeed" ||
    key.sequence === "\r" ||
    key.sequence === "\n"
  ) {
    return { type: "activate" };
  }
  return undefined;
}

/**
 * Clamp a selection onto a selectable line. Keeps the current selection if it is
 * already selectable, otherwise falls back to the first selectable line (or 0
 * when none exist). Run after every render so the cursor never rests on a label.
 */
export function normalizeSelection(
  lines: DashboardLine[],
  selection: number,
): number {
  if (lines[selection]?.selectable) {
    return selection;
  }
  const firstSelectable = lines.findIndex((line) => line.selectable);
  return firstSelectable >= 0 ? firstSelectable : 0;
}

/**
 * Find the next selectable line in `delta` direction, skipping non-selectable
 * lines and wrapping around the ends. Returns `from` unchanged when no selectable
 * line exists.
 */
export function findNextSelectableLine(
  lines: DashboardLine[],
  from: number,
  delta: 1 | -1,
): number {
  if (lines.length === 0) {
    return 0;
  }

  let index = from;
  for (let step = 0; step < lines.length; step += 1) {
    index = (index + delta + lines.length) % lines.length;
    if (lines[index]?.selectable) {
      return index;
    }
  }

  return from;
}

/** Render a line with the cursor glyph: `> ` on the selection, `  ` otherwise. */
export function renderLine(
  line: DashboardLine,
  index: number,
  selectedLine: number,
): string {
  if (!line.selectable) {
    return `  ${line.content}`;
  }
  const cursor = index === selectedLine ? ">" : " ";
  return `${cursor} ${line.content}`;
}

/** Inputs the viewport scroll math reads from the dashboard renderable. */
export interface ViewportInput {
  selectedLine: number;
  lineCount: number;
  viewportHeight: number;
  scrollTop: number;
}

/**
 * Compute the scroll offset that keeps the selection inside the viewport. Returns
 * the current `scrollTop` unchanged when the selection is already visible (or the
 * viewport is empty), scrolls up to reveal a selection above the top, and scrolls
 * down to reveal a selection below the bottom.
 */
export function keepSelectionInView({
  selectedLine,
  lineCount,
  viewportHeight,
  scrollTop,
}: ViewportInput): number {
  if (lineCount === 0 || viewportHeight <= 0) {
    return scrollTop;
  }

  const height = Math.max(1, viewportHeight);
  const viewportTop = scrollTop;
  const viewportBottom = viewportTop + height - 1;

  if (selectedLine < viewportTop) {
    return selectedLine;
  }

  if (selectedLine > viewportBottom) {
    return selectedLine - height + 1;
  }

  return scrollTop;
}

/**
 * Apply a state-changing intent (`move` / `activate`) against the visible lines.
 *
 * - `move` advances the cursor to the next selectable line in `delta` direction.
 * - `activate` reads the selected line's action: collapse-detail clears the open
 *   row and record, expand-record opens a tier table, collapse-record closes it,
 *   and open-detail opens the row, clears any expanded record, and jumps the
 *   cursor to the freshly-rendered collapse-detail row (via `relayout`).
 *
 * Returns the unchanged state when the selected line has no action.
 */
export function reduce(
  lines: DashboardLine[],
  state: InteractionState,
  intent: StateIntent,
  relayout: Relayout,
): InteractionState {
  if (intent.type === "move") {
    return {
      ...state,
      selectedLine: findNextSelectableLine(lines, state.selectedLine, intent.delta),
    };
  }

  const action: DashboardAction | undefined = lines[state.selectedLine]?.action;
  if (!action) {
    return state;
  }

  if (action.type === "collapse-detail") {
    return { ...state, activeRowId: undefined, activeRecordId: undefined };
  }

  if (action.type === "expand-record") {
    return { ...state, activeRecordId: action.recordId };
  }

  if (action.type === "collapse-record") {
    return { ...state, activeRecordId: undefined };
  }

  // open-detail: open the row, drop any expanded record, then jump the cursor to
  // the collapse-detail row in the freshly-built lines for the opened row.
  const activeRowId = action.rowId;
  const activeRecordId = undefined;
  const nextLines = relayout(activeRowId, activeRecordId);
  const selectedLine = nextLines.findIndex(
    (line) => line.action?.type === "collapse-detail",
  );
  return { selectedLine, activeRowId, activeRecordId };
}

/**
 * Decide the drill-down state after a reload completes. A successful reload keeps
 * the open detail; a failed reload clears `activeRowId` so a stale row can never
 * render against missing or invalid data.
 */
export function reloadOutcome(
  state: InteractionState,
  result: { ok: boolean },
): InteractionState {
  if (result.ok) {
    return state;
  }
  return { ...state, activeRowId: undefined };
}
