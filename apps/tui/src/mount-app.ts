import {
  buildCompositionReport,
  buildDashboardDetail,
  type CompositionReport,
  type FundReviewData,
} from "@numisma/engine";
import type { CliRenderer } from "@opentui/core";
import {
  buildDashboardLines,
  renderLoadFooter,
  renderLoadFailureText,
  type DashboardLine,
} from "./dashboard.js";
import {
  keepSelectionInView,
  mapKeyToIntent,
  normalizeSelection,
  reduce,
  reloadOutcome,
  renderLine,
  type InteractionState,
} from "./interaction-core.js";

/**
 * Dependencies injected into {@link mountApp}. The wiring owns the openTUI glue
 * and the engine calls; the host (real app or smoke) injects only the openTUI
 * core module and a data source, so both consumers drive the same interactive
 * path.
 */
export interface MountAppDeps {
  /** The loaded `@opentui/core` module (renderables + styled-text helpers). */
  core: typeof import("@opentui/core");
  /** Resolves the Fund review data, or throws with a message to surface. */
  loadData: () => Promise<FundReviewData>;
  /** Source label shown in the reload/footer/failure text. */
  sourcePath: string;
  /** Clock for load timestamps. Defaults to wall-clock ISO time. */
  now?: () => string;
}

/** Handle returned by {@link mountApp} for the host to drive reloads. */
export interface MountedApp {
  /** Re-run the data load and re-render, matching the `r` keypress. */
  refresh: () => Promise<void>;
}

/**
 * Wire the openTUI-coupled interactive dashboard onto `renderer` and perform the
 * initial render. Owns renderable construction, keypress subscription,
 * `dashboard.content` writes, and `requestRender`. The host keeps startup
 * behavior (path resolution, fail-fast, exit codes) and `renderer.start()`.
 */
export async function mountApp(
  renderer: CliRenderer,
  deps: MountAppDeps,
): Promise<MountedApp> {
  const {
    BoxRenderable,
    RGBA,
    StyledText,
    bold,
    brightYellow,
    stringToStyledText,
    TextRenderable,
  } = deps.core;
  const now = deps.now ?? (() => new Date().toISOString());
  const sourcePath = deps.sourcePath;

  const shell = new BoxRenderable(renderer, {
    id: "fund-composition-shell",
    width: "100%",
    height: "100%",
    border: true,
    borderColor: RGBA.defaultForeground(),
    title: " Numisma Fund Composition ",
    padding: 1,
  });

  const dashboard = new TextRenderable(renderer, {
    id: "fund-composition-dashboard",
    content: "Loading Fund review data...",
    width: "100%",
    height: "100%",
    fg: RGBA.defaultForeground(),
    wrapMode: "none",
    selectable: true,
  });

  shell.add(dashboard);
  renderer.root.add(shell);

  let currentReview:
    | { data: FundReviewData; report: CompositionReport }
    | undefined;
  let state: InteractionState = { selectedLine: 0 };

  /**
   * Build the visible lines for a drill-down state via the engine. This is the
   * one place the wiring touches `buildDashboardDetail`/`buildDashboardLines`;
   * the pure core consults it through the `relayout` seam.
   */
  function buildLines(
    activeRowId: string | undefined,
    activeRecordId: string | undefined,
  ): DashboardLine[] {
    if (!currentReview) {
      return [];
    }
    const detail = activeRowId
      ? buildDashboardDetail(
          currentReview.data,
          currentReview.report,
          activeRowId,
        )
      : undefined;
    return buildDashboardLines(currentReview.report, detail, activeRecordId);
  }

  async function refresh(): Promise<void> {
    dashboard.content = `Reloading Fund review data...\n\nData file: ${sourcePath}`;
    renderer.requestRender();

    try {
      const data = await deps.loadData();
      const report = buildCompositionReport(data, {
        load: {
          status: "loaded",
          sourcePath,
          loadedAt: now(),
        },
      });
      currentReview = { data, report };
      state = reloadOutcome(state, { ok: true });
      renderDashboard();
    } catch (error) {
      currentReview = undefined;
      state = reloadOutcome(state, { ok: false });
      dashboard.content = renderLoadFailureText({
        status: "load-failed",
        sourcePath,
        loadedAt: now(),
        message: error instanceof Error ? error.message : String(error),
      });
    }
    renderer.requestRender();
  }

  renderer.keyInput.on("keypress", (key) => {
    const intent = mapKeyToIntent(key);
    if (!intent) {
      return;
    }

    if (intent.type === "quit") {
      renderer.destroy();
      return;
    }

    if (intent.type === "reload") {
      void refresh();
      return;
    }

    if (!currentReview) {
      return;
    }

    const lines = buildLines(state.activeRowId, state.activeRecordId);
    state = reduce(lines, state, intent, buildLines);
    renderDashboard();
  });

  function renderDashboard(): void {
    if (!currentReview) {
      return;
    }

    const detail = state.activeRowId
      ? buildDashboardDetail(
          currentReview.data,
          currentReview.report,
          state.activeRowId,
        )
      : undefined;
    if (state.activeRowId && !detail) {
      state = { ...state, activeRowId: undefined };
    }

    const lines = buildDashboardLines(
      currentReview.report,
      detail,
      state.activeRecordId,
    );
    state = { ...state, selectedLine: normalizeSelection(lines, state.selectedLine) };
    dashboard.content = renderStyledDashboard(
      lines,
      `\n${renderLoadFooter(currentReview.report.load)}`,
    );
    dashboard.scrollY = keepSelectionInView({
      selectedLine: state.selectedLine,
      lineCount: lines.length,
      viewportHeight: dashboard.height,
      scrollTop: dashboard.scrollY,
    });
    renderer.requestRender();
  }

  function renderStyledDashboard(
    lines: DashboardLine[],
    footer: string,
  ): import("@opentui/core").StyledText {
    const chunks: import("@opentui/core").TextChunk[] = [];
    for (const [index, line] of lines.entries()) {
      const renderedLine = renderLine(line, index, state.selectedLine);
      if (line.warning) {
        chunks.push(bold(brightYellow(renderedLine)));
      } else {
        chunks.push(...stringToStyledText(renderedLine).chunks);
      }
      chunks.push(...stringToStyledText("\n").chunks);
    }
    chunks.push(...stringToStyledText(footer).chunks);
    return new StyledText(chunks);
  }

  await refresh();

  return { refresh };
}
