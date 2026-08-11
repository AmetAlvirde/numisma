/**
 * The push-side DCA builder (spec #277, slice 1) — PURE.
 *
 * Given the plans sidecar's loaded VALUE, an anchor date and the fold's born
 * positions, it produces the {@link DcaBlock} the projection payload will carry.
 *
 * IT TAKES THE LOADER'S VALUE, NEVER A PATH. The IO half (`loadPlans`,
 * `resolvePlansPath`) belongs to the push wiring one level up; handing this module a
 * `LoadedPlans` keeps it pure and unit-testable with in-memory values, and keeps the
 * disk read on the one path already privileged to do it.
 *
 * ROW ENUMERATION DELEGATES TO `listPlansAsOf`, and that delegation is the point: the
 * engine deliberately keeps ONE path through the supersession comparison, priced as
 * such in `packages/engine/src/plans.ts`, because a second path would be a silently
 * wrong ladder rather than a slow one. This builder is a NARROWING of that roster; it
 * must never become a second selector.
 *
 * WHAT IT REFUSES, each refusal a decision:
 *  - `none` rows are OMITTED. Absence is the encoding (`D5`); the wire has no arm for
 *    "the sidecar mentions this id and says nothing about it".
 *  - `endedBy`, `skipped` and the per-row `unattributable` arrays never ship. They are
 *    a conclusion's INPUTS, and the glance doctrine ships the conclusion.
 *  - Rungs are narrowed to `priceUsd`; `id` and `sizeUsd` stay off the wire.
 *  - `unattributable` ships as a count, never a line.
 *  - Nothing date-shaped is emitted at all. `asOf` is an input to the selection, never
 *    an output of it.
 *
 * RUNG ORDER IS AS DECLARED. The descending price sort is a PRESENTATION decision and
 * lives in the view composer; a builder that sorted would make the wire's order a
 * second, invisible contract.
 */
import type { IsoDate, LoadedPlans } from "@numisma/engine";
import { listPlansAsOf } from "@numisma/engine";
import type { DcaBlock, DcaPositionRow } from "../projection/contract.ts";

export function buildDcaBlock(
  loaded: LoadedPlans,
  asOf: IsoDate,
  existingPositionIds: ReadonlySet<string>,
): DcaBlock {
  const roster = listPlansAsOf(loaded, asOf, existingPositionIds);

  const positions: DcaPositionRow[] = [];
  for (const row of roster.positions) {
    const lookup = row.lookup;
    switch (lookup.status) {
      case "none":
        // The one arm with no wire representation. See the header.
        continue;
      case "pending":
      case "active": {
        const plan = lookup.plan;
        positions.push(
          plan.kind === "dcaLadder"
            ? {
                positionId: row.positionId,
                state: lookup.status,
                kind: plan.kind,
                rungs: plan.rungs.map((rung) => ({ priceUsd: rung.priceUsd })),
              }
            : { positionId: row.positionId, state: lookup.status, kind: plan.kind },
        );
        break;
      }
      case "ended":
      case "unreadable":
        positions.push({ positionId: row.positionId, state: lookup.status });
        break;
    }
  }

  return {
    // The engine's own doctrine, not this module's invention: `listPlansAsOf` already
    // returns an empty roster on a failed load, so the builder adds no special-casing
    // — it only refuses to erase the distinction between "no plans" and "the file
    // could not be read".
    source: loaded.load.status === "load-failed" ? "unreadable" : "loaded",
    positions,
    unattributable: roster.unattributable.length,
  };
}
