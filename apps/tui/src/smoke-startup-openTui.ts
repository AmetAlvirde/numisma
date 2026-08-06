/**
 * openTUI startup verification (ADR-003 slice 5, issue #80). The one product
 * surface the prototype never ran: the real `pnpm dev` path under Bun. The Node
 * tracer (`pnpm spine`) proved the spine; this drives the SAME startup data path
 * (`prepareStartup`: ingest → report → fold) through the SAME render wiring
 * (`mountApp`) on the real openTUI renderer, against a real on-disk event store,
 * and asserts the five `pnpm spine` targets on the render surface:
 *
 *   1. ingest + dedup counts surfaced ("N new, M duplicate")
 *   2. mutated current state renders (an inbox-opened Position appears)
 *   3. two as-of snapshots (current vs `--as-of` differ, as the fold dictates)
 *   4. render parity with the tracer (the same folded fund value, two formatters)
 *   5. restart survival (inbox absent → byte-identical frame from genesis + log)
 *
 * openTUI needs Bun, so this is a Bun script (run via `pnpm smoke:startup`), not a
 * vitest test. The half before the renderer is also covered headlessly in
 * `startup.test.ts`; this closes the gap to the actual rendered surface. The one
 * residual manual step (the real alternate-screen terminal, not the test renderer)
 * is documented in the issue's Testing Notes.
 */
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { tmpdir } from "node:os"
import { buildCompositionReport, formatCompositionReport, formatUsd } from "@numisma/engine"
import { mountApp } from "./mount-app.js"
import {
  loadFoldedReview,
  resolveEventStorePaths,
  type EventStorePaths,
} from "@numisma/event-store"
import { prepareStartup } from "./startup.js"

const FIXED_NOW = "2026-06-29T14:03:22.000Z"

const DECISION = {
  entryThesis: "thesis",
  invalidationCondition: "invalidation",
  riskBudget: "1R",
  plannedHoldingHorizon: "weeks",
  strategy: "trend",
}

const core = await loadOpenTuiCore()
const testing = await loadOpenTuiTesting()

const paths = await makeStore()
try {
  // 1. Real startup data path: ingest the inbox off disk and surface the counts.
  // The inbox carries an open + a fresh mark + a re-drop of the pre-seeded log line.
  const emitted: string[] = []
  const plan = await prepareStartup(paths, ["bun", "app"], { emit: (line) => emitted.push(line) })
  assert(
    emitted.length === 1 && emitted[0] === "Numisma: 2 new transaction(s) ingested, 1 duplicate(s) skipped.",
    `startup did not surface the expected ingest report (got ${JSON.stringify(emitted)}).`,
  )
  // The inbox was consumed (archived), so the next mounts model a restart.
  assert(!(await exists(paths.inbox)), "ingest did not consume (archive) the inbox.")

  // 2 + 4. Render current state through the real wiring; cross-check the fund value
  // against the Node tracer rendering the SAME fold (two formatters, one number).
  const current = await loadFoldedReview(paths)
  const tracer = formatCompositionReport(buildCompositionReport(current))
  const fundValue = formatUsd(buildCompositionReport(current).totals.fundValueUsd)
  assert(tracer.includes(fundValue), `tracer output is missing the fund value ${fundValue}.`)

  const frameCurrent = await renderFrame(plan.loadData, plan.sourcePath)
  assert(
    frameCurrent.includes("Bitcoin"),
    "current-state frame is missing the inbox-opened Bitcoin position.",
  )
  assert(
    frameCurrent.includes("As of: 2026-06-06"),
    "current-state frame does not show the latest event date as the as-of.",
  )
  assert(
    frameCurrent.includes(fundValue),
    `current-state frame is missing the folded fund value ${fundValue} the tracer renders.`,
  )

  // 3. As-of BEFORE the Bitcoin open: the fold excludes it, and the render reflects
  // that — the same surface, a prior day's composition.
  const asOfPlan = await prepareStartup(paths, ["bun", "app", "--as-of", "2026-06-04"], { emit: () => {} })
  const frameAsOf = await renderFrame(asOfPlan.loadData, asOfPlan.sourcePath)
  assert(
    frameAsOf.includes("As of: 2026-06-04"),
    "as-of frame does not show the requested as-of date.",
  )
  assert(
    !frameAsOf.includes("Bitcoin"),
    "as-of frame (before the open) should not show the later-opened Bitcoin position.",
  )

  // 5. Restart survival: inbox absent, re-run the real startup path and re-render.
  // Genesis + log alone must reproduce the current-state frame byte-for-byte.
  const restartPlan = await prepareStartup(paths, ["bun", "app"], { emit: () => {} })
  const frameRestart = await renderFrame(restartPlan.loadData, restartPlan.sourcePath)
  assert(
    frameRestart === frameCurrent,
    "restart did not reproduce identical current-state render from genesis + log alone.",
  )

  process.stdout.write("openTUI startup verification completed (ingest + fold + as-of + restart).\n")
} finally {
  await rm(paths.root, { recursive: true, force: true })
}

/**
 * Mount the real dashboard wiring on a fresh headless openTUI renderer, render one
 * frame, and capture it. A fixed clock keeps the load-footer timestamp stable so
 * two renders of identical data are byte-identical (the restart-survival check).
 */
async function renderFrame(
  loadData: () => Promise<import("@numisma/engine").FundReviewData>,
  sourcePath: string,
): Promise<string> {
  const { renderer, renderOnce, captureCharFrame } = await testing.createTestRenderer({
    width: 120,
    height: 140,
  })
  await mountApp(renderer, { core, loadData, sourcePath, now: () => FIXED_NOW })
  await renderOnce()
  const frame = captureCharFrame()
  renderer.destroy()
  return frame
}

/** A self-contained temp event store: genesis seed + a pre-seeded log + an inbox. */
async function makeStore(): Promise<EventStorePaths & { root: string }> {
  const root = await mkdtemp(resolve(tmpdir(), "numisma-startup-smoke-"))
  const paths = resolveEventStorePaths(root)
  await writeFile(paths.genesis, JSON.stringify(genesisSeed()), "utf8")
  // A pre-existing durable log line; re-dropping it in the inbox proves dedup-by-id.
  await writeFile(paths.log, `${JSON.stringify(markPre())}\n`, "utf8")
  await mkdir(resolve(root, "inbox"), { recursive: true })
  await writeFile(paths.inbox, JSON.stringify([markPre(), openBtc(), markLate()]), "utf8")
  return { ...paths, root }
}

function genesisSeed() {
  return {
    fund: { id: "fund-1", name: "Accumulus", baseCurrency: "USD" },
    review: { asOf: "2026-06-01", usdMxn: 20 },
    portfolios: [{ id: "core", name: "Core" }],
    accounts: [{ id: "xtb-usd", name: "Main Broker", platform: "XTB", currency: "USD" }],
    instruments: [
      { id: "aapl-usd", name: "Apple Inc.", symbol: "AAPL", currency: "USD" },
      { id: "btc-usd", name: "Bitcoin", symbol: "BTC", currency: "USD" },
    ],
    reserves: [
      {
        id: "cash-core",
        portfolioId: "core",
        tempo: "Reserve",
        executionMode: "live",
        accountId: "xtb-usd",
        currency: "USD",
        amount: 1000,
      },
    ],
    positions: [
      {
        id: "aapl-core",
        portfolioId: "core",
        tempo: "Capital",
        executionMode: "live",
        accountId: "xtb-usd",
        instrumentId: "aapl-usd",
        direction: "long",
        markPrice: 150,
        currency: "USD",
        lots: [{ quantity: 2, cost: 100, tier: "c1" }],
      },
    ],
  }
}

/** Pre-seeded into the log AND re-dropped in the inbox: the duplicate-by-id case. */
function markPre() {
  return { id: "mark-pre", asOf: "2026-06-03", type: "PriceMarked", instrumentId: "aapl-usd", price: 155 }
}

function openBtc() {
  return {
    id: "open-btc",
    asOf: "2026-06-05",
    type: "PositionOpened",
    position: {
      id: "btc-core",
      portfolioId: "core",
      tempo: "Liquid",
      executionMode: "live",
      accountId: "xtb-usd",
      instrumentId: "btc-usd",
      direction: "long",
      currency: "USD",
      lots: [{ quantity: 1, cost: 100, tier: "c1" }],
    },
    decision: DECISION,
    // TOP-LEVEL on the event, not nested in `position` — `crossReferenceEvent`
    // reads `event.funding.reserveId` / `.amount`. `cash-core` is the seed's only
    // reserve, and it is USD like the position: a cross-currency funding leg is
    // refused outright. 100 matches the lot (1 × 100), leaving `cash-core` at 900.
    funding: { reserveId: "cash-core", amount: 100 },
  }
}

function markLate() {
  return { id: "mark-late", asOf: "2026-06-06", type: "PriceMarked", instrumentId: "aapl-usd", price: 160 }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`openTUI startup verification failed: ${message}`)
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
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
