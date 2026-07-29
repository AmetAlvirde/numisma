// ============================================================================
// THROWAWAY PROTOTYPE SCAFFOLDING — DELETE THIS FILE BEFORE MERGE. It is not part
// of any app, has no callers, and is not wired into CI. It exists to make the
// `plans.jsonl` sidecar prototype judgeable by someone who is not its author.
// ============================================================================
//
// Drives the REAL sidecar IO (`appendPlan` / `appendNoPlan` / `loadPlans`) and the
// REAL pure selectors (`pickPlanAsOf` / `listPlansAsOf`) against a scratch data dir,
// then ASSERTS every claim — exit 1 on any miss, so this is a check, not a printout.
//
// The points being demonstrated (`S1`–`S7` of the sidecar-door grill):
//   1. A plan SUPERSEDES by appending; the superseded line still replays as-of.
//   2. `noPlan` ENDS a plan, and `ended` is distinguishable from `none`.
//   3. Resumption after `noPlan` is just a later plan line.
//   4. An UNKNOWN kind is skipped, RETURNED, and attributed to its position —
//      never a global error, never a silent drop.
//   5. A skipped line that SUPERSEDES a readable one makes the answer `unreadable`,
//      because returning the older plan would be wrong, not merely incomplete.
//   6. A corrupt line is quarantined and DISTINGUISHED from an unknown kind.
//
// EVERY LADDER BELOW IS SYNTHETIC (`S8`). The real rung prices and sizes are
// FIGURES, they live in accumulus, and they are deliberately absent here.
//
// Requires NUMISMA_DATA_DIR pointing at a SCRATCH directory; it refuses to run
// against the real ~/Dev/accumulus data, exactly as the ReserveOpened demo did.
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { listPlansAsOf, pickPlanAsOf, type PlanLookup } from "@numisma/engine";
import { appendNoPlan, appendPlan, loadPlans, resolvePlansPath } from "./src/plans.js";

const dataDir = process.env.NUMISMA_DATA_DIR;
if (!dataDir) {
  console.error("Set NUMISMA_DATA_DIR to a SCRATCH directory. Refusing to guess.");
  process.exit(1);
}
// Guard the private durable data: this demo WRITES, so it must never be aimed at the
// real repo. Decision 7 puts accumulus out of this prototype's scope entirely.
if (resolve(dataDir).startsWith(resolve(process.env.HOME ?? "", "Dev/accumulus"))) {
  console.error(`Refusing to write to the real data repo at ${dataDir}. Use a scratch dir.`);
  process.exit(1);
}

const failures: string[] = [];

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: ${JSON.stringify(actual)}`);
  if (!ok) {
    failures.push(`${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}

/** Collapse a lookup to the one word a surface would render. */
function describeLookup(lookup: PlanLookup): string {
  switch (lookup.status) {
    case "none":
      return "no plan";
    case "active":
      return `active ${lookup.plan.kind} @ ${lookup.plan.effectiveAt}`;
    case "ended":
      return `ended @ ${lookup.plan.effectiveAt}${lookup.plan.reason ? ` (${lookup.plan.reason})` : ""}`;
    case "unreadable":
      return "NOT READABLE";
  }
}

const path = resolvePlansPath(dataDir);
// Start from a clean sheet so the demo is idempotent across runs.
await rm(path, { force: true });
console.log(`plan sidecar: ${path}\n`);

const POS_A = "pos-synthetic-A";
const POS_B = "pos-synthetic-B";

// ---------------------------------------------------------------------------
// Build a synthetic history through the REAL append-only writer.
// ---------------------------------------------------------------------------
// Position A: a ladder, re-priced in July, ended in August, resumed in September.
await appendPlan(path, {
  kind: "dcaLadder",
  positionId: POS_A,
  effectiveAt: "2026-06-01",
  tierOrder: ["c1", "c2"],
  rungs: [
    { id: "a-r1", priceUsd: 50_000, sizeUsd: 100 },
    { id: "a-r2", priceUsd: 45_000, sizeUsd: 200 },
  ],
});
await appendPlan(path, {
  kind: "dcaLadder",
  positionId: POS_A,
  effectiveAt: "2026-07-01",
  // The tier ordering rides on the plan (`S1`) — re-ordering is just a new line.
  tierOrder: ["c2", "c1"],
  rungs: [
    { id: "a-r1", priceUsd: 48_000, sizeUsd: 150 },
    { id: "a-r2", priceUsd: 43_000, sizeUsd: 250 },
  ],
});
await appendNoPlan(path, POS_A, "2026-08-01", "ladder fully filled");
await appendPlan(path, {
  kind: "dcaTime",
  positionId: POS_A,
  effectiveAt: "2026-09-01",
  tierOrder: ["c1"],
  cadence: "weekly",
  amountUsd: 50,
  startsAt: "2026-09-01",
});

// Position B: a readable ladder, then a line written by a NEWER build.
await appendPlan(path, {
  kind: "dcaLadder",
  positionId: POS_B,
  effectiveAt: "2026-06-15",
  tierOrder: ["c1"],
  rungs: [{ id: "b-r1", priceUsd: 60_000, sizeUsd: 300 }],
});
// Hand-written because the typed writer cannot express a kind this build lacks —
// which is the whole point: this is what an OLDER CHECKOUT meets in NEWER DATA.
const { appendFile } = await import("node:fs/promises");
await appendFile(
  path,
  `${JSON.stringify({
    kind: "dcaVolatilityBand",
    positionId: POS_B,
    effectiveAt: "2026-07-15",
    band: "whatever a later build understands",
  })}\n`,
  "utf8",
);
// And one genuinely corrupt line, attributable to nobody.
await appendFile(path, "{ this is not json\n", "utf8");

// ---------------------------------------------------------------------------
// Read it back through the REAL loader.
// ---------------------------------------------------------------------------
const loaded = await loadPlans(path);

console.log("===== LOADED =====");
console.log(`  readable plans: ${loaded.plans.length}`);
for (const skip of loaded.unknownKind) {
  console.log(`  ! unknownKind  line ${skip.line}  position=${skip.positionId}  ${skip.detail}`);
}
for (const skip of loaded.invalid) {
  console.log(`  ! invalid      line ${skip.line}  position=${skip.positionId ?? "(unattributed)"}  ${skip.detail}`);
}

console.log("\n===== POSITION A THROUGH TIME =====");
for (const asOf of ["2026-05-15", "2026-06-15", "2026-07-15", "2026-08-15", "2026-09-15"]) {
  console.log(`  ${asOf}  ${describeLookup(pickPlanAsOf(loaded, POS_A, asOf))}`);
}

console.log("\n===== POSITION B THROUGH TIME =====");
for (const asOf of ["2026-06-20", "2026-07-20"]) {
  console.log(`  ${asOf}  ${describeLookup(pickPlanAsOf(loaded, POS_B, asOf))}`);
}

console.log("\n===== ASSERTIONS =====");

check("readable plans loaded", loaded.plans.length, 5);
check("unknownKind skips", loaded.unknownKind.length, 1);
check("invalid skips", loaded.invalid.length, 1);

// 1. Supersede — and the superseded line still replays.
check(
  "A @ 06-15 is June's ladder",
  describeLookup(pickPlanAsOf(loaded, POS_A, "2026-06-15")),
  "active dcaLadder @ 2026-06-01",
);
check(
  "A @ 07-15 is July's ladder",
  describeLookup(pickPlanAsOf(loaded, POS_A, "2026-07-15")),
  "active dcaLadder @ 2026-07-01",
);
const juneA = pickPlanAsOf(loaded, POS_A, "2026-06-15");
check(
  "June's tier ordering replays unchanged by July's re-order",
  juneA.status === "active" ? juneA.plan.tierOrder : null,
  ["c1", "c2"],
);

// 2/3. noPlan ends; resumption is a later line. And `none` != `ended`.
check(
  "A before its first plan is `none`",
  pickPlanAsOf(loaded, POS_A, "2026-05-15").status,
  "none",
);
check(
  "A @ 08-15 is ENDED, not `none`",
  describeLookup(pickPlanAsOf(loaded, POS_A, "2026-08-15")),
  "ended @ 2026-08-01 (ladder fully filled)",
);
check(
  "A @ 09-15 RESUMED under a different kind",
  describeLookup(pickPlanAsOf(loaded, POS_A, "2026-09-15")),
  "active dcaTime @ 2026-09-01",
);

// 4/5. The unknown kind is attributed, and it supersedes B's readable ladder.
const skip = loaded.unknownKind[0];
check("the skip names its position", skip?.positionId, POS_B);
check("the skip names its date", skip?.effectiveAt, "2026-07-15");
check("the skip names the kind this build lacks", skip?.kind, "dcaVolatilityBand");
check(
  "B @ 06-20 (before the unreadable line) still reads its ladder",
  describeLookup(pickPlanAsOf(loaded, POS_B, "2026-06-20")),
  "active dcaLadder @ 2026-06-15",
);
check(
  "B @ 07-20 is NOT READABLE — the unreadable line superseded the ladder",
  describeLookup(pickPlanAsOf(loaded, POS_B, "2026-07-20")),
  "NOT READABLE",
);

// 6. The corrupt line is quarantined, attributed to nobody, and poisons no row.
check("the corrupt line is `invalid`, not `unknownKind`", loaded.invalid[0]?.reason, "invalid");
check("the corrupt line names no position", loaded.invalid[0]?.positionId, undefined);
const listed = listPlansAsOf(loaded, "2026-09-15");
check("both positions are listed", listed.positions.map((p) => p.positionId), [POS_A, POS_B]);
check(
  "the corrupt line is surfaced as unattributable, not dropped",
  listed.unattributable.length,
  1,
);
check(
  "and it did NOT blank out position A",
  listed.positions.find((p) => p.positionId === POS_A)?.lookup.status,
  "active",
);

// The durability trap this prototype deliberately does NOT close.
console.log(
  "\nNOTE: `plans.jsonl` is NOT yet in accumulus's .gitignore allowlist or in\n" +
    "      TRACKED_FILES — so in the real data repo it would be written and never\n" +
    "      committed. That two-repo edit and its guard test belong to the real\n" +
    "      increment (Decision 7), not to this specimen.",
);

if (failures.length > 0) {
  console.error(`\nFAILED (${failures.length}):`);
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}
console.log("\nOK — all assertions passed. Supersede, end, resume, skip-and-warn all hold.");
