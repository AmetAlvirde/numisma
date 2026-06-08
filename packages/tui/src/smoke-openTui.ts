import { buildCompositionReport, formatCompositionReport, parseFundReview } from "@numisma/engine"

const { BoxRenderable, RGBA, TextRenderable } = await loadOpenTuiCore()
const { createTestRenderer } = await loadOpenTuiTesting()
const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({ width: 120, height: 36 })
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
      quantity: 2,
      averageCost: 195,
      markPrice: 205,
      currency: "USD",
    },
  ],
})
if (parsed.kind !== "ok") {
  throw new Error(`Expected smoke fixture to parse, got ${parsed.kind}`)
}
const report = buildCompositionReport(parsed.value)

const shell = new BoxRenderable(renderer, {
  id: "smoke-shell",
  width: "100%",
  height: "100%",
  border: true,
  borderColor: RGBA.defaultForeground(),
  padding: 1,
})
const dashboard = new TextRenderable(renderer, {
  id: "smoke-dashboard",
  width: "100%",
  height: "100%",
  fg: RGBA.defaultForeground(),
  content: formatCompositionReport(report),
})

shell.add(dashboard)
renderer.root.add(shell)
await renderOnce()

const frame = captureCharFrame()
renderer.destroy()

if (!frame.includes("Canonical Summary")) {
  throw new Error("openTUI smoke render did not include the canonical summary.")
}

process.stdout.write("openTUI smoke render completed.\n")

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
