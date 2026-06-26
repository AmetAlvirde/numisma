# Lot- and Capital-Tier-attributed cost model

_Made during: MVI — valuation history + capital genealogy increment / prototype iterations 1–3 (cash extension added in iteration 3)_
_Scope: product_
_Status: accepted_

Held capital is modeled as an array of **Lots** carrying **Capital Tier**
(c1/c2/c3) attribution, rather than a single flat amount: a **Position** Lot binds
`(quantity, cost, tier, entryFx)`, and a **Reserve** (cash) Lot is the degenerate
`(quantity, tier)` where value == cost and Price P&L == 0. Market value converts
at the current review FX while each Position Lot's cost basis converts at its own
entry FX, so unrealized P&L — and the seed-vs-house-money split across the *whole*
fund, not just open positions — can be attributed by Capital Tier. This is the
only model under which the two features of this increment (capital genealogy =
cost provenance; weekly valuation = market price) can answer "what is the gain on
my c2 tier?", which a single flat amount structurally cannot.

## Considered Options

- **Single `averageCost` per Position / flat `amount` per Reserve (status quo).**
  Rejected: collapses all tiers into one number, so per-tier P&L — the core value
  of the genealogy feature — is unrecoverable.
- **Build markPrice/valuation first, add Lots after (initial instinct).**
  Rejected in favor of **Lots-first**: building valuation onto the final record
  shape means `Close` and P&L compute over Lots once, instead of being reworked
  when genealogy lands.
- **Cost basis at the current review FX (prior engine behavior).** Rejected:
  discards the entry FX the source records preserve (e.g. 18.57 vs 17.23), folding
  an FX gain/loss into the cost figure. Per-Lot `entryFx` keeps the FX component of
  P&L honest and separable.
- **Exclude cash from the tier rollup; label the table "of invested capital"**
  (the prototype's Iteration-1 lean). Rejected: in the real dataset most realized
  profit is parked as house-money cash, so a tier table that omits it understates
  the c2/c3 answer it exists to give. Cash is tiered via Lots instead, and the
  rollup is made honest about partial coverage (see Consequences) rather than
  hidden behind a narrower label.
- **A new cash-lineage type instead of reusing `Lot`.** Rejected: same
  architectural commitment widened, not a new one; reuse avoids a parallel
  concept. ("tranche" stays a banned alias for Capital Tier.)

## Consequences

- Capital Tier attribution is **opt-in per record**: a Position/Reserve with no
  Lots is untiered and behaves as before (back-compat). Untraceable/blended cash
  stays untiered rather than being forced into a false c1, so the **tier total
  deliberately sits below 100%** of the fund by the untraced remainder — a feature
  (honest partial attribution), not a bug.
- Reserve Lot sums that do not reconcile to the record's `amount` emit a
  `reserve-lot-sum-mismatch` **warning**, not a blocking error; `amount` stays the
  authoritative value and Lots are taken as-given for the split. The warning
  vocabulary + a test must be real, or fixtures can drift unnoticed.
- Cash stays FX-flat: a cash Lot has no `entryFx` and no Price P&L; FX P&L on idle
  foreign (MXN) cash is a separate, deferred Performance-Layer question.
- Depends on broadening the glossary relationship from "A Position contains Lots"
  to "A Position or Reserve contains zero or more Lots" (pending approval). The
  reliable increment must drop the `quantity`/`averageCost` back-compat shim
  (`normalizePositionLots`), at which point the fixture format freezes.
- `Close` remains display-only in the prototype (it feeds the price journey, not
  valuation); `markPrice` stays the P&L input. Wiring valuation to the latest
  `Close` is a separate, still-open decision, deliberately *not* fixed here.
