import { resolve } from "node:path";
import {
  buildCompositionReport,
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

async function refresh(): Promise<void> {
  dashboard.content = `Reloading Fund review data...\n\nData file: ${filePath}`;
  renderer.requestRender();

  try {
    const data = await loadFundReview(filePath);
    const report = buildCompositionReport(data);
    dashboard.content = `${formatCompositionReport(report)}\n\nLoaded: ${formatLoadTime(new Date())}\nData file: ${filePath}`;
  } catch (error) {
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
