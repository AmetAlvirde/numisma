# Projection provisioning runbook (ADR-007 / ADR-010)

How to reproducibly provision the hosted read-projection database — the
`composition_snapshot` table plus the ADR-007 two-role grants — and how the
credential invariants are asserted in the test suite.

This **replaces** the old hand-run, undocumented step:

```
# OLD — do not use:
psql "$SUPERUSER_URL" -f schema.sql -v writer_role=numisma_push -v reader_role=numisma_web
```

## The mechanism (ADR-010)

Provisioning is **app-runnable, idempotent, and driver-only** — no `psql`, no
psql meta-commands. One command applies the DDL and the grants through the
node-postgres driver:

```
pnpm --filter @numisma/web db:provision      # or, from the repo root: pnpm db:provision
```

- **DDL** comes from `apps/web/src/projection/schema.sql` (DDL-only,
  `CREATE TABLE IF NOT EXISTS`).
- **Grants** are generated in code from the configured role names by
  `buildGrantStatements()` in `apps/web/src/projection/provision.ts` and applied
  through the same driver. `GRANT`/`REVOKE` are idempotent in Postgres, so the
  whole step is a **no-op on the second run**.

Because DDL and grants live in physically separate producers, a reworded comment
can neither silently skip the grants nor feed a psql meta-command (`:"var"`) to
the driver — asserted by `provision.test.ts`.

### Credentials & roles

| Credential | Env var | Who holds it | Privileges |
| --- | --- | --- | --- |
| Admin (provisioning) | `PROJECTION_ADMIN_DATABASE_URL` | **one-shot**, provisioning only — never a running service | superuser / table owner (CREATE, GRANT) |
| Writer (push shell) | `PROJECTION_WRITE_DATABASE_URL` | `push.ts` | SELECT, INSERT, UPDATE — **no DELETE** |
| Reader (web app) | `PROJECTION_DATABASE_URL` | web dashboard | SELECT only — writes revoked |

Role **names** the grants target are `PROJECTION_WRITER_ROLE` /
`PROJECTION_READER_ROLE` (defaults `numisma_push` / `numisma_web`; must match
`^[a-z_][a-z0-9_]*$`). The writer + reader **login roles must already exist**
(created once as part of DB setup); `db:provision` grants privileges to them, it
does not create them.

The one-shot admin cred is the ADR-010 trade-off: provisioning grants needs a
credential that can `GRANT`, which neither the SELECT-only reader nor the
no-DELETE writer has. It is used only at provisioning time and is not held by any
running service, so ADR-007's split-cred / one-way runtime guarantee is
unchanged.

### First-time setup (once per cluster)

```sql
CREATE ROLE numisma_push LOGIN PASSWORD '...';   -- writer
CREATE ROLE numisma_web  LOGIN PASSWORD '...';   -- reader
CREATE DATABASE numisma_projection;
```

Then `pnpm db:provision`. Re-run any time; it is idempotent. DB corruption is a
non-event (ADR-007): re-create and re-run `pnpm db:provision`, then `pnpm push`.

## Asserting the invariants (the automated 8/8 probe)

`apps/web/src/projection/provision.integration.test.ts` automates the manual 8/8
credential probe against a **real throwaway Postgres** (pg-mem cannot enforce
role privileges). It creates the two roles, applies `provisionProjection`, and
asserts:

- **writer**: SELECT / INSERT / UPDATE accepted, **DELETE denied**
- **reader**: SELECT accepted, **INSERT / UPDATE / DELETE denied**

plus an idempotency check (re-provision is a no-op and enforcement still holds).

### Running the integration test

It is **gated** on `NUMISMA_TEST_DATABASE_URL`. When unset it **skips with a loud
warning** so `pnpm test` still passes on a machine without Postgres.

```
# local (a running Postgres 17 with a superuser):
NUMISMA_TEST_DATABASE_URL="postgres://postgres@localhost:5432/postgres" pnpm test
```

The URL must be a **superuser** (or `CREATEDB` + `CREATEROLE`) connection: the
test substrate creates a randomised throwaway database and ad-hoc login roles,
then drops them. See `apps/web/src/projection/pg-substrate.testkit.ts` — the
**shared** substrate helper (slice #123 establishes it; slice #127's push
upsert-idempotency tests reuse `createThrowawayDb()` + `provisionProjection()`).

### CI

Provide a Postgres **service** and point the env var at it — no Docker-in-Docker
or testcontainers dependency:

```yaml
# .github/workflows/ci.yml (illustrative)
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17
        env: { POSTGRES_PASSWORD: postgres }
        ports: ["5432:5432"]
        options: >-
          --health-cmd pg_isready --health-interval 10s
          --health-timeout 5s --health-retries 5
    env:
      NUMISMA_TEST_DATABASE_URL: postgres://postgres:postgres@localhost:5432/postgres
    steps:
      - uses: actions/checkout@v4
      - run: corepack enable && pnpm install --frozen-lockfile
      - run: pnpm test
```

> This repo does not yet have a CI workflow (`.github/workflows/` is absent). The
> snippet above is the intended shape when CI lands; until then the integration
> test runs locally (above) and skips elsewhere.

## Auth store (ADR-008) — separate, also deterministic

The `numisma_auth` store is provisioned from **vendored** SQL, not a floating
CLI. `apps/web/src/auth/better-auth.schema.sql` is generated by the **pinned**
`@better-auth/cli@1.4.21` (there is no `1.6.23` CLI — the CLI versions
independently of `better-auth@1.6.23`; latest is `1.4.21`). Apply it
deterministically and idempotently:

```
pnpm --filter @numisma/web auth:apply       # applies the vendored SQL to AUTH_DATABASE_URL
pnpm --filter @numisma/web auth:generate     # regenerate the vendored file after a better-auth bump
```

`auth:migrate` (also pinned) remains available as the CLI-driven alternative.

### Single-tenant seed account (ADR-007 / slice #125)

The product is **single-tenant, single-account**: open self-service signup is
**disabled at the auth server** (`emailAndPassword.disableSignUp` in
`apps/web/src/lib/auth.ts`), so `/api/auth/sign-up/email` rejects every
new-account request and there is no `/signup` route. Sign-**in** stays enabled.

Because signup is disabled, the one account is established by a **deterministic,
idempotent seed** — not a one-off manual signup:

```
# set the account's credentials (see apps/web/.env.example):
#   NUMISMA_SEED_EMAIL=operator@example.com
#   NUMISMA_SEED_PASSWORD=...            # a strong password
#   NUMISMA_SEED_NAME=Operator           # optional, defaults to the email
pnpm --filter @numisma/web auth:seed
```

`auth:seed` (`src/auth/seed-account.ts`) writes through Better Auth's **internal
adapter** (`auth.$context`), not the disabled HTTP signup route — creating the
user plus a `credential` account carrying the hashed password, exactly what
`signIn.email` reads. So the seeded account can sign in immediately, and
disabling signup never breaks it. It is **idempotent**: keyed on
`NUMISMA_SEED_EMAIL`, a second run finds the existing user and no-ops, so it can
never create a second account.

First-time setup order for the auth store:

```
pnpm --filter @numisma/web auth:apply     # 1. create the auth tables (idempotent)
pnpm --filter @numisma/web auth:seed      # 2. seed the single account (idempotent)
```

ADR-008 disjointness holds: the seed touches only the `numisma_auth` RW store
(`AUTH_DATABASE_URL`); it never reads or writes `PROJECTION_*`.
