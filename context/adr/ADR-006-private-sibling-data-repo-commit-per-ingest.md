# The private sibling data repository and commit-per-successful-ingest persistence contract

_Made during: MVI — portable-durable-log increment / 2026-07-03 prototype (branch
`feature/portable-durable-log` @ `6b30547`) → AAR → audit → reliable conversion (no
PRD issue yet; ratified at the reliable-conversion gate so the substrate and the
commit-per-ingest contract freeze before a hosted app reads the <fund> repo by path and by
the `head-digest.json` filename)._
_Scope: product_
_Status: accepted (amended 2026-07-30 — see "Amendment: the tracked-file list, and the
membership test that governs it" below)_

The durable log lives in a **dedicated private sibling git repository** — `~/Dev/<fund>`,
the **Log History** — discovered at runtime through a configurable **`NUMISMA_DATA_DIR`**,
and every successful ingest that appends ≥1 event **best-effort auto-commits the durable
text files to that repo** under the operator's own git identity, then best-effort pushes.
The log is git-ignored for privacy in the numisma tree and therefore had *no history and
no backup*; the real threat is not tampering but buggy-but-valid feature code appending a
semantically-wrong event through the honest ingest path, after which the operator cannot
tell *when* the value went wrong or *go back*. Giving the log a versioned,
provenance-stamped history in its own repo makes "locate-when" a one-line `git log` and
"go-back" a `git revert` + re-fold, on the **same substrate a future hosted app will
read**, so no bridge is burned. Per ADR-001 the reusable derivation (`deriveHeadDigest`,
`formatIngestCommitMessage`, the fold) stays pure in `@numisma/engine`; the git-CLI IO —
the `captureIngestCommit` seam wired into `ingestInbox` — is the `@numisma/tui` runtime.

## Considered Options

- **An object store (S3/blob) or a hosted database for the durable log.** Rejected: git
  already gives, for free, the exact primitives this increment needs — line-level
  `git log -p`, `git revert`, provenance in the commit author/message, and a push to an
  off-machine backup — with no query engine, schema, or running service for a single-user,
  local-first, manual-entry fund. An object store buys durability but not the cheap
  locate-when/go-back *history* that is the whole point; a DB reintroduces the migration
  surface ADR-003 already declined. The substrate stays swappable behind the anticipated
  `LogStore` port below.
- **A nested repo inside numisma (repo-in-repo), or the same numisma repo.** Rejected.
  Same-repo would commit plaintext trade data into the *public* code history — the exact
  leak the git-ignore exists to prevent. A `.gitignore`'d repo *nested* in the numisma
  tree (the original design) creates the repo-in-repo problem: two overlapping working
  trees, submodule-or-ignore ambiguity, `git add -A` footguns. A **sibling** repo removes
  both — numisma stays code-only, the <fund> repo is standalone and independently clonable by a
  future hosted surface, and the `NUMISMA_DATA_DIR` config variable (not a folder taxonomy)
  absorbs any future layout change. Validated by the prototype: moving data *out* of the
  tree "removed the repo-in-repo problem entirely."
- **A decoupled batch/cron commit job instead of committing inside the ingest path.**
  Rejected for v1: coupling the commit to the ingest that produced the events is what makes
  the provenance honest — the Head Digest, the verb summary, and the writing-app SHA are
  all in hand at exactly that moment, and a batch job would have to reconstruct "which app
  version wrote which append" after the fact. The coupling adds no new failure mode to
  ingest because the best-effort contract isolates it (the commit can fail entirely and the
  append is still durable). A decoupled job stays available later behind the `LogStore`
  port if push volume ever justifies it.
- **Plaintext blobs in the private repo vs. encrypt-before-commit.** Chosen: **plaintext**,
  with privacy provided by **private-repo access control, not encryption**. The trade-off
  is explicit and sticky — plaintext trade data lives in the <fund> repo's history *permanently*,
  and adding encryption forward does not scrub the past (only a history rewrite would).
  Encryption-at-rest was weighed and deferred as an out-of-scope Non-Goal (grill): it buys
  little for a single-operator private repo already gated by GitHub auth, while costing key
  management and making the `git log -p head-digest.json` locate-when workflow unreadable.
  Recorded here so the default is a decision, not an accident.

## Consequences

- **The `dataDir` resolution rule is an invariant, not a convenience.** The default is
  **absolute and homedir-derived** (`join(homedir(), "Dev", "<fund>", "data")`) — never
  CWD-relative, never a hardcoded `/Users/...` literal — so launchd (which runs with a bare
  CWD and cannot expand `~`) and the interactive TUI resolve the *same* store. A
  `NUMISMA_DATA_DIR` env override **wins over the default in both planes** (the tui
  `event-store.ts` and price-feed `config.ts`), with **identical `~`-expansion** and an
  **unset-only fall-through to the default**: `undefined` means nobody configured the knob,
  so the default answers, but a **set-but-empty or whitespace-only** value is a
  *misconfigured* knob rather than an absent one and is **rejected with a loud error**
  (#348) — accepting it would silently aim every write at the real ledger. A **relative**
  `NUMISMA_DATA_DIR` is a
  footgun — it re-resolves against `process.cwd()`, so two callers with different CWDs would
  split-brain onto two stores — and must be **rejected with a loud error** (require absolute
  or `~`). price-feed and tui must keep agreeing on the sub-paths (`inbox/transactions.json`,
  `prices/`, `genesis.json`, `events.jsonl`); a resolver split here silently breaks ingest.
- **The rule binds every DOOR, not just the env knob, and `~` expands at all of them (#369).**
  The `NUMISMA_DATA_DIR` variable is one of five entry points for a data root; the other four
  are caller-supplied `dataDir` arguments (`resolveEventStorePaths`, `resolvePreferencesPath`,
  `resolveSidecarPath`, `resolvePriceFeedPaths`). Stating the invariant only for the env knob
  left the arguments to four hand-written copies of it, and they drifted: two accepted a bare
  `"data"` and produced `<cwd>/data/…` silently — the exact split-brain this bullet forbids —
  and the five disagreed on `~` three ways (expanded, refused as non-absolute, or turned into
  a directory literally *named* `~`). The predicate is therefore **one shared function**
  (`normalizeDataDirOverride`), and the `undefined` → default arm stays per-door because the
  defaults genuinely differ. **`~` is honored at every door**, not only at the env knob: the
  hazard the rule guards is *CWD-dependence*, and `~/x` has none — it is absolute and
  homedir-derived, which is this bullet's own invariant verbatim. The counter-argument (`~` is
  a shell affordance and `node:path` has no notion of it) loses because an env-only tilde rule
  would need a mode flag on the shared predicate, restoring the per-door divergence the shared
  predicate exists to remove. `~user` is **not** supported syntax and is refused as relative.
  One input→outcome table (`@numisma/engine/testkit`) is run against all five doors, so a
  one-sided edit fails a test rather than reaching production.
- **The best-effort commit contract has three clauses and a fixed ordering.** The append is
  *already durable* (atomic temp-and-rename) before the capture runs; the capture then
  **never throws / never blocks / never corrupts** it. Ordering is fixed: **append →
  Head-Digest write → scoped stage → commit → push**, each step's failure a *terminal
  loud-warn* (not-a-repo, digest-write-fail, staging-fail, commit-refused, push-rejected,
  or a thrown exception all degrade to stderr-warn-and-return). Staging is **scoped**
  (`git add` of the four durable files, **never `git add -A`**). Critically, **never-blocks
  must be a code fact, not an environmental accident**: the git subprocess sets
  `GIT_TERMINAL_PROMPT=0` and a bounded push timeout, so an unsatisfiable credential prompt
  on an interactive TTY (`pnpm spine`) can never hang `spawnSync` — a timeout is one more
  loud-warn downgrade. The hook fires **exactly once per `ingestInbox` that appended
  ≥1 event**; an empty ingest commits nothing.
- **Commit authorship = the operator's git identity, permanently.** No `--author`, no
  `Co-Authored-By` trailer, no tooling attribution of any kind — a permanent invariant, not
  a default. The commit is the operator's record of their own fund; a tool must never write
  itself into that history.
- **The allowlist `.gitignore` polarity is load-bearing.** The <fund> repo tracks exactly the
  four durable text files (`genesis.json`, `events.jsonl`, `preferences.jsonl`,
  `head-digest.json`) — now seven, with `orders.jsonl`, `plans.jsonl` and
  `reconciliations.jsonl`; `prices/`,
  `inbox/`, `ingested/`, `*.tmp`, and `*.quarantine` are
  ignored. The polarity is an *allowlist* (deny-by-default with named exceptions), so the
  disposable, re-fetchable cache is **structurally unable to enter durable history** — a
  stray `prices/foo.json` or `*.tmp` cannot be committed even by mistake, and the scoped
  stage above reinforces the same guarantee from the writer side. _(Amended: the list is
  now seven files — `orders.jsonl` joined it under the amendment below, and
  `plans.jsonl` then `reconciliations.jsonl` followed as the one-line extensions that
  amendment's general membership test provides for.)_
- **The retired in-repo `data/` store is orphaned and must be retired as part of this
  decision.** The flip repointed all code at the <fund> repo but left a full *stale* duplicate
  ledger under `numisma/data/`, which has **already diverged** (on the audit machine:
  `numisma/data/events.jsonl` 41 lines vs. the <fund> repo's 42 lines; `diff -q` differs). Two
  sources of truth for the sacred log cannot coexist — the old tree must be deleted/archived
  (with its now-orphan tracked `data/.gitignore`) and a guard should assert the repo tree
  contains no `data/events.jsonl`. This divergence is the concrete face of the
  "hard-to-reverse" below: the substrate move is *already* partly irreversible.
- **The `LogStore` persistence-policy port is an anticipated ADR-001-style follow-on, not
  built now.** `captureIngestCommit` is the natural *local git-CLI adapter*; it splits
  cleanly into a policy-caller (commit-once-per-ingest, the `formatIngestCommitMessage`
  format, Head-Digest-alongside) and a `LogStore.commit(files, message)` seam that a later
  **GitHub-API adapter** implements when the web surface lands. Extracting the full port
  now is premature abstraction — one runtime, one adapter — and unnecessary because the
  reusable domain logic (`deriveHeadDigest`, `formatIngestCommitMessage`, the fold) is
  *already pure* in `@numisma/engine`, so the later extraction is a mechanical refactor
  behind an unchanged pure core. Recorded here (the ADR-001 realized-note pattern) so it is
  not rediscovered when the hosted surface arrives.
- **But the pure `resolveDataDir(env?)` resolver moves into `@numisma/engine` now.** The
  tui `event-store.ts` and price-feed `config.ts` currently carry the same ~7-line
  env/`~`/`resolve` body, byte-identical in behavior across every env shape, each with a
  "keep in sync" comment — the exact byte-identical duplication ADR-001's realized-note
  (#58) celebrated *removing*, reintroduced, and the highest-severity failure mode for this
  substrate (invisible until a NAV diverges). The resolver is pure string/env computation
  with **no IO**, so it can live in `@numisma/engine` as a single `resolveDataDir(env?)` both
  planes import — exactly as they already share `INBOX_PATH_SEGMENTS` /
  `PRICE_STORE_DIR_SEGMENT` — without violating ADR-001. `resolvePreferencesPath` must route
  through the same resolver (it currently defaults to a bare CWD-relative `"data"`, a third,
  latent copy of the retired location).

### The three SDP tests

- **Hard to reverse.** The substrate move is *already* partly irreversible: the flip left a
  stale in-repo ledger that has diverged from the <fund> repo (above). Once a hosted app reads
  the <fund> repo by path and by the `head-digest.json` filename, the sibling-repo substrate and
  the commit-per-ingest contract are load-bearing — unwinding them means re-migrating the
  sacred log and re-deciding where it lives, a data-model migration, not a code edit.
  Ratified before that reader exists so no later substrate migration is forced.
- **Surprising without context.** A **second** git repository, holding **plaintext trade
  data**, discovered through an **environment variable**, that **auto-commits from inside
  the ingest path** under the operator's identity on every successful append — none of that
  is guessable from the numisma tree, which shows only a git-ignored `data/`. That the
  commit is *best-effort* (an append succeeds even when both the commit and the push fail)
  is likewise non-obvious and must be recorded.
- **A real trade-off.** Four were decided, not defaulted: git-repo vs. object-store vs. DB
  (cheap history + revert vs. a query engine nobody needs); sibling vs. nested vs. same-repo
  (standalone + private vs. repo-in-repo footguns vs. a public-history privacy leak);
  coupled-commit vs. decoupled-batch (honest in-hand provenance vs. after-the-fact
  reconstruction); plaintext vs. encrypt (readable locate-when + access-control privacy vs.
  permanent-plaintext-history exposure).

## Amendment: the tracked-file list, and the membership test that governs it

_Made during: increment one — `Order`, <exchange> ingest, and available capital (spec #163,
slice #164, seam `S4`). The first amendment to the tracked-file list since this ADR was
written._

**`orders.jsonl` joins the allowlist as the fifth tracked file**, alongside
`genesis.json`, `events.jsonl`, `preferences.jsonl` and `head-digest.json`. It is named
in four places, and the ORDER in which they are edited is load-bearing: the <fund>
repo's `.gitignore` allowlist first, then `TRACKED_FILES` (`apps/tui/src/ingest-commit.ts`),
then the daily-fetch explicit-add loop, then the daily-fetch strict post-check
(`git status --porcelain` **without** `--ignored`). Reversed, the post-check reports
clean over a file git is discarding — a **green check over data loss**, strictly worse
than the silence it replaced, because plain `--porcelain` says nothing about an ignored
path even when that path is named explicitly.

**[Corrected in place 2026-08-20 (#398): the four sites are now three.]** The two
daily-fetch sites were two hand-kept literals and they drifted, which is #398: the
explicit-add loop and the strict post-check both now read one `DURABLE_STRICT_FILES`
array declared above step 3 of `ops/price-feed/run-daily-fetch.sh`. The order above
still holds and still matters, with its last two entries collapsed into that one edit:
allowlist, `TRACKED_FILES`, array.

**The membership test is general, and it is stated here once so the list can grow without
a further amendment:**

> **Is this durable, non-re-derivable truth?**

Durable: losing it loses fund history that cannot be reconstructed. Non-re-derivable:
nothing can recompute it from something else that is tracked. Both must hold. A file that
answers yes belongs in the allowlist, in `TRACKED_FILES`, and in the wrapper's
`DURABLE_STRICT_FILES` array (the correction above), as one line in each. (`plans.jsonl` — the operator-authored,
append-only per-position plan sidecar — is exactly such a one-line extension, taken
without a second amendment: it is durable, non-re-derivable truth, and as-of replay
depends on its history. `reconciliations.jsonl` — the trail of what a reader showed the
operator — followed on the same terms, and its right to a place turns on one fact: each
line carries its own copy of the plan values **as shown**, and plan supersession is by
append, so a line dated earlier but appended later changes what re-derivation returns
for a fill already recorded. A past verdict is therefore not recomputable from
`plans.jsonl`, which is what makes the trail truth rather than a cache. The tracked list
is therefore seven: `genesis.json`, `events.jsonl`, `preferences.jsonl`,
`head-digest.json`, `orders.jsonl`, `plans.jsonl`, `reconciliations.jsonl`.)

**The warrant is DURABILITY, not secrecy.** This ADR's own justification for the sibling
repo is that the log had *"no history and no backup"*, leaving the operator unable to tell
*when* a value went wrong or to *go back*. Secrecy appears in this ADR only as a
**rejection criterion** applied to the alternatives — it is why the repo is private and
sibling rather than nested or same-repo; it is never the reason a file is tracked. The
distinction is not academic: asking *"is this sensitive?"* about `orders.jsonl` yields the
answer **don't commit it** — and the file is then written, ignored, and lost. A resting
ladder is at least as revealing as the log it sits beside (ADR-007 bars stop levels from
leaving the machine, and rung prices are that shape); it is tracked **anyway**, because
sensitivity governs *where* the history lives, and durability governs *whether* there is
one.

**This is also why `prices/` stays excluded — not because it is less sensitive.** The
price cache is re-fetchable from the vendor at any time: it fails the *non-re-derivable*
half of the test and would fail it if it were the most secret file in the tree. Likewise
`inbox/`, `ingested/`, `*.tmp` and `*.quarantine` — staging and byproducts, all
reconstructible. The allowlist polarity is what makes the exclusion structural rather
than disciplinary; the membership test is what makes each inclusion arguable.

**The floor is guarded by a test asserting THREE ends**
(`apps/tui/src/durable-log-guards.test.ts`): that git does **not** ignore each durable
file in the <fund> checkout, that `TRACKED_FILES` names exactly that list, **and** that
the wrapper's `DURABLE_STRICT_FILES` names the same list minus `head-digest.json` and is
read by both wrapper consumers rather than re-inlined.
Any end alone is false assurance — an allowlisted file nothing stages is never
committed, a staged file the allowlist omits is discarded, and a file the wrapper omits
survives only on the runs the in-process capture already handled. The guard is written over
the **list**, so each further member costs one line there too. It runs against the real
<fund> repo's checkout when present and skips the allowlist half (never the `TRACKED_FILES`
half) where that private repo is absent.
