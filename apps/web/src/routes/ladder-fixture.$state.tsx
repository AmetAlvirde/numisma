import { createFileRoute, Link } from "@tanstack/react-router";
import { Shell } from "../components/Shell.tsx";
import { FillPathCards } from "../components/FillPath.tsx";
import type { FillPathPage } from "../ladder/fill-path-view.ts";

/**
 * `/ladder-fixture/$state` — THE FIXTURE SURFACE for the fill path (spec #302 slice B,
 * issue #304). A DEV-ONLY twin of `/ladder/$planId` that renders the same cards from
 * SYNTHESIZED ladders, so every branch of "a ladder that has started" can be looked at.
 *
 * ── WHY A SECOND ROUTE AND NOT A FLAG ON THE FIRST ──────────────────────────────────
 * `/ladder/$planId`'s loader is `getDashboard()` — the session gate, the projection pool,
 * the real fund. Reaching a fixture through it would mean branching the gate itself: a
 * signed-in session and a reachable database to look at data that comes from neither, and
 * an `if` inside the one function whose whole job is to let nothing past unauthenticated.
 * That route is therefore UNTOUCHED by this slice (`route-move.test.ts` pins its loader to
 * exactly one line), and this file carries the fixture path instead. It renders the real
 * `FillPathCards` through the real `composeFillPathPage`, which is what makes looking at it
 * evidence about the production surface rather than about a mock of it.
 *
 * ── WHY IT CANNOT LEAK INTO PRODUCTION ──────────────────────────────────────────────
 * Two things, and the second is the one that matters:
 *
 *  1. THE GATE. Outside `import.meta.env.DEV` the loader returns `disabled` and the page
 *     says so. Vite substitutes that flag at build time, so in a production build this is
 *     a literal `if (false)`.
 *  2. THE FIXTURES ARE REACHED BY DYNAMIC IMPORT, INSIDE THAT BRANCH. Dead-code
 *     elimination then removes the import along with the branch, so `started-ladder`
 *     `.fixtures.ts` — and every invented price, size and quantity in it — is absent from
 *     the production bundle entirely, rather than merely unreachable within it. A static
 *     import would ship all of it and only hide the route. `started-ladder.fixtures.test.ts`
 *     asserts both halves against this file's source.
 *
 * ── AND NO REAL DATA IS REACHABLE FROM HERE ─────────────────────────────────────────
 * No server function, no pool, no `getDashboard`, and no spot fetch: each fixture declares
 * its own spot reading (see the fixtures module's header for why a live one cannot land the
 * two spot-dependent decorations). This surface performs no IO at all.
 */
type FixtureLoad =
  | { status: "disabled" }
  | { status: "unknown"; requested: string; names: readonly string[] }
  | {
      status: "ok";
      name: string;
      renders: string;
      names: readonly string[];
      page: FillPathPage;
    };

export const Route = createFileRoute("/ladder-fixture/$state")({
  component: LadderFixturePage,
  loader: async ({ params }): Promise<FixtureLoad> => {
    if (!import.meta.env.DEV) return { status: "disabled" };
    // See the header: dynamic, and inside the DEV branch, so the production build keeps
    // neither the module nor its values.
    const [{ ladderFixture, LADDER_FIXTURE_NAMES }, { composeFillPathPage }] =
      await Promise.all([
        import("../ladder/started-ladder.fixtures.ts"),
        import("../ladder/fill-path-view.ts"),
      ]);
    const fixture = ladderFixture(params.state);
    if (fixture === undefined) {
      return {
        status: "unknown",
        requested: params.state,
        names: LADDER_FIXTURE_NAMES,
      };
    }
    return {
      status: "ok",
      name: fixture.name,
      renders: fixture.renders,
      names: LADDER_FIXTURE_NAMES,
      // COMPOSED HERE, by the module the live route uses, so what the cards receive is a
      // real view and not a hand-built one. The fixture's own declared spot goes in.
      page: composeFillPathPage(fixture.anchor, fixture.planId, fixture.spot),
    };
  },
});

function LadderFixturePage() {
  const load = Route.useLoaderData();

  if (load.status === "disabled") {
    return (
      <Shell>
        <div className="card notice">
          <h1>Fixtures are a development surface</h1>
          <p>
            The synthesized ladders are only assembled by <code>vite dev</code>. This
            build carries none of them.
          </p>
        </div>
      </Shell>
    );
  }

  if (load.status === "unknown") {
    return (
      <Shell>
        <div className="card notice">
          <h1>No fixture named “{load.requested}”</h1>
          <FixtureNav names={load.names} />
        </div>
      </Shell>
    );
  }

  if (load.page.status !== "ok") {
    // Unreachable while the fixtures hold their promise, and it is asserted that they do
    // (`started-ladder.fixtures.test.ts`). Said out loud anyway: a fixture that stops
    // composing must not render as a blank page.
    return (
      <Shell>
        <div className="card notice error">
          <h1>{load.name} no longer composes</h1>
          <p>{load.page.why}</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      {/* THE BANNER IS NOT DECORATION. Every figure below is invented, and a screenshot
          of this page will outlive the tab it was taken in. */}
      <div className="card notice">
        <h1>Fixture — {load.name}</h1>
        <p>{load.renders}</p>
        <p>
          Synthesized data, authored in <code>ladder/started-ladder.fixtures.ts</code>.
          No real position, level, size or quantity appears on this page.
        </p>
        <FixtureNav names={load.names} />
      </div>
      <FillPathCards view={load.page.view} />
      <p className="crumb">
        <Link to="/">← Glance</Link>
      </p>
    </Shell>
  );
}

/** Every fixture, one tap apart — the surface is walked, not typed. */
function FixtureNav({ names }: { names: readonly string[] }) {
  return (
    <p className="crumb">
      {names.map((name) => (
        <Link
          key={name}
          to="/ladder-fixture/$state"
          params={{ state: name }}
          style={{ marginRight: "0.75rem" }}
        >
          {name}
        </Link>
      ))}
    </p>
  );
}
