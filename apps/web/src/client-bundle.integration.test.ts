/**
 * ADR-007 client-bundle invariant — the browser bundle must carry NO server-only
 * code or secrets. The dashboard reads Postgres behind a server function; the pg
 * driver, the DB connection strings, and the auth secret must never cross into
 * the client. Today this holds structurally (the `.tsx` render surfaces import
 * only `import type` from `@numisma/engine` and the pure `@numisma/engine/format`
 * helpers), but "structurally" is a manual claim — a future value-import of
 * `projection/snapshot-reader.ts` / `dashboard.ts` / `auth.ts` into a client
 * component would re-leak the driver and secrets into the browser bundle
 * SILENTLY. This test
 * turns that invariant into a build-time fact.
 *
 * It scans the built CLIENT output (`.vercel/output/static`, the Vercel preset's
 * browser assets) for string literals that only exist in server modules and
 * survive minification: the projection table name and the DB-URL / secret env
 * names. Any hit means server code leaked into the client.
 *
 * WHICH GUARD IS AUTHORITATIVE. Two tests defend this invariant, and they are not
 * peers:
 *
 *   - THIS one scans the BUILT client assets. It reads what actually shipped —
 *     after bundling, tree-shaking and minification, through whatever path the
 *     bytes took. It is the AUTHORITATIVE boundary.
 *   - `apps/web/src/projection/contract.test.ts` walks the module graph from
 *     `contract.ts` in source. That is a FAST LOCAL PRE-CHECK, not the real
 *     boundary: it runs without a build (which is why it exists), it sees static
 *     imports only, and it stops at true third-party packages. It fails EARLIER
 *     and more cheaply than this test; it does not fail more authoritatively.
 *
 * So: a green pre-check is not this invariant proven. If the two ever disagree,
 * this one wins.
 *
 * A SECOND CLAIM RIDES THE SAME BUILD (spec #451 §4.3). The started-ladder fixtures
 * are authored ladders that exist for a deep-compare in tests, and no browser should
 * ever download one. That used to be asserted as a mechanism, by reading the source
 * of a dev-only route that has since been deleted. It is asserted here as an outcome
 * instead, because the outcome is what the mechanism was for and this is the only
 * guard in the repo that can read what actually shipped.
 *
 * SUBSTRATE-GATED, like the Postgres integration tests: it needs a build to
 * inspect, so it SKIPS with a loud warning when `.vercel/output/static` is
 * absent (a plain `pnpm test` on an unbuilt tree still passes). CI builds the
 * web app before `pnpm test`, so there it RUNS — see .github/workflows/ci.yml
 * and docs/projection-provisioning.md.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { STARTED_LADDER_FIXTURES } from "./ladder/started-ladder.fixtures.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
// HERE = apps/web/src → the web package root is one level up.
const CLIENT_DIR = resolve(HERE, "../.vercel/output/static");

const hasBuild = existsSync(CLIENT_DIR);
if (!hasBuild) {
  console.warn(
    `\n[client-bundle.integration] SKIPPED: no client build at ${CLIENT_DIR}.\n` +
      `  This guards the ADR-007 invariant that the browser bundle carries no pg\n` +
      `  driver or secrets; it needs a build to inspect. Build first:\n` +
      `    pnpm --filter @numisma/web build && pnpm test\n` +
      `  CI does this automatically. See docs/projection-provisioning.md.\n`,
  );
}

/**
 * Server-only string literals. Each exists solely in a server module and is NOT
 * minified away (an env-var key on `process.env`, a SQL identifier, a connection
 * scheme). If any of these appears in a browser asset, a server module — or a
 * credential — was bundled into the client.
 *
 * The second group covers the Neon AUTO-INJECTED env set (`DATABASE_URL`,
 * `POSTGRES_*`, `PG*`), which carries `neondb_owner` MASTER credentials. Those
 * are being removed from the Vercel environment by hand; this asserts the part a
 * manual removal cannot: that no credential from that set ever reached a browser
 * asset, whatever a future refactor does.
 *
 * DELIBERATELY NOT LISTED: `VITE_NEON_AUTH_URL`. Its `VITE_` prefix means Vite
 * would INLINE it into the client bundle by design — it is a URL, not a
 * credential — so listing it here would assert against Vite's documented
 * behavior rather than against a leak. What must not ship is a credential,
 * which is what this list names.
 *
 * As of 2026-07-25 the variable no longer exists in any environment: it was one
 * of the 18 auto-injected by the Neon Marketplace integration, which was
 * DISCONNECTED from this project (ADR-011 amendment, D9). Nothing in this app
 * ever read it — there is no Neon Auth feature here; auth is Better Auth
 * (ADR-010) against a separate `numisma_auth` DB. The exclusion is kept as a
 * standing rule in case a `VITE_`-prefixed var is ever added, not because a
 * feature depends on one shipping.
 *
 * DELIBERATELY REDUNDANT: matching is by `includes()`, so the bare `DATABASE_URL`
 * added for the Neon set already subsumes `PROJECTION_DATABASE_URL`,
 * `PROJECTION_WRITE_DATABASE_URL`, `PROJECTION_ADMIN_DATABASE_URL` and
 * `AUTH_DATABASE_URL` — none of those four can fail on its own any more. They
 * stay anyway, as a named inventory of the specific credentials ADR-007 and
 * ADR-011 reasoned about, and because a failure reported against the exact var
 * name is worth more to whoever reads the CI log than one against a suffix. This
 * is a choice, not an oversight; if the bare entry is ever removed, the four
 * become load-bearing again.
 */
const FORBIDDEN = [
  "composition_snapshot", // the projection table — server-only SQL (snapshot-reader.ts, push/, provision.ts, schema.sql)
  "PROJECTION_DATABASE_URL",
  "PROJECTION_WRITE_DATABASE_URL",
  "PROJECTION_ADMIN_DATABASE_URL",
  "AUTH_DATABASE_URL",
  "BETTER_AUTH_SECRET",
  // Neon auto-injected owner-credential set: connection strings and the master role.
  "neondb_owner",
  "postgresql://",
  "postgres://",
  "PGPASSWORD",
  "DATABASE_URL",
];

/** Every file under `dir`, recursively. */
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

describe.skipIf(!hasBuild)("ADR-007 client-bundle invariant", () => {
  it("ships no pg driver, DB connection strings, or auth secret to the browser", () => {
    const leaks: string[] = [];
    for (const file of walk(CLIENT_DIR)) {
      const contents = readFileSync(file, "utf-8");
      for (const token of FORBIDDEN) {
        if (contents.includes(token)) {
          leaks.push(`${file} contains server-only token "${token}"`);
        }
      }
    }
    expect(leaks, leaks.join("\n")).toEqual([]);
  });

  it("carries no started-ladder fixture values", () => {
    // THE OUTCOME A DELETED ROUTE USED TO ASSERT AS A MECHANISM (spec #451 §4.3).
    // `ladder/started-ladder.fixtures.ts` is four authored ladders, kept because
    // `fill-path-fixture-equivalence.test.ts` deep-compares them against the package's
    // derived copy. Nothing a browser downloads should carry them: they are invented
    // trades, and a screenshot of a production build showing `fixture:overfilled` is a
    // screenshot nobody can read correctly.
    //
    // A dev-only route used to render them behind an `import.meta.env.DEV` gate, and a
    // source-text guard read that route to prove the gate held. The route is gone. This
    // asserts what the gate was for, against the bytes rather than against a file:
    // whatever import graph a future edit builds, no fixture value reaches the client.
    // `started-ladder.fixtures.test.ts` holds the fast source-level half — no file under
    // `routes/` imports the module — and this one is authoritative for the same reason
    // the leak check above is.
    //
    // THE TOKENS ARE READ OFF THE FIXTURES, not copied from them, so a renamed fixture
    // or a re-numbered plan id cannot leave this guard scanning for values that no
    // longer exist.
    //
    // WHY THE IDS ARE SCANNED FOR BY PREFIX AND THE PROSE IS NOT. Every id in that file
    // is ASSEMBLED AT RUNTIME from a template — `facade00-…-${index}`,
    // `fixture-rung-${n}`, `fixture:${name}` — so no whole id is ever a literal in a
    // built asset, and a scan for one would be a scan for something that cannot appear:
    // a token that can never fire, in a guard whose whole job is to fire. What the
    // bundler emits is the template's literal head, which is what is matched here. The
    // `renders` sentences need no such care; they are written out in full and each is
    // long enough that nothing else in the tree could produce one.
    const tokens = [
      ...STARTED_LADDER_FIXTURES.map((fixture) => fixture.renders),
      ...new Set(
        STARTED_LADDER_FIXTURES.flatMap((fixture) => [
          fixture.planId.split("-")[0]!,
          ...(fixture.anchor.report.dca?.positions ?? []).flatMap((position) => [
            `${position.positionId.split(":")[0]!}:`,
            ...(position.rungs ?? []).flatMap((rung) =>
              rung.id === undefined ? [] : [rung.id.replace(/\d+$/, "")],
            ),
          ]),
        ]),
      ),
    ];
    // FALSE-PASS FLOOR, IN BOTH DIRECTIONS. An empty token list scans for nothing and
    // reports green, which is what an emptied or restructured fixtures module would
    // produce. A token short enough to be a fragment is the opposite failure — it would
    // match half the bundle — so the length is asserted rather than trimmed to, and a
    // derivation that starts yielding one goes red here instead of going quiet.
    expect(tokens.length, "no fixture tokens to scan for").toBeGreaterThan(4);
    for (const token of tokens) {
      expect(token.length, `"${token}" is too short to identify a fixture`).toBeGreaterThan(6);
    }

    const leaks: string[] = [];
    for (const file of walk(CLIENT_DIR)) {
      const contents = readFileSync(file, "utf-8");
      for (const token of tokens) {
        if (contents.includes(token)) {
          leaks.push(`${file} contains fixture value "${token}"`);
        }
      }
    }
    expect(leaks, leaks.join("\n")).toEqual([]);
  });

  it("guards a client bundle that actually exists (assertion has teeth)", () => {
    // Guard against a false pass: if the build layout changes and there are no
    // browser assets to scan, the leak check above would vacuously pass.
    const jsAssets = walk(CLIENT_DIR).filter((f) => f.endsWith(".js"));
    expect(jsAssets.length).toBeGreaterThan(0);
  });
});
