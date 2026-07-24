create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" boolean not null, "image" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);

create table "session" ("id" text not null primary key, "expiresAt" timestamptz not null, "token" text not null unique, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);

create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null);

create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);

-- HAND-ADDED (D5, 2026-07-24 hosted-security grill). NOT emitted by the pinned
-- @better-auth/cli@1.4.21 that generated the four tables above, because
-- getAuthTables() only includes this model when `rateLimit.storage ===
-- "database"` — which src/lib/auth.ts now sets. There is no 1.6.23 CLI to
-- regenerate with (ADR-010), so the DDL is written by hand to match the
-- installed 1.6.23 model definition exactly:
--   @better-auth/core/dist/db/get-tables.mjs -> rateLimitTable
--     modelName "rateLimit"; key: string, unique, required
--     count: number (-> integer); lastRequest: number + bigint:true (-> bigint)
-- Column types follow better-auth/dist/db/get-migration.mjs's postgres typeMap
-- (`number` -> field.bigint ? "bigint" : "integer"), and the implicit "id" text
-- primary key every model gets. lastRequest's defaultValue is a JS function on
-- a number field, which the generator does not emit as a DB default (only
-- `date` fields get CURRENT_TIMESTAMP), so there is none here either.
create table "rateLimit" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);

create index "session_userId_idx" on "session" ("userId");

create index "account_userId_idx" on "account" ("userId");

create index "verification_identifier_idx" on "verification" ("identifier");