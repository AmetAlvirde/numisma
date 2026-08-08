# Durable-log operations (verify, test, reproduce)

The durable ledger — `events.jsonl`, `genesis.json`, `preferences.jsonl`, and the
derived `head-digest.json` breadcrumb — lives in the private sibling repo
**`accumulus`** (`~/Dev/accumulus/data` by default, or wherever `NUMISMA_DATA_DIR`
points). Every successful ingest commits the log + Head Digest under **your own git
identity**, so a bad-but-honest NAV is **locatable** (`git log -p head-digest.json`)
and **reversible** (`git revert` + re-fold). This is the reliable conversion of PRD
#114 (ADR-006 sibling-repo substrate; ADR-003 amendment for the derived Head Digest).

This page is the **verification guide**: how to get the branch, confirm it is green,
and exercise each reliability behavior by hand. It is the companion to two neighbours:

- [`accumulus-restore-runbook.md`](./accumulus-restore-runbook.md) — the shipped
  **restore** procedure (locate → revert vs. checkout → re-fold → push).
- [`price-feed-ops.md`](./price-feed-ops.md) — the daily launchd job, tokens, and
  triage that produce the ingests this ledger versions.

Everything here is machine-local. Nothing secret or trade-derived enters the numisma
checkout (transaction-data-is-private); the durable store is the `accumulus` repo, and
the disposable cache (`prices/`, `inbox/`, `ingested/`) is kept out of history by
`accumulus`'s allowlist `.gitignore`.

## What the reliable cut delivered

| Requirement | Behavior | Where |
| --- | --- | --- |
| R-M1 | The ingest commit **never blocks**: `git()` forces `GIT_TERMINAL_PROMPT=0` and bounded push/commit timeouts; a hang, timeout, or any git failure degrades to one loud stderr warning and returns. | `apps/tui/src/ingest-commit.ts` |
| R-M2 | The orphaned in-repo `data/` ledger is retired; a tree guard asserts no `data/events.jsonl`. | `apps/tui/src/durable-log-guards.test.ts` |
| R-M3 | `resolvePreferencesPath()` resolves under the accumulus default — never a CWD-relative `"data"`. | `packages/preferences/src/preferences.ts` |
| R-M4 | A fresh install's launchd job finds `pnpm` **and** `node`: `~/.asdf/shims` leads PATH, with a loud named error (not a bare exit-127) if either is unresolvable. | `ops/price-feed/run-daily-fetch.sh` |
| R-M5 | `spine:reset` refuses whenever `dataDir` resolves to the accumulus default. | `apps/tui/src/spine-reset.ts` |
| R-M6 | PROTOTYPE banners stripped from shipping engine/runtime durable-log code. | engine + tui |
| R-M7 | `Checkpoint` → `HeadDigest`, `deriveCheckpoint` → `deriveHeadDigest`, `checkpoint.json` → `head-digest.json` (before the filename froze). | engine + tui |
| R-M8 | The restore runbook + repointed `README` / `price-feed-ops` docs. | `docs/` |

The load-bearing invariant behind all of it: **the fold over events is the single
source of truth.** The committed Head Digest is a derived breadcrumb with no engine
reader — nothing folds it back, so it can never become a shadow source of truth.

## 1. Confirm the suite is green

This reliability cut landed on `main` (PRD #114 / ADR-006; the working branch it
shipped on, `feature/portable-durable-log`, is long since merged and deleted — do
not try to check it out). Verify from a current checkout:

```sh
cd ~/Dev/numisma
pnpm install
pnpm typecheck && pnpm test
```

`pnpm test` should report **zero failures**. The suite grows over time, so treat
any specific pass/fail count as a stale snapshot rather than a target — instead
confirm the durable-log reliability tests named throughout this page
(`ingest-commit.test.ts`, `ingest-commit-hardening.test.ts`,
`durable-log-guards.test.ts`, `go-back-invariant.test.ts`, `data-dir.test.ts`,
`preferences-reliable.test.ts`) are present among the passing files. A failure
here means an environment drift — investigate before trusting the manual checks
below.

## 2. The `spine:reset` footgun is structurally safe (R-M5)

With the default `dataDir` resolving to the private `accumulus` repo, an unguarded
`spine:reset` would `rm ~/Dev/accumulus/data/events.jsonl` — the very ledger this
increment protects. The command now **refuses at the default** and only proceeds
against an explicit throwaway dir:

```sh
pnpm spine:reset
# ⚠️ spine:reset refused: dataDir resolves to the default accumulus ledger (…)
#    This command deletes events.jsonl and must NEVER touch the durable log.
# → exits 1, deletes nothing

NUMISMA_DATA_DIR=/tmp/throwaway pnpm spine:reset   # only an explicit non-default dir proceeds
```

The guard compares the resolved `dataDir` against `resolveDataDir({})` (the accumulus
default computed with an empty env), so it refuses whether the default was reached
implicitly (env unset) **or** by an explicit `NUMISMA_DATA_DIR` pointed at accumulus.

## 3. One resolver, one knob (R-M3, the unified `resolveDataDir`)

The `NUMISMA_DATA_DIR` env var is the **single** knob that moves every plane (the tui
event-store, the price-feed config, and the preferences sidecar). The resolution rule
lives once, pure and IO-free, in `@numisma/engine` (`packages/engine/src/data-dir.ts`):

- unset / empty / whitespace → the accumulus default (`~/Dev/accumulus/data`);
- `~` or `~/…` → `~`-expanded against `homedir()`, then made absolute;
- an absolute path → normalized;
- a **relative** path → **rejected loudly** (a relative value would resolve
  differently for `pnpm prices:fetch` at the repo root vs. a package's own script).

```sh
NUMISMA_DATA_DIR=data pnpm report
# → throws: NUMISMA_DATA_DIR must be an absolute path or start with "~/" (got "data"). …

NUMISMA_DATA_DIR=~/Dev/accumulus/data pnpm report   # ~ expands; every plane resolves the same store
```

The default is **absolute and homedir-derived** — never CWD-relative, never a hardcoded
`/Users/...` literal — so the launchd job (bare, non-login CWD) and your interactive TUI
resolve the identical store. The plist carries an **absolute** `NUMISMA_DATA_DIR`
because launchd cannot expand `~` (see `price-feed-ops.md` step 3).

## 4. Locate-when and go-back (the reason the increment exists)

Every ingest commit pins the NAV and the writing app version, so the Head Digest's git
history *is* the NAV-over-time timeline. In the accumulus checkout:

```sh
cd ~/Dev/accumulus
git log -p -- data/head-digest.json      # find the commit where fundValueUsd jumps wrong
# read headEventId, the numisma-version: trailer, and asOf from the same diff
git revert --no-edit <bad-sha>           # invert the bad append (history stays honest)
cd ~/Dev/numisma
NUMISMA_DATA_DIR=~/Dev/accumulus/data pnpm report   # re-fold re-derives the correct NAV
```

The full decision tree — `revert` vs. surgical `checkout`, conflict handling, push, and
the real-scheduled-run confirmation — is in
[`accumulus-restore-runbook.md`](./accumulus-restore-runbook.md). Do not edit
`head-digest.json` by hand: trust the fold, not the file.

## 5. Fresh-install launchd PATH fix (R-M4)

launchd starts the job with a bare non-login PATH that excludes both `pnpm` and (when
`node` is asdf-managed) the `~/.asdf/shims` directory `node` lives behind — either
produces the **same exit-127 node-not-found** hazard. The wrapper's default
`NUMISMA_PATH_PREPEND` now puts the shims dir **first**:

```sh
$HOME/.asdf/shims:$HOME/Library/pnpm:/opt/homebrew/bin:/usr/local/bin
```

If `pnpm` or `node` still cannot be found, the wrapper fails with a **loud named error**
telling you which override to set — not a bare 127. Kick a real run and read the log:

```sh
launchctl kickstart -k gui/$(id -u)/com.numisma.pricefeed.daily
tail -n 40 ~/Library/Logs/numisma/price-feed-*.log
```

See `price-feed-ops.md` ("PATH: the scheduler must be able to find `pnpm` **and**
`node`") for the full PATH rationale and overrides.

## What is automated vs. manual

**Automated (in the green suite)** — the safety net is tested, not just claimed:

- End-to-end hook-wiring: `ingestInbox` against a temp **git-repo** dataDir lands a
  commit with `head-digest.json` staged, the deterministic message, and
  `headEventId === last appended id` (`ingest-capture-wiring.test.ts`).
- Append-survives-capture-failure; the five downgrades (not-a-repo, staging-failure,
  commit-refused, thrown, **push-timeout**) each degrade without throwing or blocking
  (`ingest-commit-hardening.test.ts`).
- The byte-identical anti-drift lock
  `deriveHeadDigest(folded).fundValueUsd === buildCompositionReport(folded).totals.fundValueUsd`,
  with a non-round-float tripwire that fails if anyone inserts a `toFixed`/round
  (`durable-log.test.ts`).
- The **go-back invariant**: after `git revert` + re-fold, the re-derived Head Digest
  equals the pre-bad Head Digest (`go-back-invariant.test.ts`).
- No tooling attribution: the commit author is the operator's git identity, enforced by
  test even when `GIT_AUTHOR_*` is set in the env.
- The shared-resolver contract/drift test and the `resolvePreferencesPath` regression
  (`data-dir.test.ts`, `preferences-reliable.test.ts`).

**Manual / runbook (CI cannot reproduce the environment)**:

- **launchd non-interactive push auth** (osxkeychain binary-identity ACL) — verified
  2026-07-07; confirm with the `launchctl kickstart` recipe above and in the restore
  runbook. The *degradation* (push fails → loud warn, append durable) is automated; only
  the *trigger* is environmental.
- **Locked-keychain / locked-session at fire time** — a login-keychain state no CI
  reproduces; a runbook caveat, not a code path.

## Notes

- `openPositionCount` counts **all logged open positions incl. non-live**, while
  `fundValueUsd` reflects only the valued/live population — documented divergence (PRD
  D1). `fundValueUsd` is the load-bearing anti-drift number; `openPositionCount` is a
  debugging breadcrumb ("positions on the book").
- Restore ships **runbook-first** — there is intentionally no `pnpm data:restore`
  wrapper (deferred until a second failure shape demands it).
- Privacy is **private-repo access control, not encryption**: plaintext blobs live in
  `accumulus` history by design (ADR-006). Encrypting forward cannot scrub the plaintext
  already in history.
