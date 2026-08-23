import { createFileRoute } from "@tanstack/react-router";
import { getDashboard } from "../lib/dashboard.ts";
import { Shell } from "../components/Shell.tsx";
import { Crumb } from "../components/ui/Crumb.tsx";
import {
  SnapshotEmptyNotice,
  SnapshotStaleNotice,
} from "../components/ui/SnapshotNotice.tsx";
import { FillPathCards } from "../components/FillPath.tsx";
import { composeFillPathPage } from "../ladder/fill-path-view.ts";
import { useBinanceSpotUsd } from "../lib/binance-spot.ts";
import type { SnapshotAnchor } from "../projection/contract.ts";

/**
 * `/ladder/$planId` — THE FILL PATH (spec #285 G-D13, slice #289). The third route, and
 * the answer to *where am I on the ladder?* — the question `DcaCard` on `/` raises and
 * taps through to.
 *
 * ── THE ROUTE READS CONCLUSIONS AND RECOMPUTES NO HISTORICAL FACT ───────────────────
 * Per-rung state, the join and its provenance, the figures, the orphan count and the
 * torn set were all decided by the engine's `reconcileFillPath` and shipped as
 * conclusions on the wire (spec §3). This file resolves one row and hands it to a pure
 * module; it folds no orders, sums no lots, and reads no clock. The same loader the
 * other two surfaces use serves it, so the session gate is the one that already exists.
 *
 * ── THE PARAMETER IS A UUID, AND IT IS NEVER RENDERED AS A NAME ─────────────────────
 * `planId` is the plan record's own id — a join key, chosen over an authored slug
 * precisely so no meaning can accrete in it. The route is REACHED BY TAPPING THE CARD,
 * never typed, which is why an unknown or malformed id gets an honest not-found card
 * naming which of the two it is, and never a blank page.
 *
 * ── SPOT IS FETCHED IN THE BROWSER, AND THE REASON IS NOT NEGOTIABLE ────────────────
 * `useBinanceSpotUsd` is a client hook because `api.binance.com` answers US IPs with
 * HTTP 451 and Vercel's functions are US-hosted — a loader fetch passes locally and
 * fails in production. The full reasoning lives at that one call site
 * (`lib/binance-spot.ts`); do not move the fetch into `loader` below.
 *
 * ── THE BROWSER BUNDLE GAINS NO ENGINE IMPORT ───────────────────────────────────────
 * The two spot-dependent decorations — the `next` marker and `waiting · price passed,
 * unconfirmed` — compute in `ladder/fill-path-view.ts`, a pure WEB-side module, in the
 * pattern `glance/dca-view.ts` set. The guard that HOLDS that claim is
 * `routes/route-move.test.ts`, which scans this module's whole reachable import graph
 * for an engine value import in any form. Not `client-bundle.integration.test.ts`: that
 * one scans the built bundle for credential literals and would stay green with the
 * engine imported here (and it skips entirely on an unbuilt tree).
 */
export const Route = createFileRoute("/ladder/$planId")({
  component: LadderPage,
  loader: () => getDashboard(),
});

function LadderPage() {
  const result = Route.useLoaderData();
  const { planId } = Route.useParams();

  if (result.status === "empty") {
    return (
      <Shell>
        <SnapshotEmptyNotice />
      </Shell>
    );
  }

  if (result.status === "stale") {
    return (
      <Shell>
        <SnapshotStaleNotice
          storedVersion={result.storedVersion}
          min={result.expectedVersions.min}
          max={result.expectedVersions.max}
        />
      </Shell>
    );
  }

  return <LadderView latest={result.latest} planId={planId} />;
}

function LadderView({ latest, planId }: { latest: SnapshotAnchor; planId: string }) {
  // The ONE client-side network read on this surface. See the header, and the call
  // site's own, for why it cannot move into the loader.
  const spot = useBinanceSpotUsd();
  const page = composeFillPathPage(latest, planId, spot);

  if (page.status === "not-found") {
    return (
      <Shell>
        <Crumb to="/">← Glance</Crumb>
        <div className="card notice">
          <h1>No such ladder</h1>
          {/* HONEST, NOT BLANK — and the cause distinguishes an id that no row carries
              from one that is not plan-id shaped at all. The second did not come from
              the card, which is the only thing that links here. */}
          <p>{page.why}</p>
        </div>
      </Shell>
    );
  }

  if (page.status === "no-price-axis") {
    return (
      <Shell>
        <Crumb to="/">← Glance</Crumb>
        <div className="card">
          <h1>{page.positionId}</h1>
          {/* A cadence plan is honestly rungless. An empty ladder would be a picture of
              a thing that does not exist. */}
          <p>{page.why}</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <Crumb to="/">← Glance</Crumb>
      <FillPathCards view={page.view} />
    </Shell>
  );
}
