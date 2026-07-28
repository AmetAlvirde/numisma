import { createFileRoute, Link } from "@tanstack/react-router";
import type { SnapshotAnchor } from "../projection/contract.ts";
import { composeBigPicture } from "../glance/row-view.ts";
import { getDashboard } from "../lib/dashboard.ts";
import { Shell } from "../components/Shell.tsx";
import { SummaryCard } from "../components/SummaryCard.tsx";
import { SectionTable } from "../components/SectionTable.tsx";

/**
 * `/big-picture` — the composition dashboard, MOVED here from `/` (D11), behavior
 * unchanged. The loader still calls the session-gated server function, which
 * redirects unauthenticated users to /login before any data is read.
 *
 * THIS IS D9's BELOW-THE-TAP LAYER. Collapsing D11's move and the map's "route or
 * in-place expand" question into one surface avoids building two homes for the same
 * sections. D9's ceiling governs what may be ADDED here later: below the tap may
 * hold only what SUBSTANTIATES a renderable verdict — not everything that would fit.
 *
 * The page renders `dashboard.sections` generically. "Five tables" is a fact about
 * today's data, not about this code, and the move did not need to know the number.
 */
export const Route = createFileRoute("/big-picture")({
  component: BigPicturePage,
  loader: () => getDashboard(),
});

function BigPicturePage() {
  const result = Route.useLoaderData();

  if (result.status === "empty") {
    return (
      <Shell>
        <div className="card notice">
          <h1>No snapshot yet</h1>
          <p>
            The projection is empty. Run <code>pnpm push</code> to publish the
            latest composition report.
          </p>
        </div>
      </Shell>
    );
  }

  if (result.status === "stale") {
    return (
      <Shell>
        <div className="card notice error">
          <h1>Schema version mismatch — refusing to render</h1>
          <p>
            The stored snapshot is schema version{" "}
            <strong>{result.storedVersion}</strong> but this app expects version{" "}
            <strong>{result.expectedVersion}</strong>. Re-run the push shell with
            a matching engine build before viewing.
          </p>
        </div>
      </Shell>
    );
  }

  return <BigPictureView latest={result.latest} anchors={result.anchors} />;
}

/**
 * The composition tables, with slice #151's two additions: per-row provenance and
 * named-reference deltas.
 *
 * Both come from ONE pure call. `composeBigPicture` reads the push's `glance.suppressed`
 * list — which is where the per-row dependency map's CONCLUSIONS arrive, the map itself
 * having stayed on the machine (D8) — and resolves the same reference anchor the glance
 * header names, so the two surfaces can never claim different days.
 */
function BigPictureView({
  latest,
  anchors,
}: {
  latest: SnapshotAnchor;
  anchors: SnapshotAnchor[];
}) {
  const report = latest.report;
  const view = composeBigPicture(latest, anchors);
  return (
    <Shell>
      <p className="crumb">
        <Link to="/">← Glance</Link>
      </p>
      <SummaryCard
        summary={report.dashboard.summary}
        usdMxn={report.totals.usdMxn}
      />
      {report.dashboard.sections.map((section) => (
        <SectionTable key={section.id} section={section} view={view} />
      ))}
    </Shell>
  );
}
