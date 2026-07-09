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
 * minified away (an env-var key on `process.env`, a SQL identifier). If any of
 * these appears in a browser asset, a server module was bundled into the client.
 */
const FORBIDDEN = [
  "composition_snapshot", // the projection table — only in contract.ts / schema.sql
  "PROJECTION_DATABASE_URL",
  "PROJECTION_WRITE_DATABASE_URL",
  "PROJECTION_ADMIN_DATABASE_URL",
  "AUTH_DATABASE_URL",
  "BETTER_AUTH_SECRET",
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
