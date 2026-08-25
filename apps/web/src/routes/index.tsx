import { Link, createFileRoute } from "@tanstack/react-router";
import { getDashboard } from "../lib/dashboard.ts";
import {
  Crumb,
  DcaCard,
  GlanceCard,
  Shell,
  SnapshotEmptyNotice,
  SnapshotStaleNotice,
} from "@numisma/components";
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
      <Crumb
        renderLink={({ className, children }) => (
          <Link className={className} to="/big-picture">
            {children}
          </Link>
        )}
      >
        Big picture →
      </Crumb>
      {/*
        THE TAP-THROUGH TO THE LADDER IS BUILT HERE, NOT IN THE CARD (spec #439 §4.6).
        `DcaCard` crossed into `@numisma/components` and the package has no router, so
        it owns the anchor's classes and hands them out with the `planId` it holds the
        only copy of. The `to` is a LITERAL and the route tree is in scope in this file,
        which is what keeps TanStack's own check on the destination — an adapter taking
        `to: string` would have thrown that away and shipped the first typo.

        The slot is OPTIONAL and this is the only caller that passes one. A row with no
        `planId` still renders the unlinked paragraph, exactly as it did before the move.
      */}
      <DcaCard
        view={dca}
        renderLink={({ className, children, planId }) => (
          <Link className={className} to="/ladder/$planId" params={{ planId }}>
            {children}
          </Link>
        )}
      />
    </Shell>
  );
}
