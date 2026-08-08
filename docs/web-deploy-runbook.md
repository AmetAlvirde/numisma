# Web deploy runbook — git-push deploy (primary) + prebuilt CLI (fallback)

How to deploy `@numisma/web` (the TanStack Start read-projection dashboard,
ADR-007 / ADR-009) to Vercel.

**Primary path (since 2026-07-25): git-push deploy.** The Vercel project
`numisma-web` is connected to the GitHub repo `AmetAlvirde/numisma`. Merging to
`main` deploys production. Pushing any branch builds a preview.

**Fallback path: `vercel build` + `vercel deploy --prebuilt`, from the repo
root.** Kept, fully
usable, and documented below — it is the escape hatch when the git builder path
breaks. It is no longer the default.

> **This reverses a previously documented decision.** Until 2026-07-25 this repo
> deliberately had **no** Vercel Git integration, and both `apps/web/vite.config.ts`
> ("We do NOT deploy from this repo") and this runbook said so. That decision was
> reversed by the operator on 2026-07-25; ADR-009's "Deploy reality: prebuilt CLI,
> not git-push CI/CD" consequence carries a dated amendment recording it.
>
> **PRD #121's out-of-scope D2 — "automated CI/CD (git-push deploy) is deferred" —
> is therefore superseded, not still pending.** The deferral was real when written
> and has now been closed by wiring the integration rather than by an increment.
> If you find a doc still asserting the manual-only regime or the open deferral,
> that doc is stale — this one and the ADR-009 amendment are the record.

## Project wiring (the facts a reader needs)

| Setting | Value |
| --- | --- |
| Vercel project | `numisma-web` (`prj_fnEbtoHmuXbevg6twcNhV7XPvbfF`) |
| Vercel org | `team_tul6wDdH2XbZJFV65cTMo6of` |
| Git repo | `AmetAlvirde/numisma` |
| Root Directory | `apps/web` (was `.`) |
| Production branch | `main` |
| Framework preset | Nitro |
| Node version | 24.x |
| Output Directory | None (Nitro emits the Build Output API v3 layout itself) |

The build target is pinned in the repo: `apps/web/vite.config.ts` sets the Nitro
Vite plugin to `preset: "vercel"`, so `vite build` — whether run locally or on
Vercel's builders — emits a **Vercel Build Output API v3** artifact at
`apps/web/.vercel/output`. Both paths below produce the same artifact shape; they
differ only in *where* the build runs and *who* triggers it.

**The CLI link lives at the repo root**: `/Users/amet/Dev/numisma/.vercel/project.json`
(git-ignored; linking appended `.vercel` to the root `.gitignore`, which
previously only `apps/web/.gitignore` carried). Every `vercel` CLI command in
this runbook runs from the **repo root**. An older link at
`apps/web/.vercel/project.json` still exists on disk and is no longer the one to
use — see
[the fallback runs from the repo root](#the-fallback-runs-from-the-repo-root-not-appsweb).

## Primary: deploy by pushing

Production:

```bash
# Merge to main. That is the deploy.
git push origin main        # or merge the PR on GitHub
```

Preview:

```bash
git push origin <branch>    # any branch push builds a preview
```

There is no separate command. Vercel clones the repo, builds from Root Directory
`apps/web`, and publishes. The build chain is
`vercel build` → `pnpm run build` → `vite build`.

**The workspace resolves — verified, not assumed.** A git-connected build was run
on 2026-07-25 (deployment `dpl_BSahSvPJoEwRHfLuUBRFWDQzc7Nm`, state `READY`). Its
log shows `Scope: all 6 workspace projects`, then
`+ @numisma/engine 0.7.3 <- ../../packages/engine` and
`+ @numisma/event-store 0.7.3 <- ../../packages/event-store`, install
`Done in 5.8s using pnpm v11.1.2`, Nitro emitting `.vercel/output`, and
`Build Completed in /vercel/output [23s]`. This works because the **clone
includes the root `pnpm-workspace.yaml`** and pnpm installs from the workspace
root. `pnpm@11.1.2` installs with **no corepack flag** — do not add
`ENABLE_EXPERIMENTAL_COREPACK`.

**Do not carry forward "a remote build cannot resolve `workspace:*`."** That was
true of the **CLI source-upload** path, which uploads only `apps/web/` and so has
no workspace root. It was never a property of remote builds as such, and it does
not apply to the git path.

**Consequences to hold in mind:**

- **Every merge to `main` ships production.** This was accepted knowingly: the
  projection DB is separate and re-pushable (ADR-007 §8.2), so a bad production
  deploy costs a revert-and-merge, not data.
- **A merge is a deploy even when the change is docs-only.** That is noise, not
  a fault.
- **A push with a byte-identical tree deploys nothing at all.** Vercel skips it —
  no deployment, not even a skipped record. Pushing a branch whose tree matches
  `main` produces total silence, which looks exactly like a broken integration.
  If your push "didn't deploy", first check that you actually changed a file.
- **Env is baked at build time**, so the redeploy rule in
  [Gotchas](#an-env-change-needs-a-redeploy-to-take-effect) still applies —
  changing a variable in the Vercel dashboard does nothing until the next build.

### Previews are build smoke checks, not working apps

**Preview environment variables are deliberately EMPTY.** A preview deployment
therefore proves exactly one thing: **the app compiles and the build succeeds**.

**Judge a preview by whether the build succeeded, not by exercising the app.** A
preview build compiles and deploys, and the app shell renders and returns **200**.
It is not usable: with no Preview environment variables, any route that needs the
database **redirects** rather than serving, and sign-in cannot complete — logging
in is itself what needs `AUTH_DATABASE_URL`. This is designed behavior, not an
incident and not a regression.

The app's actual route table (`apps/web/src/routeTree.gen.ts`) is `/`,
`/login`, `/big-picture`, and the `/api/auth/$` splat — there is no
`/dashboard` route (the dashboard renders at `/`) and no `/api/health` route.
Measured against those real routes on a live preview with empty env:

| Route | Result |
| --- | --- |
| `/`, `/login`, `/big-picture` | `200` — shell renders |
| `/api/auth/get-session`, `/api/auth/session` (matched by `/api/auth/$`) | `302` redirect |

**No 500s.** Unauthenticated traffic is redirected before anything touches the
database, so there is no error to see — which is exactly why the green-looking
preview must not be mistaken for a working app.

This also strengthens ADR-011 D2's "app secrets are Production-only, verified
unresolvable on Preview": on Preview there is now nothing to resolve.

Corollary for anything that must be exercised against real data or real auth —
notably `pnpm --filter @numisma/web auth:verify-limit` — **run it against
production, never a preview.** A preview produces a false failure that reads
exactly like a true one (see `apps/web/src/auth/verify-rate-limit.ts` and
`docs/hosted-cutover-runbook.md` step 7): the redirect it gets back is a
non-`429`, indistinguishable from a dead limiter.

### Parked want: previews that actually run (deferred, not solved)

The operator's stated intent, 2026-07-25: *"in the future we want to be able to
preview successfully, but that is another bridge to cross."* Recorded here so the
next person knows this is a **deferred want with known blockers**, not an
oversight. It is **not** designed and **not** implemented. The two blockers, as
identified at the time:

1. **`AUTH_DATABASE_URL` is a read-write credential.** Populating Preview means
   handing an RW credential to every preview build, on every branch, including
   branches nobody is watching. That exposure is the objection — not the effort.
2. **`BETTER_AUTH_URL` is a fixed origin.** Preview URLs are per-deployment and
   generated, so a single stored value cannot match them. Making it match would
   require deriving the origin from `VERCEL_URL` at runtime, which is a code
   change to how the auth origin is resolved, not an env setting.

Anyone picking this up: solve those two, don't just fill in the variables.

### What CI still does (it is not redundant)

`.github/workflows/ci.yml` runs `pnpm --filter @numisma/web build` on every branch
push, against a **real Postgres**. It stays. Vercel's preview build overlaps only
on "does it compile"; **CI is the DB-backed gate** — it runs real-Postgres
invariant tests Vercel never will, and with no database attached to previews it
never could. Green Vercel preview + red CI means the change is broken.

## Fallback: manual prebuilt CLI deploy

Use this when the git builder path is unavailable or broken — a Vercel-side
build failure you need to route around, an urgent ship while the integration is
misconfigured, or deploying a local state that is not on a branch. It is a
complete, supported path; it is simply not the default anymore.

> **This procedure changed on 2026-07-25 and the old one no longer works.**
> Moving Root Directory to `apps/web` broke the `cd apps/web && vercel deploy
> --prebuilt` invocation this runbook used to document. **Everything below runs
> from the repo ROOT.** See
> [the fallback runs from the repo root](#the-fallback-runs-from-the-repo-root-not-appsweb).

### Prerequisites

- Vercel CLI installed and authenticated: `vercel login`.
- **The project linked at the repo root.** From `/Users/amet/Dev/numisma`, run
  `vercel link --yes --project numisma-web`. This writes
  `/Users/amet/Dev/numisma/.vercel/project.json` and appends `.vercel` to the
  **root `.gitignore`** (previously only `apps/web/.gitignore` ignored it). The
  older `apps/web/.vercel/` link still exists on disk and is no longer the one
  this path uses.
- Environment variables set in the Vercel **project** (Production scope) — see
  [Environment variables](#environment-variables). These are read at **runtime**
  by the deployed server functions; they are NOT baked into the prebuilt output.

### Steps

**Run every command from the repo root.** Not from `apps/web/`.

```bash
cd /Users/amet/Dev/numisma          # repo ROOT — not apps/web

# 1. Fetch project settings. Without this, `vercel build` errors
#    `project_settings_required`.
vercel pull --yes --environment production

# 2. Build the Vercel Build Output artifact at the ROOT (.vercel/output).
vercel build --prod

# 3. Upload it.
vercel deploy --prebuilt --prod
```

For a **preview** (non-production) deploy, pull the preview environment and drop
`--prod`:

```bash
cd /Users/amet/Dev/numisma
vercel pull --yes --environment preview
vercel build
vercel deploy --prebuilt
```

**Verification status, stated exactly.** The mechanism above was executed
end-to-end on the **preview** target on 2026-07-25 (deployment
`numisma-8e6tdvrxt`, state `READY`). The `--prod` variant was deliberately **not**
run, to avoid shipping production ahead of a merge test; it differs only in which
environment is pulled and the target flag. So: mechanism verified on preview,
production commands documented but not executed.

**`vercel build` replaces `pnpm --filter @numisma/web build` on this path.** From
the root, `--prebuilt` looks for `.vercel/output` **at the root**, not at
`apps/web/.vercel/output`. Running the pnpm build alone puts the artifact in the
wrong place and the deploy fails with "no prebuilt output found". The pnpm build
is still the right command for a normal local build — just not for this deploy
path.

**Caution:** `vercel pull --environment production` writes the **real production
secrets** to `.vercel/.env.production.local`. It is git-ignored, but it is a
plaintext copy of all four app secrets on disk — treat it as credential custody
(ADR-011 D9: a secret rotates when an event changes who could have seen it), and
delete it when you are done.

`vercel deploy --prebuilt` uploads the built output without re-building. It prints
the deployment URL; open it (or the project's production domain) and confirm the
dashboard renders (login → fund summary + composition sections).

**Note the two URLs it prints.** The per-deployment URL changes every deploy; the
**stable alias** is the one that matters for `BETTER_AUTH_URL`.

### Why this path exists (and its one hard constraint)

`--prebuilt` uploads the artifact, not the source, so **what ships is exactly what
`vite build` produced on your machine** — no second, differently-configured build.
That is also its limitation: a plain CLI `vercel deploy` (no `--prebuilt`) uploads
sources and builds them remotely, and historically that upload carried no
workspace root, so the remote build could not resolve this app's `workspace:*`
dependencies (`@numisma/engine`, `@numisma/event-store`). **That constraint is
specific to the CLI source upload.** The git path clones the whole repo,
including the root `pnpm-workspace.yaml`, and pnpm installs from the workspace
root — verified above. Building at the repo root with `vercel build` is what
keeps the fallback whole: the workspace is present locally, so the artifact is
complete before anything is uploaded.

## Environment variables

The deployed app reads these at runtime (server functions only — no credential
reaches the client bundle, ADR-007 / ADR-009). They are set in the Vercel
project's **Production** environment (`vercel env add <NAME> production`, or the
dashboard). Exactly four, per ADR-007 and the ADR-011 amendment:

| Var | Purpose |
| --- | --- |
| `PROJECTION_DATABASE_URL` | READ-ONLY projection cred (SELECT-only). The dashboard reader. |
| `AUTH_DATABASE_URL` | RW Better Auth DB — a **separate** DB, disjoint from the projection (ADR-008). |
| `BETTER_AUTH_SECRET` | Better Auth signing secret (`openssl rand -base64 32`). |
| `BETTER_AUTH_URL` | The app's public origin (e.g. `https://<your-domain>`), NOT `localhost`. |

**Preview scope holds none of these, on purpose** — see
[Previews are build smoke checks](#previews-are-build-smoke-checks-not-working-apps).

`PROJECTION_WRITE_DATABASE_URL` / `PROJECTION_ADMIN_DATABASE_URL` are **not** part
of the web runtime — they belong to the push shell and one-shot provisioning
(local/operator only), never the deployed app. Keep them out of the web project's
env (ADR-007 split-cred: the running web service holds exactly the RO projection
cred + the RW auth cred, nothing that can write the projection).

## Gotchas

### An env change needs a redeploy to take effect

Vercel injects environment variables at **deploy/build time**, not on every
request against a live deployment. Changing a variable in the Vercel project
(e.g. rotating `BETTER_AUTH_SECRET`, pointing `PROJECTION_DATABASE_URL` at a new
DB, or fixing `BETTER_AUTH_URL`) does **NOT** retroactively update the currently
running deployment. You must **redeploy** for the new value to apply — on the
primary path, push an empty commit to `main` or redeploy from the Vercel
dashboard; on the fallback path, re-run `vercel deploy --prebuilt --prod` (the
prebuilt artifact is unchanged; the redeploy is what re-reads the env). This is
the single most common "I changed it in the dashboard but nothing happened"
trap — the change is staged, not live, until the next deploy.

### The fallback runs from the repo root, not `apps/web/`

**A live trap on this machine, and the reason the fallback was rewritten
2026-07-25.** Root Directory is now `apps/web`, and the CLI resolves it
**relative to the directory you invoke from**. Run the deploy from `apps/web/`
and the CLI composes `apps/web/apps/web`:

```
cd apps/web && vercel deploy --prebuilt
→ Error: The provided path "~/Dev/numisma/apps/web/apps/web" does not exist.
```

This is not a fixable invocation — `--prebuilt` from `apps/web/` cannot work at
all any more, however the artifact was built.

What makes it a trap rather than a typo: **`apps/web/.vercel/` still exists and
still looks like a valid project link.** Every signal says you are in the right
directory, right up until the error. The link that matters now is
`/Users/amet/Dev/numisma/.vercel/project.json`. If you are reading an older doc,
a handoff, or shell history that says "must run from `apps/web/` — the linked
project dir", that instruction is stale and will dead-end you during exactly the
outage this fallback exists for.

### Prebuilt deploys the artifact, not the source

Applies to the fallback path only.

`--prebuilt` uploads whatever is in the root `.vercel/output` **right now**. It
does not build for you. So:

- **Always run `vercel build` immediately before deploying**, after an
  `rm -rf .vercel/output` if in doubt. A stale artifact from an earlier build
  ships silently — `--prebuilt` will happily upload last week's bundle.
- **Run every command from the repo root.** Running the deploy from `apps/web/`
  fails outright — see the entry above.
- The `.vercel/` directories are git-ignored (build output + local project link
  + pulled env). Never commit them; they are regenerated by `vercel link` /
  `vercel pull` / `vercel build`.

### Known wrinkle: lockfile / packageManager drift

Every git build warns:
`Detected pnpm-lock.yaml version 9 generated by pnpm@10.x with
package.json#packageManager pnpm@11.1.2`. **The install succeeds today** — this
is recorded, not a defect to chase. It is a latent trip-wire: if a
frozen-lockfile install is ever enforced (CI flag, Vercel setting, or a pnpm
default change), the drift stops being a warning and starts being a failure.
Regenerating the lockfile under pnpm 11 is the fix when that day comes.

### The old red Production deployments and the 98 stale records stay

The GitHub deployment history carries records from before the git integration,
including a failed ❌ Production entry. They are **kept deliberately** — the
history is wanted. The Preview and Production GitHub environments are not deleted.
Do not treat an old red marker as a live failure; check the Vercel project for
current state.

### Disposability

The deploy introduces no cloud state that can't be regenerated (ADR-007 §8.2):
the projection DB is a re-pushable view (re-projection = `pnpm push`), and the
deployment itself is reproducible either by pushing the commit again or via the
[fallback](#fallback-manual-prebuilt-cli-deploy) (`vercel build` + `vercel deploy
--prebuilt`, **from the repo root**). A lost deployment is re-created by
re-running either path.
