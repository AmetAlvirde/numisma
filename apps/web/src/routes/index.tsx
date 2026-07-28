import { createFileRoute, Link } from "@tanstack/react-router";
import { getDashboard } from "../lib/dashboard.ts";
import { Shell } from "../components/Shell.tsx";
import { GlanceCard } from "../components/GlanceCard.tsx";
import { computeVerdict } from "../glance/verdict.ts";
import type { SnapshotAnchor } from "../projection/contract.ts";

/**
 * `/` — THE TRIAGE SURFACE (D1): *does anything need me before I next sit at the
 * desk?* The composition dashboard that used to live here moved to `/big-picture`
 * (D11), which is also D9's below-the-tap layer. The login route still lands here,
 * because the phone should land on triage.
 *
 * The loader is unchanged: the same session-gated server function, redirecting
 * unauthenticated users to /login before any data is read, now consuming slice
 * #148's `getSnapshotHistory` — `anchors` is what D4's named reference needs.
 */
export const Route = createFileRoute("/")({
  component: GlancePage,
  loader: () => getDashboard(),
});

function GlancePage() {
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

  return <GlanceView latest={result.latest} anchors={result.anchors} />;
}

function GlanceView({
  latest,
  anchors,
}: {
  latest: SnapshotAnchor;
  anchors: SnapshotAnchor[];
}) {
  // The wall clock is READ HERE and injected, never taken inside the module: freshness
  // is a render-time derivation (D6) over `latest.asOf`, and `computeVerdict` stays
  // pure — which is what lets the same call be replayed over 28 anchors in a test.
  const verdict = computeVerdict(latest, anchors, new Date());

  return (
    <Shell>
      <GlanceCard verdict={verdict} />
      <p className="crumb">
        <Link to="/big-picture">Big picture →</Link>
      </p>
    </Shell>
  );
}
