import {
  buildCompositionReport,
  type CompositionReport,
  type FundReviewData,
  formatCompositionReport,
  loadFundReview,
} from "./fund-composition.js";
import { resolveFundReviewFilePath } from "./review-file.js";

const filePath = resolveFundReviewFilePath(process.argv);
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

type DashboardAction =
  | {
      type: "portfolio-detail";
      portfolioId: string;
      label: string;
    }
  | {
      type: "tempo-detail";
      tempo: string;
      label: string;
    }
  | {
      type: "account-detail";
      accountId: string;
      label: string;
    };

type DashboardLineAction = DashboardAction | { type: "collapse-detail" };

type DashboardLine = {
  content: string;
  selectable: boolean;
  warning?: boolean;
  action?: DashboardLineAction;
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

function renderDashboard(): void {
  if (!currentReview) return;

  const lines = buildDashboardLines(
    currentReview.data,
    currentReview.report,
    activeDetail,
  );
  selectedLine = normalizeSelection(lines, selectedLine);
  dashboard.content = renderStyledDashboard(
    lines,
    `\n\nLoaded: ${formatLoadTime(currentReview.loadedAt)}\nData file: ${filePath}`,
  );
  keepSelectionInView(lines);
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

  if (action.type === "collapse-detail") {
    activeDetail = undefined;
    renderDashboard();
    return;
  }

  activeDetail = action;
  selectedLine = detailInsertIndex(lines, currentReview.report, action) + 1;
  renderDashboard();
}

function buildDashboardLines(
  data: FundReviewData,
  report: CompositionReport,
  detail: DashboardAction | undefined,
): DashboardLine[] {
  let inWarnings = false;
  const lines = formatCompositionReport(report)
    .split("\n")
    .filter((content) => !content.startsWith("Keys:"))
    .map<DashboardLine>((content) => ({
      content,
      selectable: content.trim().length > 0,
      warning: isWarningLine(content),
    }));
  attachPortfolioActions(lines, data, report);
  attachTempoActions(lines, report);
  attachAccountActions(lines, data, report);

  if (detail) {
    lines.splice(
      detailInsertIndex(lines, report, detail),
      0,
      { content: "", selectable: false },
      {
        content: "Selected Row Detail  [enter collapse]",
        selectable: true,
        action: { type: "collapse-detail" },
      },
      { content: "-------------------", selectable: true },
      ...formatDetail(data, detail),
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

  function isWarningLine(content: string): boolean {
    if (content === "!!! WARNINGS !!!") {
      inWarnings = true;
      return true;
    }
    if (content === "") {
      inWarnings = false;
      return false;
    }
    return inWarnings && content.startsWith("- ");
  }
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

function attachTempoActions(
  lines: DashboardLine[],
  report: CompositionReport,
): void {
  const sectionIndex = lines.findIndex(
    (line) => line.content === "Tempo Composition",
  );
  if (sectionIndex < 0) return;

  const firstTempoRow = sectionIndex + 4;
  for (const [index, row] of report.groups.tempos.entries()) {
    const line = lines[firstTempoRow + index];
    if (!line) continue;

    line.action = {
      type: "tempo-detail",
      tempo: row.label,
      label: row.label,
    };
    line.content = `${line.content}  [enter details]`;
  }
}

function attachAccountActions(
  lines: DashboardLine[],
  data: FundReviewData,
  report: CompositionReport,
): void {
  const sectionIndex = lines.findIndex(
    (line) => line.content === "Account Composition",
  );
  if (sectionIndex < 0) return;

  const firstAccountRow = sectionIndex + 4;
  for (const [index, row] of report.groups.accounts.entries()) {
    const line = lines[firstAccountRow + index];
    const account = data.accounts.find(
      (item) => `${item.platform}: ${item.name}` === row.label,
    );
    if (!line || !account) continue;

    line.action = {
      type: "account-detail",
      accountId: account.id,
      label: `${account.platform}: ${account.name}`,
    };
    line.content = `${line.content}  [enter details]`;
  }
}

function detailInsertIndex(
  lines: DashboardLine[],
  report: CompositionReport,
  detail: DashboardAction,
): number {
  if (detail.type === "portfolio-detail") {
    return sectionEndIndex(lines, "Portfolio Composition", report.groups.portfolios.length);
  }
  if (detail.type === "tempo-detail") {
    return sectionEndIndex(lines, "Tempo Composition", report.groups.tempos.length);
  }
  return sectionEndIndex(lines, "Account Composition", report.groups.accounts.length);
}

function sectionEndIndex(
  lines: DashboardLine[],
  sectionTitle: string,
  rowCount: number,
): number {
  const sectionIndex = lines.findIndex((line) => line.content === sectionTitle);
  return sectionIndex < 0 ? lines.length : sectionIndex + 4 + rowCount;
}

function formatDetail(
  data: FundReviewData,
  detail: DashboardAction,
): DashboardLine[] {
  if (detail.type === "portfolio-detail") {
    return formatPortfolioDetail(data, detail.portfolioId);
  }
  if (detail.type === "tempo-detail") {
    return formatTempoDetail(data, detail.tempo);
  }
  return formatAccountDetail(data, detail.accountId);
}

function formatTempoDetail(data: FundReviewData, tempo: string): DashboardLine[] {
  const portfolios = new Map(
    data.portfolios.map((portfolio) => [portfolio.id, portfolio]),
  );
  const accounts = new Map(data.accounts.map((account) => [account.id, account]));
  const instruments = new Map(
    data.instruments.map((instrument) => [instrument.id, instrument]),
  );

  const reserveRows = data.reserves
    .filter(
      (reserve) => isLiveValidReserve(reserve) && reserve.tempo === tempo,
    )
    .map<DashboardLine>((reserve) => {
      const portfolio = portfolios.get(reserve.portfolioId);
      const account = accounts.get(reserve.accountId);
      return {
        content: `${pad("Reserve", 10)} ${pad("Reserve", 26)} ${pad(portfolio?.name ?? reserve.portfolioId, 16)} ${pad(account ? `${account.platform}: ${account.name}` : reserve.accountId, 24)} ${padLeft(formatUsd(toUsd(reserve.amount, reserve.currency, data.review.usdMxn)), 14)}`,
        selectable: true,
      };
    });
  const positionRows = data.positions
    .filter(
      (position) => isLiveValidPosition(position) && position.tempo === tempo,
    )
    .map<DashboardLine>((position) => {
      const instrument = instruments.get(position.instrumentId);
      const portfolio = portfolios.get(position.portfolioId);
      const account = accounts.get(position.accountId);
      const marketValue =
        position.quantity *
        position.markPrice *
        (position.direction === "short" ? -1 : 1);
      return {
        content: `${pad("Position", 10)} ${pad(instrument ? `${instrument.symbol} (${instrument.name})` : position.instrumentId, 26)} ${pad(portfolio?.name ?? position.portfolioId, 16)} ${pad(account ? `${account.platform}: ${account.name}` : position.accountId, 24)} ${padLeft(formatUsd(toUsd(marketValue, position.currency, data.review.usdMxn)), 14)}`,
        selectable: true,
      };
    });
  const rows = [...reserveRows, ...positionRows];
  const header = `${pad("Type", 10)} ${pad("Record", 26)} ${pad("Portfolio", 16)} ${pad("Account", 24)} ${padLeft("USD Value", 14)}`;

  return [
    { content: `Tempo: ${tempo}`, selectable: true },
    { content: "Live Records", selectable: true },
    { content: header, selectable: true },
    { content: "-".repeat(header.length), selectable: true },
    ...(rows.length > 0
      ? rows
      : [{ content: "No live records in this Tempo.", selectable: true }]),
  ];
}

function formatAccountDetail(
  data: FundReviewData,
  accountId: string,
): DashboardLine[] {
  const account = data.accounts.find((item) => item.id === accountId);
  const portfolios = new Map(
    data.portfolios.map((portfolio) => [portfolio.id, portfolio]),
  );
  const instruments = new Map(
    data.instruments.map((instrument) => [instrument.id, instrument]),
  );
  const positions = data.positions.filter(
    (position) =>
      isLiveValidPosition(position) && position.accountId === accountId,
  );
  const title = `Account: ${account ? `${account.platform}: ${account.name}` : accountId}`;
  const header = `${pad("Position", 26)} ${pad("Portfolio", 16)} ${pad("Tempo", 10)} ${padLeft("USD Value", 14)}`;
  const body = positions.map<DashboardLine>((position) => {
    const instrument = instruments.get(position.instrumentId);
    const portfolio = portfolios.get(position.portfolioId);
    const marketValue =
      position.quantity *
      position.markPrice *
      (position.direction === "short" ? -1 : 1);
    return {
      content: `${pad(instrument ? `${instrument.symbol} (${instrument.name})` : position.instrumentId, 26)} ${pad(portfolio?.name ?? position.portfolioId, 16)} ${pad(position.tempo, 10)} ${padLeft(formatUsd(toUsd(marketValue, position.currency, data.review.usdMxn)), 14)}`,
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
      : [{ content: "No live Positions in this Account.", selectable: true }]),
  ];
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
      isLiveValidPosition(position) && position.portfolioId === portfolioId,
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

function renderStyledDashboard(
  lines: DashboardLine[],
  suffix: string,
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
  chunks.push(...stringToStyledText(suffix).chunks);
  return new StyledText(chunks);
}

function renderLine(line: DashboardLine, index: number): string {
  if (!line.selectable) return `  ${line.content}`;
  const cursor = index === selectedLine ? ">" : " ";
  return `${cursor} ${line.content}`;
}

function keepSelectionInView(lines: DashboardLine[]): void {
  if (lines.length === 0 || dashboard.height <= 0) return;

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

function isLiveValidReserve(
  reserve: FundReviewData["reserves"][number],
): boolean {
  return (
    reserve.executionMode === "live" &&
    isSupportedCurrency(reserve.currency) &&
    isNonNegativeNumber(reserve.amount)
  );
}

function isLiveValidPosition(
  position: FundReviewData["positions"][number],
): boolean {
  return (
    position.executionMode === "live" &&
    isSupportedCurrency(position.currency) &&
    isDirection(position.direction) &&
    isNonNegativeNumber(position.quantity) &&
    isNonNegativeNumber(position.averageCost) &&
    isNonNegativeNumber(position.markPrice)
  );
}

function isSupportedCurrency(currency: unknown): currency is "USD" | "MXN" {
  return currency === "USD" || currency === "MXN";
}

function isDirection(direction: unknown): direction is "long" | "short" {
  return direction === "long" || direction === "short";
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
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
