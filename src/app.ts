import { resolve } from "node:path";
import {
  buildCompositionReport,
  type CompositionReport,
  type FundReviewData,
  formatCompositionReport,
  loadFundReview,
} from "./fund-composition.js";

const filePath = resolve(
  parseFileArg(process.argv) ?? "data/fund-review.sample.json",
);
const { BoxRenderable, RGBA, createCliRenderer, TextRenderable } =
  await loadOpenTuiCore();
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

type DashboardAction = {
  type: "portfolio-detail";
  portfolioId: string;
  label: string;
};

type DashboardLine = {
  content: string;
  selectable: boolean;
  action?: DashboardAction;
};

let currentReview:
  | { data: FundReviewData; report: CompositionReport; loadedAt: Date }
  | undefined;
let selectedLine = 0;
let activeDetail: DashboardAction | undefined;

async function refresh(): Promise<void> {
  dashboard.content = `Reloading Fund review data...\n\nData file: ${filePath}`;
  renderer.requestRender();

  try {
    const data = await loadFundReview(filePath);
    const report = buildCompositionReport(data);
    currentReview = { data, report, loadedAt: new Date() };
    renderDashboard();
  } catch (error) {
    currentReview = undefined;
    dashboard.content = `Could not render Fund composition.\n\n${error instanceof Error ? error.message : String(error)}\n\nData file: ${filePath}\n\nKeys: q quit | r retry`;
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

function parseFileArg(args: string[]): string | undefined {
  const fileFlagIndex = args.indexOf("--file");
  if (fileFlagIndex >= 0) {
    return args[fileFlagIndex + 1];
  }
  return args.find((arg) => arg.endsWith(".json"));
}

function renderDashboard(): void {
  if (!currentReview) return;

  const lines = buildDashboardLines(
    currentReview.data,
    currentReview.report,
    activeDetail,
  );
  selectedLine = normalizeSelection(lines, selectedLine);
  dashboard.content = `${renderLines(lines)}\n\nLoaded: ${formatLoadTime(currentReview.loadedAt)}\nData file: ${filePath}`;
  renderer.requestRender();
}

function moveSelection(delta: 1 | -1): void {
  if (!currentReview) return;

  const lines = buildDashboardLines(
    currentReview.data,
    currentReview.report,
    activeDetail,
  );
  selectedLine = findNextSelectableLine(lines, selectedLine, delta);
  renderDashboard();
}

function activateSelection(): void {
  if (!currentReview) return;

  const lines = buildDashboardLines(
    currentReview.data,
    currentReview.report,
    activeDetail,
  );
  const action = lines[selectedLine]?.action;
  if (!action) return;

  activeDetail = action;
  selectedLine = portfolioDetailInsertIndex(lines, currentReview.report) + 1;
  renderDashboard();
}

function buildDashboardLines(
  data: FundReviewData,
  report: CompositionReport,
  detail: DashboardAction | undefined,
): DashboardLine[] {
  const lines = formatCompositionReport(report)
    .split("\n")
    .filter((content) => !content.startsWith("Keys:"))
    .map<DashboardLine>((content) => ({
      content,
      selectable: content.trim().length > 0,
    }));
  attachPortfolioActions(lines, data, report);

  if (detail) {
    lines.splice(
      portfolioDetailInsertIndex(lines, report),
      0,
      { content: "", selectable: false },
      { content: "Selected Row Detail", selectable: true },
      { content: "-------------------", selectable: true },
      ...formatPortfolioDetail(data, detail.portfolioId),
    );
  }

  lines.push(
    { content: "", selectable: false },
    {
      content: "Navigation: j/down next | k/up previous | enter open row | r reload | q quit",
      selectable: true,
    },
  );

  return lines;
}

function attachPortfolioActions(
  lines: DashboardLine[],
  data: FundReviewData,
  report: CompositionReport,
): void {
  const sectionIndex = lines.findIndex(
    (line) => line.content === "Portfolio Composition",
  );
  if (sectionIndex < 0) return;

  const firstPortfolioRow = sectionIndex + 4;
  for (const [index, row] of report.groups.portfolios.entries()) {
    const line = lines[firstPortfolioRow + index];
    const portfolio = data.portfolios.find((item) => item.name === row.label);
    if (!line || !portfolio) continue;

    line.action = {
      type: "portfolio-detail",
      portfolioId: portfolio.id,
      label: portfolio.name,
    };
    line.content = `${line.content}  [enter details]`;
  }
}

function portfolioDetailInsertIndex(
  lines: DashboardLine[],
  report: CompositionReport,
): number {
  const sectionIndex = lines.findIndex(
    (line) => line.content === "Portfolio Composition",
  );
  return sectionIndex < 0
    ? lines.length
    : sectionIndex + 4 + report.groups.portfolios.length;
}

function formatPortfolioDetail(
  data: FundReviewData,
  portfolioId: string,
): DashboardLine[] {
  const portfolio = data.portfolios.find((item) => item.id === portfolioId);
  const accounts = new Map(data.accounts.map((account) => [account.id, account]));
  const instruments = new Map(
    data.instruments.map((instrument) => [instrument.id, instrument]),
  );
  const positions = data.positions.filter(
    (position) =>
      position.executionMode === "live" && position.portfolioId === portfolioId,
  );
  const title = `Portfolio: ${portfolio?.name ?? portfolioId}`;
  const header = `${pad("Position", 26)} ${pad("Tempo", 10)} ${pad("Account", 24)} ${padLeft("USD Value", 14)}`;
  const body = positions.map<DashboardLine>((position) => {
    const instrument = instruments.get(position.instrumentId);
    const account = accounts.get(position.accountId);
    const marketValue =
      position.quantity *
      position.markPrice *
      (position.direction === "short" ? -1 : 1);
    return {
      content: `${pad(instrument ? `${instrument.symbol} (${instrument.name})` : position.instrumentId, 26)} ${pad(position.tempo, 10)} ${pad(account ? `${account.platform}: ${account.name}` : position.accountId, 24)} ${padLeft(formatUsd(toUsd(marketValue, position.currency, data.review.usdMxn)), 14)}`,
      selectable: true,
    };
  });

  return [
    { content: title, selectable: true },
    { content: "Live Positions", selectable: true },
    { content: header, selectable: true },
    { content: "-".repeat(header.length), selectable: true },
    ...(body.length > 0
      ? body
      : [{ content: "No live Positions in this Portfolio.", selectable: true }]),
  ];
}

function renderLines(lines: DashboardLine[]): string {
  return lines
    .map((line, index) => {
      if (!line.selectable) return `  ${line.content}`;
      const cursor = index === selectedLine ? ">" : " ";
      return `${cursor} ${line.content}`;
    })
    .join("\n");
}

function normalizeSelection(lines: DashboardLine[], selection: number): number {
  if (lines[selection]?.selectable) return selection;
  const firstSelectable = lines.findIndex((line) => line.selectable);
  return firstSelectable >= 0 ? firstSelectable : 0;
}

function findNextSelectableLine(
  lines: DashboardLine[],
  from: number,
  delta: 1 | -1,
): number {
  if (lines.length === 0) return 0;

  let index = from;
  for (let step = 0; step < lines.length; step += 1) {
    index = (index + delta + lines.length) % lines.length;
    if (lines[index]?.selectable) return index;
  }

  return from;
}

function toUsd(amount: number, currency: "USD" | "MXN", usdMxn: number): number {
  return currency === "USD" ? amount : amount / usdMxn;
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function pad(value: string, width: number): string {
  return value.length > width
    ? `${value.slice(0, width - 1)}~`
    : value.padEnd(width);
}

function padLeft(value: string, width: number): string {
  return value.length > width ? value.slice(0, width) : value.padStart(width);
}

function formatLoadTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
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
