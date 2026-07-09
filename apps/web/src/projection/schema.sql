-- composition_snapshot: the hosted read-projection table (ADR-007).
--
-- DDL ONLY. This file is plain, driver-safe SQL: no GRANT/REVOKE, no psql
-- meta-commands (`:"var"` interpolation). It is applied through the
-- node-postgres driver by both:
--
--   * the push shell  (`pnpm --filter @numisma/web db:init`, writer cred), and
--   * provisioning    (`pnpm --filter @numisma/web db:provision`, admin cred),
--
-- via `readSchemaDdl()` in `provision.ts`.
--
-- The ADR-007 two-role grants (writer append-only, reader SELECT-only) are NOT
-- here — they are generated from the configured role names and applied through
-- the same driver by `buildGrantStatements()` / `provisionProjection()` in
-- `provision.ts`. Keeping DDL and grants in physically separate places is
-- deliberate (see ADR-010): a reworded comment can no longer silently skip the
-- grants, and no psql meta-command can ever reach the pg driver.

CREATE TABLE IF NOT EXISTS composition_snapshot (
  fund_id        TEXT        NOT NULL,
  as_of          TEXT        NOT NULL,
  schema_version INTEGER     NOT NULL,
  report         JSONB       NOT NULL,
  pushed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (fund_id, as_of)
);
