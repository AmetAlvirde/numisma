import { parseFundReview } from "@numisma/engine"
import { mountApp } from "./mount-app.js"

const core = await loadOpenTuiCore()
const { createTestRenderer } = await loadOpenTuiTesting()
const { renderer, mockInput, renderOnce, captureCharFrame } = await createTestRenderer({ width: 120, height: 36 })
const parsed = parseFundReview({
  fund: {
    id: "smoke-fund",
    name: "Smoke Fund",
    baseCurrency: "USD",
  },
  review: {
    asOf: "2026-05-28",
    usdMxn: 17.32,
  },
  portfolios: [{ id: "core", name: "Core" }],
  accounts: [
    {
      id: "xtb",
      name: "XTB Broker",
      platform: "XTB",
      currency: "USD",
    },
  ],
  instruments: [
    {
      id: "aapl-usd",
      name: "Apple Inc.",
      symbol: "AAPL",
      currency: "USD",
    },
  ],
  reserves: [
    {
      id: "usd-reserve",
      portfolioId: "core",
      tempo: "Reserve",
      executionMode: "live",
      accountId: "xtb",
      currency: "USD",
      amount: 500,
    },
  ],
  positions: [
    {
      id: "aapl-capital",
      portfolioId: "core",
      tempo: "Capital",
      executionMode: "live",
      accountId: "xtb",
      instrumentId: "aapl-usd",
      direction: "long",
      lots: [{ quantity: 2, cost: 195, tier: "c1" }],
      markPrice: 205,
      currency: "USD",
    },
  ],
})
if (parsed.kind !== "ok") {
  throw new Error(`Expected smoke fixture to parse, got ${parsed.kind}`)
}

await mountApp(renderer, {
  core,
  loadData: async () => parsed.value,
  sourcePath: "smoke-openTui in-memory fixture",
})

await renderOnce()
const frameInitial = captureCharFrame()
if (frameInitial.includes("Selected Row Detail")) {
  throw new Error("openTUI smoke started with a detail row already open.")
}
const initialCursorLine = cursorLine(frameInitial)
if (initialCursorLine === undefined) {
  throw new Error("openTUI smoke initial frame rendered no selection cursor.")
}

// Drive the live interactive path: move the cursor down, back up, then open the
// selected row's detail. These bytes flow through the real openTUI keypress
// parser via the shared mountApp wiring the app uses.
mockInput.pressKey("j")
await renderOnce()
const frameAfterDown = captureCharFrame()
const cursorAfterDown = cursorLine(frameAfterDown)
if (cursorAfterDown === undefined || cursorAfterDown === initialCursorLine) {
  throw new Error(
    `openTUI smoke 'j' keypress did not move the cursor (before: ${String(initialCursorLine)}, after: ${String(cursorAfterDown)}).`,
  )
}

mockInput.pressKey("k")
await renderOnce()

mockInput.pressEnter()
await renderOnce()
const frameAfterEnter = captureCharFrame()
renderer.destroy()

if (!frameAfterEnter.includes("Selected Row Detail")) {
  throw new Error("openTUI smoke 'enter' keypress did not render a drill-down detail row.")
}

process.stdout.write("openTUI smoke render completed.\n")

// Returns the content of the line carrying the selection cursor ('>' glyph), or
// undefined if no cursor is present. The glyph is whitespace-preceded ("> text"),
// which distinguishes it from the " -> " arrows in price-journey rows. Used to
// prove the cursor moved.
function cursorLine(frame: string): string | undefined {
  for (const line of frame.split("\n")) {
    const match = /(?:^|\s)(> \S.*)$/.exec(line)
    if (match?.[1]) {
      return match[1].trimEnd()
    }
  }
  return undefined
}

async function loadOpenTuiCore(): Promise<typeof import("@opentui/core")> {
  try {
    return await import("@opentui/core")
  } catch (error) {
    throw openTuiRuntimeError(error)
  }
}

async function loadOpenTuiTesting(): Promise<typeof import("@opentui/core/testing")> {
  try {
    return await import("@opentui/core/testing")
  } catch (error) {
    throw openTuiRuntimeError(error)
  }
}

function openTuiRuntimeError(error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error)
  return new Error(
    `openTUI could not load in this runtime. @opentui/core currently needs Bun or a Node build that exposes node:ffi. This prototype uses Bun only to run openTUI while keeping pnpm for package management. Runtime: ${process.release.name} ${process.version}. Original error: ${detail}`,
  )
}
