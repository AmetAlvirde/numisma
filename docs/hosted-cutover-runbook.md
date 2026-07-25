# Hosted cutover runbook (ADR-007 / ADR-011)

The console-side checklist for going from "the hosted security pass is
merged" to "real fund data is live and reviewed nightly on the phone." Code
cannot do any of these — they are Vercel/Neon console actions, credential
rotations, and human verification. Follow the steps **in this order**; the
order is load-bearing, not incidental (see each step's "why here").

Model: `docs/projection-provisioning.md` (the provisioning mechanism these
steps rely on) and `docs/price-feed-ops.md` (the daily-schedule shape step 9
extends). Read both if a step references a command or file you don't
recognize.

## 1. Fixture cleanup

The tracer prototype seeded one fixture row into `composition_snapshot`
(`fundId=sanitized-exploratory-fund`, the sanitized fixture used by
`pnpm push`). Delete it before real data lands, so nothing renders a mixed
picture of fixture and real snapshots.

**Why here, first:** deleting a row needs `DELETE` privileges.
`numisma_push` (the writer role) has **no DELETE** by design (ADR-007's
one-way structural guarantee), and `numisma_web` (the reader role) is
SELECT-only. Only the Neon `neondb_owner` role can run this `DELETE` — and
step 2 removes and rotates that role's credentials from Vercel env. Do this
step **before or during** step 2's rotation, or the only way to clean up the
fixture is fishing the (about-to-be-rotated) owner password back out of the
Neon console for one query.

```sql
-- run against numisma_projection with the (still-live, pre-rotation) owner credential
DELETE FROM composition_snapshot WHERE fund_id = 'sanitized-exploratory-fund';
```

**Verify:** `SELECT count(*) FROM composition_snapshot;` returns `0` before
step 4's real push.

## 2. Remove the Neon auto-injected owner-credential set, then rotate `neondb_owner`

Vercel's Neon Marketplace integration auto-injects roughly 17 variables
(`DATABASE_URL`, `POSTGRES_*`, `PG*`) scoped to Production, Preview, **and**
Development, holding credentials for `neondb_owner` — a role that owns the
**entire Neon project**: full read/write/DELETE on both `numisma_projection`
and `numisma_auth`, including Better Auth's `user` and `session` tables.

This bypasses the invariant ADR-007 leans on hardest: that one-way-ness
(read-only web cred, no-DELETE push cred) is enforced **structurally, not by
convention**. The split is real in the app and unenforced at the environment
layer as long as the master key sits beside the restricted ones in every
environment.

**Why here, second:** removal is near-zero-risk — nothing in the request
path wants owner rights, and the two scripts that do (`db:provision`,
`auth:apply`) run deliberately and locally with their own admin credential,
not this one. Rotation follows removal because the password lived in
surfaces `vercel env pull` copies straight onto laptops (lower-trust than
Vercel env itself).

```sh
# see what Neon injected (scope column shows Production/Preview/Development):
vercel env ls

# remove each Neon-injected variable from every scope it appears in:
vercel env rm DATABASE_URL production preview development
vercel env rm POSTGRES_URL production preview development
# ...repeat for the full POSTGRES_* / PG* set vercel env ls surfaced.
```

Then, in the Neon console, rotate the `neondb_owner` password (Neon →
project → Roles → `neondb_owner` → Reset password). The old credential stops
working immediately; nothing in the running app uses it, so this is safe to
do without a deploy.

**Standing caveat — this is a recurring verification, not a one-time
deletion.** The Neon Marketplace integration may re-inject the owner set on
its next sync. Re-run `vercel env ls` periodically (recorded with a date in
the verification table below) and repeat the removal if the set reappears.

**Verify:** `vercel env ls` shows no `DATABASE_URL` / `POSTGRES_*` / `PG*`
entries in any scope; the app's five named secrets
(`PROJECTION_DATABASE_URL`, `PROJECTION_WRITE_DATABASE_URL`,
`AUTH_DATABASE_URL`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`) are untouched
and still Production-only.

## 3. Set the spend threshold

```sh
vercel integration-resource create-threshold
# follow the prompt to select the Neon resource and set a monthly USD cap
```

One command, no code, no deploy — the cheapest control in this pass. See
ADR-011 for why the resulting behavior under attack is an **outage**, not a
bill: past the threshold, Neon suspends the database rather than continuing
to charge. **If the fund view ever goes down unexpectedly, check this
threshold before assuming a code defect** — a suspended-database outage and
a broken deploy look identical from the phone.

**Verify:** `vercel integration balance neon` (or the Neon console's
usage/billing page) shows the threshold configured. Record the value and the
date in the verification table below — the Neon plan tier is not otherwise
surfaced by the CLI (see "Open items").

## 4. Deploy the narrowed payload

The payload narrowing (ADR-007's amendment, ADR-011) is already code:
`ProjectionReport = Pick<CompositionReport, "totals" | "dashboard">`,
`COMPOSITION_SNAPSHOT_SCHEMA_VERSION` bumped 1 → 2. Deploy it normally.

```sh
vercel deploy --prod
```

**Why here:** deploying the reader before any real v2 row exists is safe —
`getLatestSnapshot` returns `status: "stale"` for the still-present (until
step 1) v1-shaped fixture row rather than mis-rendering it, and `status:
"empty"` once step 1's cleanup has run and before step 8's real push.

**Verify:** load the deployed URL; the dashboard shows a clean "stale" or
"empty" state, never a partially-rendered snapshot.

## 5. Apply the auth schema

```sh
pnpm --filter @numisma/web auth:apply
```

Applies the vendored `better-auth.schema.sql`, including the hand-added
`rateLimit` table (Better Auth only emits this table when
`rateLimit.storage === "database"`, which is why it was absent before this
pass). Idempotent — safe to run twice.

**Why here, before or with the deploy that turns on `storage: "database"`:**
without the table, the rate limiter has nowhere to persist its counter and
either errors or silently falls back to a per-instance state that defeats
the whole point of D5.

**Verify:**

```sql
-- against AUTH_DATABASE_URL
SELECT to_regclass('public."rateLimit"');   -- not null
```

## 6. Rotate the seeded account password

The tracer seeded `amet@example.com` with `prototype-pw-123`. It is no
longer in the repo but may still be live, and it is written in plaintext in
an earlier hand-off note. Rotate it to a strong, unique, manager-generated
password before real data is pushed.

```sh
# set NUMISMA_SEED_EMAIL / NUMISMA_SEED_PASSWORD in Vercel env to the new
# credentials, then either re-run the idempotent seed against the auth DB
# directly, or use Better Auth's change-password flow signed in as the
# existing account. auth:seed only CREATES a missing account — it will not
# overwrite an existing password — so rotate through Better Auth itself:
pnpm --filter @numisma/web auth:apply   # ensure schema is current first
# then change the password via the running app's sign-in + change-password UI,
# or the internal adapter, using the new value.
```

**Because rotation is invisible from the outside, this is a verified step,
never a remembered one.** Verify both halves:

1. The **old** password (`prototype-pw-123`) is rejected at sign-in.
2. The **new** password is accepted at sign-in.

Record the result and date in the verification table below.

## 7. Verify the rate limit by attack, not by inspection

```sh
pnpm --filter @numisma/web auth:verify-limit -- --url https://<deployed-url>
```

This fires repeated wrong-password sign-in attempts against a reserved,
non-existent probe address (`rate-limit-probe@numisma.invalid` —
RFC-2606-reserved, can never collide with a real account) and succeeds only
when it observes an HTTP `429`. It cannot lock out or affect the real seeded
account.

**Why this step cannot be replaced by reading the config.** Better Auth
resolves `rateLimit.enabled` to `isProduction` when unset, and defaults
`storage` to `"memory"` — in-memory storage on Vercel is per-instance, so an
attacker distributed across cold starts gets a fresh budget every time.
`rateLimit: { enabled: true }` alone **looks** finished, passes a code
review, and can still ship a control that does nothing. Only firing enough
requests to spread across multiple serverless instances — which a live probe
against a deployed URL does and a config read cannot — distinguishes a
working shared limiter from a fake per-instance one. A prior throwaway-DB
probe during this pass saw the first `429` at request 11, with the counter
row landing correctly in the new `rateLimit` table — that was local
verification; this step is the deployed-environment repeat.

**Verify:** the script exits `0` (a `429` was observed) against the real
deployed URL. Record the result and date below — exit `1` here means the
limiter is not actually working in production regardless of what the config
says.

## 8. First real push by hand, then soak

`pnpm --filter @numisma/web push` folds the durable genesis + event log into
a `CompositionReport` and upserts it — that is the **only** thing it can do.
The fixture path has left the command entirely: no `--fixture` flag, no env
toggle, no fallback. There is no "am I looking at the fixture?" question left
to resolve at the console. (Step 1's fixture cleanup removed a *database
row*; the fixture JSON itself remains on disk as a test fixture, loaded only
by the test suite — the two are unrelated after this step.)

```sh
pnpm --filter @numisma/web push
```

**Preconditions, as checkable facts, not hopes:**

- `NUMISMA_DATA_DIR` points at the real durable-data store (the accumulus
  checkout), not a scratch or test directory.
- `PROJECTION_WRITE_DATABASE_URL` (the no-DELETE writer credential) is set in
  the shell the push runs from.
- The durable log is well-formed. A corrupt, partial, or legacy-shape log
  line makes the push **fail loud**: non-zero exit, no database write. That
  failure is the system working as designed — the fix is the log (re-run
  ingest, repair the offending line), never the push. Do not work around a
  failed push here; find out why the log is malformed first.

**Where `asOf` comes from.** The pushed row's `asOf` is the **last applied
event's date** (seeded from genesis), never the date the push happens to run
on. Three consequences follow directly, and an operator should expect all
three rather than treat any of them as a bug:

- **One row per `asOf`.** A second push the same day updates that same row —
  `report` and `schema_version` refresh, `pushed_at` bumps — it does not add
  a row.
- **A quiet day refreshes yesterday's row, not today's.** If no new marks
  landed since the last push, `asOf` is unchanged, so the push refreshes the
  *previous* date's row rather than creating a new one — and the dashboard
  correctly continues to show that earlier date. This is expected on a
  weekend or a market holiday, not a fault to chase.
- **Staleness on the reader is version-mismatch only — there is no age
  check.** The dashboard's `stale` state fires only when a stored row's
  schema version disagrees with what the reader expects. An `asOf` that
  hasn't moved in days is not staleness; it renders exactly as "ok" as a
  same-day push does.

**Why here, and why not automated yet:** doing the first real push and
wiring it into a schedule at the same time means a broken push either
silently overwrites a good snapshot on a timer, or starts publishing before
a real fund has ever been seen to render correctly (Decision D10). The first
real push must be manual, watched, and lived with before step 9 is even
considered.

**Two success signals — do not report one for the other.**

1. **Push-side (code half):** the command exits `0` and prints
   `fundId=<slug> asOf=<the log's last event date> schemaVersion=2`; exactly
   one row exists for that `(fund_id, as_of)`; the row's `report` JSONB
   carries exactly the two keys `totals` and `dashboard`. This is verifiable
   from the shell alone and says nothing about what a browser shows.
2. **Gate-closing (the actual signal, map 8.1):** the deployed URL, opened on
   the phone away from the desk, shows that same composition with that same
   `asOf`. This depends on the console/cutover track completing in
   parallel — step 1's fixture-row deletion, step 2's owner-credential
   rotation, step 4's deploy, step 5's auth schema, step 6's password
   rotation — and cannot happen from the push command alone. Exit `0` on
   the push is **not** the gate closing; only the phone check is.

**The soak — a condition to check, not a mood.** After the first push
verifies clean (both signals above), keep running the push **by hand, once a
day** — the cadence step 9 will eventually automate — and watch the dashboard
for **at least one week** spanning at least one weekend:

- Each day's `asOf` matches the durable log's actual last-event date — never
  the run date, never frozen on a stale value while the log keeps growing.
- A weekend or no-new-marks day shows the previous trading day's `asOf`
  unchanged, per the second bullet above, and this is *not* logged as an
  incident.
- No push during the week fails, and no push writes more than one row per
  day.
- The numbers on the phone match the local fold by hand-checking at least
  once mid-week.

Only once all four hold across the full week does step 9 become something to
consider — the soak is the acceptance gate step 9 is conditioned on, not a
suggestion to automate immediately after the first clean push.

**Verify:** record both signals from the section above, separately, with
their dates — the push-side signal after each manual push during the soak
week, and the gate-closing signal (phone, away from the desk) at least once
after the console/cutover track has completed.

## 9. Automate the push into the existing daily schedule

Only after step 8's soak period, wire the push into the existing daily
schedule alongside the price-feed run (`ops/price-feed/run-daily-fetch.sh` /
`com.numisma.pricefeed.daily.plist` — see `docs/price-feed-ops.md`), so a
fresh snapshot lands in the projection every day without a manual step.

**Verify:** the next scheduled run's log shows a successful push, and the
dashboard's `asOf` date advances the following day without manual
intervention.

## Losing the keys / revoking access

Where a panicking operator looks first. Both levers work instantly and
require nothing but direct Neon/Vercel console access — no deploy.

- **Log out every device immediately:**

  ```sql
  -- against AUTH_DATABASE_URL
  DELETE FROM session;
  ```

  Every active session is invalidated at once; the next request from any
  device is forced back to sign-in.

- **The second half of the same button — invalidate every session AND
  disable any leaked `BETTER_AUTH_SECRET`:** rotate `BETTER_AUTH_SECRET` in
  Vercel env and redeploy. Because sessions are signed with this secret,
  rotating it invalidates all of them, the same way `DELETE FROM session`
  does, but also closes the door if the secret itself is what leaked.

**The 30-day rolling session (ADR-011 / D7) is only safe because this lever
exists and works.** A long session trades convenience for a real, working
revocation path rather than for "nobody will notice" — it is written here,
not just reasoned about in code comments, because it only counts if a
panicking operator can find it in under a minute.

## Verification record

Fill in the manual rows after doing the console work. Leave them TODO until
then — an unfilled row is more honest than a guessed one.

| Verification | Type | Result | Date |
| --- | --- | --- | --- |
| Forbidden-key contract test (`apps/web/src/push/projection-payload.test.ts`) | automated, red on drift | runs in CI on every push/PR | n/a — continuous |
| Rate-limit attack verification (`pnpm --filter @numisma/web auth:verify-limit`) against the deployed URL | manual | TODO | TODO |
| Env / threshold state (`vercel env ls` clean of Neon owner creds; spend threshold set) | manual | TODO | TODO |

## Open items

- **Neon plan tier is not established.** The Vercel/Neon CLI does not
  surface it (`vercel integration balance neon` reports balance, not plan).
  Read it once from the Neon dashboard (project → Billing) and record it
  here: `TODO`.
- **Whether the Marketplace integration re-injects the owner-credential set
  on sync is unverified.** Until confirmed either way, step 2's removal is a
  **standing check**, not a one-time deletion — re-run `vercel env ls`
  periodically and log the date each time it comes back clean.
