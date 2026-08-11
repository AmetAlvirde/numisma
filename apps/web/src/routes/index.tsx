import { createFileRoute, Link } from "@tanstack/react-router";
import { getDashboard } from "../lib/dashboard.ts";
import { Shell } from "../components/Shell.tsx";
import { GlanceCard } from "../components/GlanceCard.tsx";
import { DcaCard } from "../components/DcaCard.tsx";
import { computeVerdict } from "../glance/verdict.ts";
import { composeDcaView } from "../glance/dca-view.ts";
import type { SnapshotAnchor } from "../projection/contract.ts";

/**
 * `/` — THE TRIAGE SURFACE (D1): *does anything need me before I next sit at the
 * desk?* The composition dashboard that used to live here moved to `/big-picture`
 * (D11), which is also D9's below-the-tap layer. The login route still lands here,
 * because the phone should land on triage.
 *
 * ── STANDING CONTENT RETURNS, ONCE AND ON PURPOSE (spec #277, D6) ───────────────
 * D6 REVERSES D11'S POLARITY for exactly one card, and the reason is written down
 * here because an unexplained reversal reads as an invariant violation to the next
 * reader — someone who sees standing content back on `/` and assumes D11 simply
 * eroded will "restore" it, and be wrong.
 *
 * D11's rule was never "nothing standing on `/`". It was that `/` answers the
 * TRIAGE question and everything answered at DESK frequency lives one tap down. The
 * composition tables answer "what do I hold" — a desk question, asked while sitting
 * down with the whole book — and they are staying on `/big-picture`. The DCA card
 * answers "is my accumulation plan still what I think it is", which is checked at
 * precisely the frequency the verdict is: on the phone, in a queue, in the seconds
 * before the day moves on. Same frequency, same surface. The card is therefore the
 * LAST child of the shell, below the crumb — the verdict still lands first and still
 * owns the eye, which is D1's actual invariant.
 *
 * `route-move.test.ts` asserts the reversal in both directions, so neither half can
 * rot into prose: the card is here and is NOT duplicated one tap down.
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
            <strong>{result.storedVersion}</strong>, which is outside the versions
            this app supports (
            <strong>
              {result.expectedVersions.min}–{result.expectedVersions.max}
            </strong>
            ). Re-run the push shell with a matching engine build before viewing.
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
  // pure — which is what lets the same call be replayed over the whole committed
  // anchor history in a test.
  const verdict = computeVerdict(latest, anchors, new Date());
  // Composed, never handed raw to JSX — the price sort and the wire's optionality are
  // decided in the pure module, where a test can reach them.
  const dca = composeDcaView(latest);

  return (
    <Shell>
      <GlanceCard verdict={verdict} />
      <p className="crumb">
        <Link to="/big-picture">Big picture →</Link>
      </p>
      <DcaCard view={dca} />
    </Shell>
  );
}
