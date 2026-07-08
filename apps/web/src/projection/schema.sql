-- composition_snapshot: the hosted read-projection table (ADR-007).
--
-- The push shell (PROJECTION_WRITE_DATABASE_URL) writes here; the web app
-- (PROJECTION_DATABASE_URL) reads here. This file has two halves:
--
--   1. Everything ABOVE the GRANTS marker is plain SQL. It is what
--      `pnpm --filter @numisma/web db:init` (i.e. `push.ts --init`) executes
--      through the node-postgres driver for one-command local setup.
--
--   2. Everything BELOW the GRANTS marker uses psql meta-commands (:var
--      interpolation) and MUST be applied with psql:
--        psql "$SUPERUSER_URL" -f schema.sql -v writer_role=numisma_push \
--                                            -v reader_role=numisma_web
--      The node driver cannot parse psql meta-commands, so `--init` skips it.

CREATE TABLE IF NOT EXISTS composition_snapshot (
  fund_id        TEXT        NOT NULL,
  as_of          TEXT        NOT NULL,
  schema_version INTEGER     NOT NULL,
  report         JSONB       NOT NULL,
  pushed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (fund_id, as_of)
);

-- >>> GRANTS (psql only, ADR-007 two-role split) <<<
--
-- Two roles back this table, bound to real login roles via psql -v:
--
--   writer_role  the push shell's credential (PROJECTION_WRITE_DATABASE_URL).
--                Needs to INSERT/UPDATE snapshots. NO DELETE — the projection
--                is append/upsert only.
--
--   reader_role  the web app's credential (PROJECTION_DATABASE_URL). This is
--                ADR-007-CRITICAL: the web credential must be PHYSICALLY unable
--                to mutate the projection. SELECT only; writes revoked so the
--                grant actually rejects INSERT/UPDATE/DELETE at the DB level.

-- WRITER: read + append/upsert, no delete.
GRANT SELECT, INSERT, UPDATE ON composition_snapshot TO :"writer_role";

-- READER: strictly read-only. The REVOKE is belt-and-suspenders in case the
-- role inherited writes from PUBLIC or a group role.
GRANT SELECT ON composition_snapshot TO :"reader_role";
REVOKE INSERT, UPDATE, DELETE ON composition_snapshot FROM :"reader_role";
