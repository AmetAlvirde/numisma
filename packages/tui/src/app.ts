import {
  buildCompositionReport,
  buildDashboardDetail,
  type CompositionReport,
  type FundReviewData,
} from "@numisma/engine";
import {
  buildDashboardLines,
  renderLoadFooter,
  renderLoadFailureText,
  type DashboardLine,
} from "./dashboard.js";
import { loadFundReview, resolveFundReviewFilePath } from "./review-file.js";

const filePath = resolveStartupFundReviewFilePath();
const {
  BoxRenderable,
  RGBA,
  StyledText,
  bold,
  brightYellow,
  createCliRenderer,
  stringToStyledText,
  TextRenderable,
} = await loadOpenTuiCore();
const renderer = await createCliRenderer({
  exitOnCtrlC: true,
  clearOnShutdown: true,
  consoleMode: "disabled",
  screenMode: "alternate-screen",
  targetFps: 20,
});

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
let selectedLine = 0;
let activeRowId: string | undefined;

async function refresh(): Promise<void> {
  dashboard.content = `Reloading Fund review data...\n\nData file: ${filePath}`;
  renderer.requestRender();

  try {
    const data = await loadFundReview(filePath);
    const report = buildCompositionReport(data, {
      load: {
        status: "loaded",
        sourcePath: filePath,
        loadedAt: new Date().toISOString(),
      },
    });
    currentReview = { data, report };
    renderDashboard();
  } catch (error) {
    currentReview = undefined;
    activeRowId = undefined;
    dashboard.content = renderLoadFailureText({
      status: "load-failed",
      sourcePath: filePath,
      loadedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
    });
  }
  renderer.requestRender();
}

renderer.keyInput.on("keypress", (key) => {
  if (key.name === "q" || (key.ctrl && key.name === "c")) {
    renderer.destroy();
    return;
  }

  if (key.name === "r") {
    void refresh();
    return;
  }

  if (key.name === "j" || key.name === "down") {
    moveSelection(1);
    return;
  }

  if (key.name === "k" || key.name === "up") {
    moveSelection(-1);
    return;
  }

  if (
    key.name === "return" ||
    key.name === "enter" ||
    key.name === "linefeed" ||
    key.sequence === "\r" ||
    key.sequence === "\n"
  ) {
    activateSelection();
  }
});

await refresh();
renderer.start();

function renderDashboard(): void {
  if (!currentReview) {
    return;
  }

  const detail = activeRowId
    ? buildDashboardDetail(currentReview.data, currentReview.report, activeRowId)
    : undefined;
  if (activeRowId && !detail) {
    activeRowId = undefined;
  }

  const lines = buildDashboardLines(currentReview.report, detail);
  selectedLine = normalizeSelection(lines, selectedLine);
  dashboard.content = renderStyledDashboard(
    lines,
    `\n${renderLoadFooter(currentReview.report.load)}`,
  );
  keepSelectionInView(lines);
  renderer.requestRender();
}

function moveSelection(delta: 1 | -1): void {
  if (!currentReview) {
    return;
  }

  const detail = activeRowId
    ? buildDashboardDetail(currentReview.data, currentReview.report, activeRowId)
    : undefined;
  const lines = buildDashboardLines(currentReview.report, detail);
  selectedLine = findNextSelectableLine(lines, selectedLine, delta);
  renderDashboard();
}

function activateSelection(): void {
  if (!currentReview) {
    return;
  }

  const detail = activeRowId
    ? buildDashboardDetail(currentReview.data, currentReview.report, activeRowId)
    : undefined;
  const lines = buildDashboardLines(currentReview.report, detail);
  const action = lines[selectedLine]?.action;
  if (!action) {
    return;
  }

  if (action.type === "collapse-detail") {
    activeRowId = undefined;
    renderDashboard();
    return;
  }

  activeRowId = action.rowId;
  const nextDetail = buildDashboardDetail(
    currentReview.data,
    currentReview.report,
    activeRowId,
  );
  const nextLines = buildDashboardLines(currentReview.report, nextDetail);
  selectedLine = nextLines.findIndex(
    (line) => line.action?.type === "collapse-detail",
  );
  renderDashboard();
}

function renderStyledDashboard(
  lines: DashboardLine[],
  footer: string,
): import("@opentui/core").StyledText {
  const chunks: import("@opentui/core").TextChunk[] = [];
  for (const [index, line] of lines.entries()) {
    const renderedLine = renderLine(line, index);
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

function renderLine(line: DashboardLine, index: number): string {
  if (!line.selectable) {
    return `  ${line.content}`;
  }
  const cursor = index === selectedLine ? ">" : " ";
  return `${cursor} ${line.content}`;
}

function keepSelectionInView(lines: DashboardLine[]): void {
  if (lines.length === 0 || dashboard.height <= 0) {
    return;
  }

  const viewportHeight = Math.max(1, dashboard.height);
  const viewportTop = dashboard.scrollY;
  const viewportBottom = viewportTop + viewportHeight - 1;

  if (selectedLine < viewportTop) {
    dashboard.scrollY = selectedLine;
    return;
  }

  if (selectedLine > viewportBottom) {
    dashboard.scrollY = selectedLine - viewportHeight + 1;
  }
}

function normalizeSelection(lines: DashboardLine[], selection: number): number {
  if (lines[selection]?.selectable) {
    return selection;
  }
  const firstSelectable = lines.findIndex((line) => line.selectable);
  return firstSelectable >= 0 ? firstSelectable : 0;
}

function findNextSelectableLine(
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

function resolveStartupFundReviewFilePath(): string {
  try {
    return resolveFundReviewFilePath(process.argv);
  } catch (error) {
    failStartup(error);
  }
}

function failStartup(error: unknown): never {
  const detail = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${detail}\n`);
  process.exit(1);
}

async function loadOpenTuiCore(): Promise<typeof import("@opentui/core")> {
  try {
    return await import("@opentui/core");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `openTUI could not load in this runtime. @opentui/core currently needs Bun or a Node build that exposes node:ffi. This prototype uses Bun only to run openTUI while keeping pnpm for package management. Runtime: ${process.release.name} ${process.version}. Original error: ${detail}`,
    );
  }
}
