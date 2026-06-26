import { loadFundReview, resolveFundReviewFilePath } from "./review-file.js";
import { mountApp } from "./mount-app.js";

const filePath = resolveStartupFundReviewFilePath();
const core = await loadOpenTuiCore();
const renderer = await core.createCliRenderer({
  exitOnCtrlC: true,
  clearOnShutdown: true,
  consoleMode: "disabled",
  screenMode: "alternate-screen",
  targetFps: 20,
});

await mountApp(renderer, {
  core,
  loadData: () => loadFundReview(filePath),
  sourcePath: filePath,
});

renderer.start();

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
