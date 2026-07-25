/**
 * ADR-007 client-bundle invariant — the browser bundle must carry NO server-only
 * code or secrets. The dashboard reads Postgres behind a server function; the pg
 * driver, the DB connection strings, and the auth secret must never cross into
 * the client. Today this holds structurally (the `.tsx` render surfaces import
 * only `import type` from `@numisma/engine` and the pure `@numisma/engine/format`
 * helpers), but "structurally" is a manual claim — a future value-import of
 * `contract.ts` / `dashboard.ts` / `auth.ts` into a client component would
 * re-leak the driver and secrets into the browser bundle SILENTLY. This test
 * turns that invariant into a build-time fact.
 *
 * It scans the built CLIENT output (`.vercel/output/static`, the Vercel preset's
 * browser assets) for string literals that only exist in server modules and
 * survive minification: the projection table name and the DB-URL / secret env
 * names. Any hit means server code leaked into the client.
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
  "composition_snapshot", // the projection table — only in contract.ts / schema.sql
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

  it("guards a client bundle that actually exists (assertion has teeth)", () => {
    // Guard against a false pass: if the build layout changes and there are no
    // browser assets to scan, the leak check above would vacuously pass.
    const jsAssets = walk(CLIENT_DIR).filter((f) => f.endsWith(".js"));
    expect(jsAssets.length).toBeGreaterThan(0);
  });
});
