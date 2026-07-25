# Single-tenant hosted security posture

_Made during: MVI — hosted security pass (`~/Dev/notes/numisma/2026-07-24-hosted-security-pass-grill.md`), the operational-hardening follow-on ADR-007 explicitly gated ("the concrete pre-deploy security controls … are a **required follow-on this ADR gates**"). Also resolves the "N/A until a hosted surface exists" deferral parked in `2026-07-03-credentials-secrets-grill`, since that surface now exists._
_Scope: product_
_Status: accepted_

ADR-007 ratified the hosted-projection regime and gated real fund data on a
dedicated security pass. This ADR is that pass's record. Most of what the pass
settled is implementation detail (encryption-at-rest is a ratified provider
default; Vercel env as the secret home reapplies prior logic from the
credentials grill; session length is tuning) and lives in code comments and
`docs/hosted-cutover-runbook.md`, not here. Two decisions earn an ADR because
they pass all three SDP tests and share a property: **a competent future
reader will try to fix them.** Supporting posture — obscurity is not sized as
a control, rate limiting is DB-backed rather than in-memory, and secret
rotation is trigger-based rather than calendar-based — is folded into the same
document because it shapes the same threat model.

The control-setting adversary throughout is **untargeted automation** —
scanners and credential-stuffing runs against `*.vercel.app` — the one that
will certainly arrive, not a targeted attacker. The system is **single-tenant,
single-account**: exactly one operator, exactly one seeded login, no
onboarding, no second tenant.

## Considered Options

- **Lock the account after N failed sign-in attempts (REJECTED).** The
  standard control for a public login form. Rejected because this product
  admits exactly one account: lockout hands any anonymous attacker on the
  internet a permanent denial of the fund view — five wrong guesses and the
  owner's only remedy is direct database surgery. **Lockout converts a failed
  attack into a successful one.** Chosen instead: window-based rate limiting
  that degrades attacker throughput without ever fully closing the owner's
  door (see Consequences, D5).
- **No spend limit; let usage-based billing run (REJECTED).** ADR-007 bounded
  what an attacker could *learn* and never what they could *cost*. Sustained
  attack traffic against a DB-backed rate limiter writes to Neon on every
  attempt, including rejected ones, and nothing sat between that traffic and
  the plan's billing behavior. Rejected in favor of an explicit spend
  threshold that trades availability for cost predictability (see
  Consequences, D6).
- **In-memory rate-limit storage (REJECTED).** Better Auth's default. On
  Vercel this is close to worthless: each serverless instance holds its own
  counter, instances scale out and recycle, and an attacker distributed
  across cold starts gets a fresh budget every time. The dangerous property is
  that `rateLimit: { enabled: true }` alone *looks* finished, passes review,
  and ships a control that silently does not work. Chosen instead:
  `storage: "database"`, persisting the counter into `numisma_auth` so it is
  shared across every instance.
- **TOTP or a passkey now (DEFERRED, not rejected outright).** A manager-
  generated unique password is in no breach dump, which is what the
  untargeted-stuffing adversary needs defeated. TOTP taxes every mobile login
  for marginal gain over that, against a derived, read-only asset whose blast
  radius is already accepted. Passkey is genuinely better — and more
  convenient on a phone — but costs a Better Auth plugin, an auth-schema
  migration, and a registration ceremony: a feature increment wearing a
  security pass's clothes. **Named triggers:** the URL is actually linked
  publicly (e.g. from a CV), or a second operator appears.
- **Pro-tier edge WAF / rate limiting now (DEFERRED, not rejected
  outright).** The project is on Vercel's Hobby plan; IP-bypass/WAF and
  edge-level rate limiting are unavailable on it. Vercel's automatic DDoS
  mitigation runs on every plan, so volumetric floods are already handled;
  what remains is slow, patient credential stuffing, which is low-RPS by
  nature and is stopped at the app layer by D5. $20/mo to move a working
  control to the edge is not yet worth it. **Named triggers:** sustained
  attack traffic observed in logs, or a second tenant.
- **A dedicated secret manager (KMS / Doppler) now (DEFERRED, not rejected
  outright).** Vercel env is already encrypted and is already the deploy-time
  source of truth; a second system buys a second thing to secure and to be
  locked out of, for one operator and five secrets. Same logic the
  credentials grill already applied to Keychain (a non-interactive job
  blocking on an unlock trades reliability for encryption against a thin
  threat). **Named trigger:** a second operator.
- **Calendar-based secret rotation (REJECTED).** Rotating four DB URLs and
  `BETTER_AUTH_SECRET` on a quarterly schedule for a single-operator app
  reliably produces one thing: a day the fund view is down while the operator
  debugs their own rotation. Chosen instead: rotation fires on events that
  change who could have seen a secret (see Consequences, D9).

## Consequences

- **No lockout, deliberately (D5).** With exactly one account, lockout is a
  gift to the anonymous attacker it was meant to stop. The reasoning that
  makes the absence correct is invisible in the code and holds **only
  because the system is single-tenant** — if a second tenant is ever added,
  this must be revisited. Rate limiting (`storage: "database"`, a 60-req/min
  global floor, a tighter `/sign-in/email` rule of 10 attempts per 5
  minutes) degrades attacker throughput without ever fully closing the
  owner's door. `apps/web/src/lib/auth.ts` carries this reasoning inline so
  the "why is there no lockout" question is answered where the config is
  read, not only here.
- **Cost over availability, explicitly (D6).** A spend threshold
  (`vercel integration-resource create-threshold`) means sustained attack
  traffic does not run up a bill — it **suspends the database**, taking the
  fund view offline. This was chosen deliberately: *"I prefer non
  availability over surprising bills."* An outage is noticed and actionable
  the moment it happens; an invoice is discovered a month later, after the
  damage is already done. **This must be written plainly enough that a
  future outage triggered by the threshold is verified against the runbook
  (`docs/hosted-cutover-runbook.md`) before it is treated as a defect, and
  the natural "fix" — raising the cap — is understood as reversing a
  deliberate decision, not correcting a bug.** It also pairs with D5's
  Pro-tier deferral: a threshold-triggered outage is a clear, actionable
  trigger for that upgrade; a slowly climbing bill is not.
- **Obscurity is not sized as a control (D1).** Controls here are sized for a
  publicly-linked URL, not a hidden one. The career-portfolio driver behind
  this project gives obscurity a scheduled expiry date: a URL linked from a
  CV is a URL that is known. Any control that depended on "nobody knows the
  address" would silently expire the day the address is first shared, so
  none does.
- **Production stays publicly reachable; previews get Vercel Deployment
  Protection (D2).** Two auth systems in series fails exactly when the
  feature they'd protect — phone access away from the desk — is exercised: a
  bad signal (expired Vercel session) blocking a good one (a valid Better
  Auth session). It would also couple fund availability to the same Vercel
  account that holds all five app secrets, so one compromise takes both door
  and keys, and it would hollow out the portfolio-visibility driver. The
  five app secrets (`BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`,
  `AUTH_DATABASE_URL`, `PROJECTION_DATABASE_URL`,
  `PROJECTION_WRITE_DATABASE_URL`) are scoped Production-only and verified
  unresolvable on Preview, so the protection spend goes where it is needed:
  the auto-generated preview URLs built from code that reads
  `PROJECTION_DATABASE_URL`, which nobody watches.
- **Rate limiting is DB-backed, not in-memory (D5).** See Considered Options.
  The accepted cost — every auth attempt, including rejected ones, writes to
  `numisma_auth` — is bounded by D6's spend threshold rather than left open.
- **Rotation is trigger-based, never calendar-based (D9).** `neondb_owner`
  rotates once, mandatorily, after the Neon auto-injected owner-credential
  set is removed from Vercel env (a bypass of the structural one-way
  guarantee this ADR's parent leans on hardest — see
  `docs/hosted-cutover-runbook.md` step 2). Beyond that, a secret rotates
  when an event changes who could have seen it: any secret after a
  `vercel env pull` lands on a machine no longer trusted; all of them on
  Vercel account compromise; the push credential on Mac compromise.
  Rotating `BETTER_AUTH_SECRET` invalidates every session — a feature, not a
  side effect, and the second half of the session-revocation lever the
  runbook documents.
- **The named deferrals stay decisions, not omissions.** Passkey upgrade,
  Pro-tier edge WAF, and a dedicated secret manager are each deferred with a
  named trigger above, not left as unconsidered gaps. When a trigger fires,
  the increment is scoped and known in advance.

### The three SDP tests

- **Hard to reverse.** Once rate limiting is live and the spend threshold is
  set, a future "fix" for either — adding lockout, or raising the spend cap
  to silence an outage — is not a local code edit but a reversal of a
  deliberate trade-off made against a specific threat model. Both are cheap
  to *change* in code and expensive to change *correctly* without first
  re-reading why they were set this way, which is exactly what this ADR
  exists to prevent someone from skipping.
- **Surprising without context.** The absence of lockout looks like an
  oversight on every standard checklist; the presence of a threshold that
  takes the fund view offline under attack looks like a misconfiguration at
  2am. Neither is guessable from the code or the outage alone — both require
  the single-tenant framing and the operator's explicit cost-over-
  availability preference to read as correct rather than broken.
- **A real trade-off.** Lockout (closes the door on an attacker, but also on
  the owner) vs. rate limiting alone (never fully closes the door, but never
  hands it away either) was a genuine choice, not a default. Cost cap
  (bounded spend, but an outage on attack) vs. no cap (always available, but
  an unbounded bill) was chosen explicitly by the operator, against the
  instinctive default of "keep it up at any cost."
