import { describe, expect, it } from "vitest";
import {
  assertValidRoleName,
  buildGrantStatements,
  PROJECTION_TABLE,
  readSchemaDdl,
  rolesFromEnv,
  DEFAULT_PROJECTION_ROLES,
} from "./provision.ts";

describe("assertValidRoleName", () => {
  it("accepts conventional lowercase role names", () => {
    for (const ok of ["numisma_web", "numisma_push", "_x", "r2", "reader_1a2b"]) {
      expect(assertValidRoleName(ok)).toBe(ok);
    }
  });

  it("rejects names carrying a psql meta-command or injection payload", () => {
    // These are exactly the shapes the old psql `:"writer_role"` split risked
    // feeding to the driver. None may ever reach a GRANT/REVOKE.
    for (const bad of [
      'writer_role"',
      ':"writer_role"',
      "numisma_web; DROP TABLE composition_snapshot",
      "numisma web",
      "reader-role",
      "Reader",
      "",
      "1reader",
      "réader",
      "role;--",
    ]) {
      expect(() => assertValidRoleName(bad)).toThrow(/Invalid projection role name/);
    }
  });
});

describe("buildGrantStatements", () => {
  const stmts = buildGrantStatements({
    writerRole: "numisma_push",
    readerRole: "numisma_web",
  });

  it("grants the writer append/upsert but NEVER delete", () => {
    const writerGrant = stmts.find((s) => s.includes('"numisma_push"'));
    expect(writerGrant).toBe(
      `GRANT SELECT, INSERT, UPDATE ON ${PROJECTION_TABLE} TO "numisma_push"`,
    );
    expect(writerGrant).not.toMatch(/DELETE/);
  });

  it("grants the reader SELECT and revokes every write (ADR-007-critical)", () => {
    expect(stmts).toContain(
      `GRANT SELECT ON ${PROJECTION_TABLE} TO "numisma_web"`,
    );
    expect(stmts).toContain(
      `REVOKE INSERT, UPDATE, DELETE ON ${PROJECTION_TABLE} FROM "numisma_web"`,
    );
  });

  it("emits driver-safe SQL only — no psql meta-commands", () => {
    for (const s of stmts) {
      expect(s).not.toMatch(/:"/); // no psql :"var" interpolation
      expect(s).not.toMatch(/^\s*\\/); // no psql backslash meta-command
    }
  });

  it("throws before emitting anything if a role name is invalid", () => {
    expect(() =>
      buildGrantStatements({ writerRole: 'evil"; DROP', readerRole: "numisma_web" }),
    ).toThrow(/Invalid projection role name/);
  });
});

describe("rolesFromEnv", () => {
  it("falls back to the documented defaults", () => {
    expect(rolesFromEnv({})).toEqual(DEFAULT_PROJECTION_ROLES);
  });

  it("honours PROJECTION_WRITER_ROLE / PROJECTION_READER_ROLE overrides", () => {
    expect(
      rolesFromEnv({
        PROJECTION_WRITER_ROLE: "custom_push",
        PROJECTION_READER_ROLE: "custom_web",
      } as NodeJS.ProcessEnv),
    ).toEqual({ writerRole: "custom_push", readerRole: "custom_web" });
  });
});

describe("schema.sql hardening (grants/DDL separation)", () => {
  const ddl = readSchemaDdl();

  // The EXECUTABLE SQL — everything the node-postgres driver actually runs, with
  // `--` comments stripped. Comments may legitimately *describe* grants/meta-
  // commands (this file documents why they live elsewhere); what must never
  // appear is grants or psql meta-commands in the SQL that reaches the driver.
  const executable = ddl.replace(/--.*$/gm, "").trim();

  it("creates the projection table idempotently", () => {
    expect(executable).toMatch(/CREATE TABLE IF NOT EXISTS composition_snapshot/);
  });

  it("has NO grants in its executable SQL — they can't be silently skipped by a reworded comment", () => {
    // The whole point of separating the files: schema.sql is DDL-only, so the
    // grants live exclusively in buildGrantStatements(). A reworded marker
    // comment cannot reintroduce (or drop) grants in the driver-run SQL.
    expect(executable).not.toMatch(/\bGRANT\b/i);
    expect(executable).not.toMatch(/\bREVOKE\b/i);
    expect(executable).not.toContain(">>> GRANTS");
  });

  it("has NO psql meta-commands in its executable SQL (they would break the pg driver)", () => {
    expect(executable).not.toMatch(/:"/); // psql :"var" interpolation
    expect(executable).not.toMatch(/^\s*\\/m); // psql backslash meta-command
  });
});
