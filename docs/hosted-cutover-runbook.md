# Hosted cutover runbook (ADR-007 / ADR-011)

The console-side checklist for going from "the hosted security pass is
merged" to "real fund data is live and reviewed nightly on the phone." Code
cannot do any of these — they are Vercel/Neon console actions, credential
rotations, and human verification. Follow the steps **in this order**; the
order is load-bearing, not incidental (see each step's "why here").

Model: `docs/projection-provisioning.md` (the provisioning mechanism these
steps rely on), `docs/web-deploy-runbook.md` (**the** deploy procedure — step 5
is a pointer to it, not a substitute), and `docs/price-feed-ops.md` (the
daily-schedule shape step 9 extends). Read all three if a step references a
command or file you don't recognize.

> **Revised 2026-07-25, after executing it end to end.** The previous version
> had four steps that could not work as written — not wording gaps, but
> instructions whose prescribed action was defeated by the platform. Each is
> marked **CORRECTED** below with what actually happens. If you are reading a
> step that looks surprising, the surprise is the point: it was found by
> running it.

## 0. Credential custody — do this first, or steps 4 and 8 will stall

**CORRECTED — this step did not exist, and its absence blocked two later
steps mid-cutover.**

Vercel environment variables are **sensitive by default on Production and
Preview** (`vercel env add --help`: `--no-sensitive` opts out). Sensitive
values are injected into deployments but **can never be read back** — not by
the dashboard, not by the API, not by `vercel env pull`. A pull returns them
as **empty strings**, silently.

That has a consequence the previous version of this runbook got backwards:
**Vercel is not a credential store you can read from.** Any step that needs a
credential *locally* (a `psql` session, `auth:apply`, `push`) cannot source it
from Vercel, and the failure is quiet. A pulled-empty connection string makes
`psql` fall back to a local socket and report `database "<you>" does not
exist` — which reads like a local misconfiguration, not a missing credential.

So: **record every provisioned role password in a password manager at
provision time.** `numisma_push`, `numisma_auth_rw`, `numisma_web`, and the
Neon owner if you keep one. If you don't, the only way to recover a credential
is to reset the role's password in the Neon console, which is what a cutover
should not be discovering halfway through.

Keep two operator-only credential files on the machine that runs the
one-shot commands, both matched by the existing `.env*.local` gitignore glob
(`apps/web/.gitignore:3`), both `chmod 600`:

| File | Holds | Used by |
| --- | --- | --- |
| `apps/web/.env.push.local` | `PROJECTION_WRITE_DATABASE_URL` (`numisma_push`, **pooled**) | step 8's `push`, and its verification queries |
| `apps/web/.env.auth.local` | `AUTH_DATABASE_URL` (`numisma_auth_rw`, **direct/unpooled**) | step 4's `auth:apply`, step 6's row surgery, the panic lever |

**Pooled vs direct is not cosmetic.** Use the `-pooler` host for anything
long-running or serverless (the deployed app, the push). Use the **direct**
host for DDL — `auth:apply` creates tables, and transaction-pooled connections
are the wrong tool for that.

**Never paste a credential into a chat, a note, or a shell command.** Copy it
to the clipboard and land it in a file (`pbpaste > .env.raw.local`), then
build the connection string from that file and delete the raw copy. The
password then exists in exactly two places: the file and your password
manager.

## 1. Fixture cleanup

The tracer prototype seeded one fixture row into `composition_snapshot`
(`fundId=sanitized-exploratory-fund`, the sanitized fixture used by
`pnpm push`). Delete it before real data lands, so nothing renders a mixed
picture of fixture and real snapshots.

**Why here, first:** deleting a row needs `DELETE` privileges. `numisma_push`
(the writer role) has **no DELETE** by design (ADR-007's one-way structural
guarantee), and `numisma_web` (the reader role) is SELECT-only. Only the Neon
owner role can run this `DELETE`.

**Getting an owner credential.** After step 2 there is no owner credential in
Vercel env at all, by design. Reset it in the Neon console (see step 2 for the
navigation path) and build the string by hand:

```sh
# Owner, against numisma_projection. The DATABASE is the part everyone gets
# wrong: every Neon-injected variable pointed at `neondb`, NOT
# `numisma_projection`, so `psql "$DATABASE_URL"` connects SUCCESSFULLY to the
# wrong database, where composition_snapshot does not exist.
psql "postgresql://neondb_owner:<PW>@ep-green-flower-adnzqyii.c-2.us-east-1.aws.neon.tech/numisma_projection?sslmode=require" \
  -c "SELECT current_user, current_database();"
```

If you are doing this *before* step 2 and still have a `DATABASE_URL_UNPOOLED`
on disk, the anchored substitution is:

```sh
OWNER_URL="$(grep -E '^DATABASE_URL_UNPOOLED=' .env.local \
  | sed -E 's/^DATABASE_URL_UNPOOLED=//; s/^"//; s/"$//; s|^(.*@[^/]+)/neondb|\1/numisma_projection|')"
```

The `^(.*@[^/]+)` anchor is load-bearing. A naive `s|/neondb|/numisma_projection|`
hits `://neondb_owner` first and yields
`password authentication failed for user 'numisma_projection_owner'`.

```sql
DELETE FROM composition_snapshot WHERE fund_id = 'sanitized-exploratory-fund';
```

**Verify:** `SELECT count(*) FROM composition_snapshot;` returns `0`.

**Also verify the invariant while you hold owner rights** — this proves
ADR-007's central structural claim against the live database, and costs one
query:

```sql
SELECT grantee, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE table_name = 'composition_snapshot' GROUP BY grantee ORDER BY grantee;
```

Expect `numisma_push` → INSERT, SELECT, UPDATE (**no DELETE**); `numisma_web`
→ SELECT only.

## 2. Stop the Neon owner-credential injection

**CORRECTED — the previous version said "remove the injected variables, then
rotate `neondb_owner`." That sequence cannot work: rotating is itself a
Neon-side change, which re-triggers the Marketplace integration's sync and
**re-injects every variable you just deleted**, with the new password. The
second half of the step undid the first half, every time.**

Vercel's Neon Marketplace integration auto-injects **18** variables scoped to
Production, Preview, **and** Development, holding credentials for
`neondb_owner` — a role that owns the entire Neon project: full
read/write/DELETE on `numisma_projection` and `numisma_auth`, including Better
Auth's `user` and `session` tables.

The full set is larger than the old `DATABASE_URL` / `POSTGRES_*` / `PG*`
globs suggested — three fall outside them entirely:

```
DATABASE_URL  DATABASE_URL_UNPOOLED  POSTGRES_URL  POSTGRES_URL_NON_POOLING
POSTGRES_URL_NO_SSL  POSTGRES_PRISMA_URL  POSTGRES_USER  POSTGRES_PASSWORD
POSTGRES_HOST  POSTGRES_DATABASE  PGHOST  PGHOST_UNPOOLED  PGUSER  PGPASSWORD
PGDATABASE  NEON_PROJECT_ID  NEON_AUTH_BASE_URL  VITE_NEON_AUTH_URL
```

This bypasses the invariant ADR-007 leans on hardest: that one-way-ness
(read-only web cred, no-DELETE push cred) is enforced **structurally, not by
convention**. Nothing in the codebase reads any of the 18 — but they are in
the **server runtime environment**, so any server-side RCE or SSRF can read
`process.env.DATABASE_URL` and delete everything.

**The fix is to sever the link, not to delete the variables:**

```sh
# Confirm the resource and project names first.
vercel integration ls

# Disconnect the resource FROM THE PROJECT. This removes the injected set and,
# unlike deletion, leaves nothing to re-sync across.
vercel integration-resource disconnect <resource> <project> --yes
```

> **`disconnect` is not `remove`.** `vercel integration-resource remove
> <resource>` **deletes the resource** — the database and its data. Never
> reach for it here. `disconnect` only unlinks env injection; the databases,
> roles, and data are untouched, and the project keeps working because the app
> reads its own hand-created secrets.

**Rotating the owner password is not a substitute and does not help.** The
integration syncs whatever the current password is, so a rotation propagates
straight back into Vercel env. Rotate only if you believe the password itself
leaked — and even then, disconnect is what removes it from the runtime.

**`vercel env rm` takes at most ONE environment.** The old
`vercel env rm DATABASE_URL production preview development` is misparsed — the
third positional is a git branch. These are single records with three targets,
so the bare name removes all of them: `vercel env rm <NAME> --yes`.

**Also remove the projection write credential.** `PROJECTION_WRITE_DATABASE_URL`
is hand-created, so `disconnect` does not touch it — but per
`docs/web-deploy-runbook.md` it "belongs to the push shell and one-shot
provisioning (local/operator only), never the deployed app." Having it in the
web project's env is the other half of ADR-007's one-way guarantee failing:

```sh
vercel env rm PROJECTION_WRITE_DATABASE_URL --yes
```

**Then delete the laptop copy.** `vercel env pull` wrote the owner credential
to `apps/web/.env.local`; the credential stays live there until Neon rotates
it. `rm apps/web/.env.local`.

**Verify — and verify BOTH views, because they disagree:**

```sh
vercel env ls                                              # STORED variables
vercel env pull --environment=production /tmp/check.env    # RESOLVED environment
grep -cE '^(DATABASE_URL|POSTGRES_|PG|NEON_)' /tmp/check.env   # must be 0
```

`vercel env ls` showing a clean list is **not sufficient** — that is exactly
what misled the first attempt. The pull shows what a deployment actually
resolves, which is where the owner credential hides. Afterwards the project
should hold exactly four variables, all Production-only:
`PROJECTION_DATABASE_URL`, `AUTH_DATABASE_URL`, `BETTER_AUTH_URL`,
`BETTER_AUTH_SECRET`.

**This is inert until you redeploy.** Vercel bakes env vars into a deployment
at build time; changing project env does nothing to already-running functions.
The currently-deployed build keeps its owner credentials until replaced, so
**step 2 is not enforced at runtime until step 5's deploy.** Those two steps
are coupled, not independent.

## 3. Spend threshold — only applicable on a paid plan

**CORRECTED — this step is not executable on the Free plan, and its stated
verification can never pass there.**

`vercel integration balance neon` reports
`Error: No balance information found for this integration`. There is no
balance, so there is nothing to attach a threshold to. The command also needs
four arguments the previous version omitted:

```sh
vercel integration-resource create-threshold <resource> <minimum> <spend> <limit>
```

Read those carefully before using them on a paid plan: this is an
**auto-recharge** configuration — when the balance falls below `minimum`,
purchase `spend` more, capped at `limit` total. That is close to the *opposite*
of what ADR-011 asked for, which is an **outage, not a bill**.

**On the Free plan, ADR-011's property already holds structurally**, for free:
hard caps (100 CU-hrs compute, 0.5 GB storage, 5 GB transfer) suspend the
database rather than billing past them.

**This matters for D5's accepted cost.** `src/lib/auth.ts` says DB-backed rate
limiting's write-on-every-attempt cost is "bounded out-of-band by an explicit
Neon spend threshold (D6)." **No such threshold exists.** The bound today is
the Free tier's hard caps — which works, but not for the reason the code
comment gives, and it **disappears on upgrade to a paid plan**. If you ever
upgrade, setting a threshold becomes load-bearing, not optional.

**If the fund view goes down unexpectedly, check the Neon usage caps before
assuming a code defect** — a suspended-database outage and a broken deploy
look identical from the phone.

**Current state:** plan tier **Free** (read from the Neon dashboard; the CLI
does not surface it). Threshold: **N/A — conditional on upgrading.**

## 4. Apply the auth schema

```sh
# AUTH_DATABASE_URL must come from your operator credential file (step 0),
# NOT from `vercel env pull` — a pull returns it EMPTY.
cd <repo root>
set -a; source apps/web/.env.auth.local; set +a
pnpm --filter @numisma/web auth:apply
```

Applies the vendored `better-auth.schema.sql`, including the hand-added
`rateLimit` table (Better Auth only emits this table when
`rateLimit.storage === "database"`, which is why it was absent before this
pass). Idempotent — safe to run twice.

**Why here, before the deploy that turns on `storage: "database"`:** without
the table, the rate limiter has nowhere to persist its counter and either
errors or silently falls back to per-instance state that defeats D5. **This
step must precede step 5's deploy** — the deploy is what activates the config
that needs this table. (The old numbering had these two the other way round.)

**Use the DIRECT (non-pooler) host** for this one; it is DDL.

**Verify:** the command prints `(1 created, N already present)` — the one
created being `rateLimit`. Then confirm:

```sh
psql "$AUTH_DATABASE_URL" -c '\dt'
```

Expect five tables: `account`, `rateLimit`, `session`, `user`, `verification`,
all owned by `numisma_auth_rw`.

## 5. Deploy

**CORRECTED — the previous version said `vercel deploy --prod`. That triggers
a REMOTE build, which cannot resolve this app's `workspace:*` dependencies
(`@numisma/engine`, `@numisma/event-store`). The repo deliberately has no
Vercel Git integration.**

**The procedure lives in `docs/web-deploy-runbook.md`** — build the Vercel
Build Output locally, upload the artifact:

```sh
rm -rf apps/web/.vercel/output          # `--prebuilt` ships whatever is there
pnpm --filter @numisma/web build
cd apps/web && vercel deploy --prebuilt --prod
```

The `rm -rf` is not paranoia: `--prebuilt` uploads `.vercel/output` **as it
currently is**, so a stale artifact from before the payload narrowing ships
silently.

**Why here — and why before step 6, which the old numbering had backwards:**
step 6's rotation is verified by signing in at the **deployed** URL, so the
deploy has to exist first. Deploying the reader before any real v2 row exists
is safe: `getLatestSnapshot` returns `status: "stale"` for a v1-shaped row and
`status: "empty"` once step 1 has run and before step 8's push. And per step 2,
**this deploy is what actually removes the owner credentials from the running
runtime.**

**Note the two URLs it prints.** The per-deployment URL changes every deploy;
the **stable alias** (`Aliased: https://<project>-<n>.vercel.app`) is the one
that matters for steps 6 and 7 and for `BETTER_AUTH_URL`.

**Verify:** load the stable alias; the dashboard shows a clean `stale` or
`empty` state ("no snapshot yet"), never a partially-rendered snapshot.

## 6. Rotate the seeded account password

**CORRECTED — the previous version's Plan A ("change the password via the
running app's sign-in + change-password UI") points at a UI that does not
exist. The app has four routes: `__root`, `api`, `index`, `login`. There is no
change-password screen and no client call to one.**

The tracer seeded `amet@example.com` with `prototype-pw-123`. It is no longer
in the repo but may still be live, and it is written in plaintext in an earlier
hand-off note.

**First, check whether it is still live** — one query, and it is far cheaper
than discovering the answer at a sign-in form:

```sql
SELECT u.email, u."createdAt", a."providerId", a."updatedAt" AS credential_updated
FROM "user" u LEFT JOIN account a ON a."userId" = u.id;
```

`credential_updated` equal to (or milliseconds after) `createdAt` ⇒ the
credential has never been touched ⇒ the prototype password is live.

**Optional but recommended: sign in with the old password before destroying
it.** It costs one of ten attempts per 300s and proves the whole chain —
`AUTH_DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and the
deployment — while you still hold a password you know.

**The procedure (the only one that works): delete the rows and re-seed.**
`auth:seed` is **create-only** (`findUserByEmail`, no-op if present) — it
**cannot** rotate a password. So remove the account first:

```sh
set -a; source apps/web/.env.auth.local; set +a
psql "$AUTH_DATABASE_URL" -c 'DELETE FROM account; DELETE FROM session; DELETE FROM "user";'
```

Delete order matters — `account` and `session` both reference `user`, so
`user` goes last or the foreign keys reject it.

Then generate a strong password in your password manager, **save it there
first**, and seed without it entering your shell history or any transcript:

```sh
pbpaste > apps/web/.env.raw.local      # clipboard -> gitignored file
set -a; source apps/web/.env.auth.local; set +a
NUMISMA_SEED_EMAIL=amet@example.com \
NUMISMA_SEED_PASSWORD="$(cat apps/web/.env.raw.local)" \
  pnpm --filter @numisma/web auth:seed
rm -f apps/web/.env.raw.local
```

**Because rotation is invisible from the outside, this is a verified step,
never a remembered one.** Verify both halves at the deployed URL, old first so
you end up signed in:

1. The **old** password (`prototype-pw-123`) is **rejected**.
2. The **new** password is **accepted**.

**Why this precedes step 7:** verifying sign-in consumes the
`/sign-in/email` bucket (window 300 / max 10). Run the attack first and you
wait out five minutes before you can verify anything.

## 7. Verify the rate limit by attack, not by inspection

```sh
# The env var avoids pnpm's `--` argument-forwarding entirely.
AUTH_VERIFY_BASE_URL=https://<stable-alias> pnpm --filter @numisma/web auth:verify-limit
```

Use the **stable alias**, not a per-deployment URL — the limit is keyed
`${ip}|${path}`, and probing a throwaway hostname tests a throwaway bucket.

This fires repeated wrong-password sign-in attempts against a reserved,
non-existent probe address (`rate-limit-probe@numisma.invalid` —
RFC-2606-reserved) and succeeds only when it observes an HTTP `429`. It cannot
lock out or affect the real seeded account (D5 — no lockout, deliberately).

**Run this from a phone hotspot or tether if you want to keep your own
connection clean.** The run consumes exactly one bucket:
`<your IP>|/sign-in/email` at window 300 / max 10, so **new sign-ins from that
IP get `429` for up to five minutes.** Unaffected either way: `/get-session`
is a separate key, so an existing session and the phone view keep working
straight through.

**Not a preview deployment.** Previews carry Deployment Protection and the app
secrets are Production-only ("verified unresolvable on Preview", ADR-011 D2) —
`AUTH_DATABASE_URL` among them. A preview cannot reach `numisma_auth`, and the
protection layer answers `401` before Better Auth sees the request. Both
surface as a non-`429`, which this script cannot distinguish from a genuinely
dead limiter: a preview run produces a **false `exit 1`**.

**Why config-reading cannot replace this.** Better Auth resolves
`rateLimit.enabled` to `isProduction` when unset and defaults `storage` to
`"memory"`; in-memory storage on Vercel is per-instance, so an attacker
distributed across cold starts gets a fresh budget every time.
`rateLimit: { enabled: true }` alone **looks** finished, passes review, and can
still ship a control that does nothing.

**Expect the first `429` between request #11 and #15.** With `concurrency 10`,
ten requests are in flight before the counter settles, so overshoot past
`max: 10` is normal — not drift, and not a bug to chase.

**Verify — TWO checks. The script alone is not sufficient, and it says so.**

1. The script exits `0` (a `429` was observed) against the real deployed URL.
2. **The counter reached Postgres.** The script's own closing caveat is that a
   PASS cannot distinguish a shared DB-backed counter from a per-instance
   in-memory one. This query closes that gap — if storage were memory, there
   would be **zero rows**:

   ```sh
   psql "$AUTH_DATABASE_URL" -c "SELECT count(*) AS rows, bool_or(key LIKE '%/sign-in/email') AS has_signin_bucket, max(count) AS max_count FROM \"rateLimit\";"
   ```

   Expect one row with `has_signin_bucket = t`. **`max_count` parks just above
   `max: 10`** (≈11), not at the attempt count — rejections don't increment,
   and concurrent read-modify-write loses a few. Do not read that as data loss.

   Do **not** print `key` itself into a shared log; it embeds your public IP.

## 8. First real push by hand, then soak

`pnpm --filter @numisma/web push` folds the durable genesis + event log into a
`CompositionReport` and upserts it — that is the **only** thing it can do. The
fixture path has left the command entirely: no `--fixture` flag, no env
toggle, no fallback.

```sh
set -a; source apps/web/.env.push.local; set +a
pnpm --filter @numisma/web push
```

**Preconditions, as checkable facts:**

- **`NUMISMA_DATA_DIR` should be UNSET.** Unset resolves to
  `~/Dev/accumulus/data` — the real durable store (`packages/engine/src/data-dir.ts`).
  *Verify it is unset* rather than setting it: exporting it by hand is the risk,
  since a typo silently redirects the fold to a ghost ledger. (A relative value
  is rejected loudly by design; an absolute one is taken at its word.)
- `PROJECTION_WRITE_DATABASE_URL` comes from `apps/web/.env.push.local`
  (step 0) — **not** from `vercel env pull`, which returns it empty, and not
  from Vercel at all, where it must no longer exist (step 2).
- The durable log is well-formed. A corrupt, partial, or legacy-shape line
  makes the push **fail loud**: non-zero exit, no database write, because the
  fold happens before the pool opens. That failure is the system working — the
  fix is the log, never the push.

**Where `asOf` comes from.** The pushed row's `asOf` is the **last applied
event's date** (seeded from genesis), never the run date. Three consequences,
all expected rather than faults:

- **One row per `asOf`.** A second push the same day updates that row —
  `report` and `schema_version` refresh, `pushed_at` bumps — it does not add one.
- **A quiet day refreshes yesterday's row.** No new marks ⇒ `asOf` unchanged ⇒
  the previous date's row refreshes and the dashboard keeps showing that date.
  Expected on a weekend or market holiday.
- **Staleness is version-mismatch only — there is no age check.** `stale` fires
  when a stored row's schema version disagrees with the reader. An `asOf` that
  hasn't moved in days renders exactly as "ok".

**Two success signals — do not report one for the other.**

1. **Push-side (code half):** exit `0`, prints
   `fundId=<slug> asOf=<log's last event date> schemaVersion=2`; exactly one
   row for that `(fund_id, as_of)`; the `report` JSONB carries exactly
   `totals` and `dashboard`. Verify all three at once — this asserts what
   *landed*, which is stronger than the CI contract test's assertion about
   what the code *would produce*:

   ```sh
   psql "$PROJECTION_WRITE_DATABASE_URL" -c "SELECT fund_id, as_of, schema_version, pushed_at, (SELECT count(*) FROM composition_snapshot) AS total_rows, (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(report) AS k) AS report_keys FROM composition_snapshot;"
   ```

   (`numisma_push` holds SELECT, so this needs no extra credential.)
2. **Gate-closing (the actual signal, map 8.1):** the deployed URL, opened
   **on the phone away from the desk**, shows that same composition with that
   same `asOf`. Exit `0` on the push is **not** the gate closing; only the
   phone check is.

**The soak — a condition to check, not a mood.** After the first push verifies
clean (both signals), keep running the push **by hand, once a day** and watch
the dashboard for **at least one week** spanning at least one weekend:

- Each day's `asOf` matches the log's actual last-event date — never the run
  date, never frozen while the log grows.
- A weekend / no-new-marks day shows the previous trading day's `asOf`
  unchanged, and this is *not* logged as an incident.
- No push fails, and no push writes more than one row per day.
- The numbers on the phone match the local fold, hand-checked at least once
  mid-week.

Only once all four hold across the full week does step 9 become something to
consider.

## 9. Automate the push into the existing daily schedule

Only after step 8's soak, wire the push into the existing daily schedule
alongside the price-feed run (`ops/price-feed/run-daily-fetch.sh` /
`com.numisma.pricefeed.daily.plist` — see `docs/price-feed-ops.md`).

The scheduled shell must source `apps/web/.env.push.local`, since the
credential is deliberately not in Vercel and not in the environment.

**Verify:** the next scheduled run's log shows a successful push, and the
dashboard's `asOf` advances the following day without manual intervention.

## Losing the keys / revoking access

Where a panicking operator looks first. Both levers work instantly and need
nothing but console access — no deploy.

**Prerequisite, and it is easy to get wrong:** these levers need a credential
for `numisma_auth` that **you actually hold**. Vercel's copy is unreadable
(step 0) and the owner password may be rotated-and-discarded. If
`apps/web/.env.auth.local` is missing, the *first* step of any emergency is
resetting a role password in the Neon console — minutes you will not want to
spend. **ADR-011 / D7 justifies the 30-day rolling session on the grounds that
this revocation path works and is findable in under a minute. That is only
true if the credential is in your password manager.**

- **Log out every device immediately:**

  ```sh
  set -a; source apps/web/.env.auth.local; set +a
  psql "$AUTH_DATABASE_URL" -c 'DELETE FROM session;'
  ```

- **The second half of the same button — invalidate every session AND disable
  a leaked `BETTER_AUTH_SECRET`:** rotate `BETTER_AUTH_SECRET` in Vercel env
  **and redeploy** (step 5). Sessions are signed with this secret, so rotating
  it invalidates all of them, and it closes the door if the secret is what
  leaked. Remember the redeploy — an env change alone does nothing to the
  running deployment.

## Neon console navigation

**CORRECTED — "Neon → project → Roles" does not exist.** Roles are
per-**branch**, two levels below where the previous version pointed:

**Neon → project → Branches → `main` → "Roles & Databases" tab.**

Each role's `⋮` menu holds `Reset password` (and `Delete role` directly below
it — mind the gap). The table **reorders** as rows are updated, so match on the
role name, not on row position.

The plan tier is on **project → Billing**; the CLI does not surface it
(`vercel integration balance neon` reports balance, not plan).

## Known maintenance note

`pg-connection-string` v3 / `pg` v9 will change `sslmode=require` to weaker
libpq semantics. Today `require` is treated as `verify-full`, which is what
these connection strings rely on. On that upgrade, change them to
`sslmode=verify-full` explicitly, or the strings silently weaken. Every
`psql`/script run currently prints this as a warning.

## Verification record

| Verification | Type | Result | Date |
| --- | --- | --- | --- |
| Forbidden-key contract test (`apps/web/src/push/projection-payload.test.ts`) | automated, red on drift | runs in CI on every push/PR | n/a — continuous |
| Fixture row deleted; `composition_snapshot` empty before first real push | manual | PASS — `DELETE 1`, count 0 | 2026-07-25 |
| Live grant audit on `composition_snapshot` (ADR-007 one-way, against the real DB) | manual | PASS — push: INSERT/SELECT/UPDATE, no DELETE; web: SELECT only | 2026-07-25 |
| Neon owner-credential injection stopped (`integration-resource disconnect`) | manual | PASS — 18 vars gone from **stored and resolved**; 4 remain, Production-only | 2026-07-25 |
| `PROJECTION_WRITE_DATABASE_URL` removed from web runtime (ADR-007 split-cred) | manual | PASS | 2026-07-25 |
| Spend threshold | manual | **N/A — Free plan, no balance to threshold.** Conditional on upgrade | 2026-07-25 |
| Auth schema applied, `rateLimit` table present | manual | PASS — `(1 created, 7 already present)`; 5 tables | 2026-07-25 |
| Seeded account password rotated — old rejected, new accepted | manual | PASS — both halves verified at the deployed URL | 2026-07-25 |
| Rate-limit attack against the deployed URL (`auth:verify-limit`) | manual | PASS — 150 attempts, `403=14 429=136`, first 429 at #15, exit 0 | 2026-07-25 |
| Rate-limit counter is DB-backed (D5), not per-instance memory | manual | PASS — 1 row, `has_signin_bucket=t`, `max_count=11` | 2026-07-25 |
| First real push, push-side signal | manual | PASS — `fundId=accumulus-fund asOf=2026-07-24 schemaVersion=2`; 1 row; keys `{dashboard,totals}` | 2026-07-25 |
| First real push, **gate-closing** signal (phone, away from desk) | manual | TODO | TODO |
| Soak: one week spanning a weekend, four conditions hold | manual | TODO | TODO |

## Open items

- **Neon plan tier: Free.** Resolved 2026-07-25 (Neon dashboard). Consequence:
  step 3 is N/A, and D5's "bounded by a spend threshold" claim is actually
  bounded by Free's hard caps — revisit on any upgrade.
- **Does the Marketplace integration re-inject the owner set? YES.** Resolved
  2026-07-25 the hard way: deleting all 18 variables and then rotating the
  owner password re-injected all 18 within minutes, with the new password.
  Deletion is not a fix; `integration-resource disconnect` is. Re-run the
  step 2 verification (**both** `env ls` and a pull) after any Marketplace or
  Neon-side change, and log the date it comes back clean.
- **`BETTER_AUTH_URL` is set but unreadable** (sensitive), so its exact value
  is unverified from the CLI. Sign-in and callbacks work against the stable
  alias, which is the behavioural proof. If it ever needs to change, overwrite
  it (`env rm` + `env add`) and **redeploy**.
