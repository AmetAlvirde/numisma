# Restoring the durable data repository: locate and reverse a bad NAV

The durable ledger lives in the private sibling repo **`<fund>`** (`~/Dev/<fund>`
by default, or wherever `NUMISMA_DATA_DIR` points — see
[`price-feed-ops.md`](./price-feed-ops.md) and the README "Local data" section). Every
successful ingest commits `events.jsonl` + `head-digest.json` under **your own git
identity**, so a bad value is both **locatable** and **reversible** with plain git — no
bisect, no restore wrapper.

Throughout this page, `<fund>` stands for your own private data repository — the same
convention as `<dataDir>` — so substitute your actual repo name/path before running
any command below.

This is the **shipped restore mechanism** (a deliberate runbook-first decision, PRD
#114). There is intentionally **no `pnpm data:restore` command**: the git primitives
below are sufficient, and a wrapper is deferred until a second failure shape demands it.

## The threat this reverses

Not tampering — **buggy-but-honest feature code appending a structurally-valid,
semantically-wrong event** through the sanctioned ingest path. The reproduced failure: a
wrong btc mark (+44%, inside the ±50% magnitude guard, so legitimately appended) drove
NAV from \$19,760.70 to \$22,863.31 and no validation layer caught it. Once such an
append lands, this runbook answers the two questions the operator otherwise cannot
answer cheaply: **when** did the value go wrong, and how do I **go back**.

The load-bearing invariant behind every step: **the fold over events is the single
source of truth.** The committed **Head Digest** (`head-digest.json`) is only a derived
breadcrumb that makes the search cheap — nothing folds it back, so it can never become a
shadow source of truth. After you revert, `pnpm report` re-derives the correct NAV from
the surviving events; you never edit the Head Digest by hand.

## 0. Confirm the store you are operating on

```sh
# The <fund> checkout (adjust if NUMISMA_DATA_DIR is set to something else).
cd ~/Dev/<fund>
echo "NUMISMA_DATA_DIR=${NUMISMA_DATA_DIR:-<unset → ~/Dev/<fund>/data default>}"
git status          # expect a clean tree before you start
```

Everything below runs **inside the `<fund>` checkout**, not the numisma repo.

## 1. Locate — pin the NAV jump to one commit

The Head Digest carries `fundValueUsd` and the writing app version, and it is committed
on every ingest, so its history *is* the NAV-over-time timeline:

```sh
git log -p -- data/head-digest.json
```

Read down the diffs until you find the commit where `fundValueUsd` jumps to the wrong
value. In that same diff note:

- the **`headEventId`** — the event id the bad value was folded through;
- the **`numisma-version:` trailer** in the commit message (and `appVersion` in the
  digest) — the exact numisma code that wrote it, so you can tell whether a code bug or a
  data slip introduced the value;
- the **`asOf`** — the mark date the bad value applies to.

Copy the **bad commit's SHA**. To see the offending event line itself:

```sh
git show <bad-sha> -- data/events.jsonl      # the appended line(s) in that ingest
```

## 2. Read the diff — decide revert vs. checkout

Two go-back shapes; pick by what the bad commit contains:

- **`git revert` (default, preferred).** Use when the bad ingest is a **discrete commit**
  whose entire event append should be undone. `revert` writes a *new* commit that inverts
  the bad one, so the history stays honest and append-only (the bad commit is still
  visible, now paired with its reversal) — the right choice for a shared/pushed ledger.

- **`git checkout <good-sha> -- data/events.jsonl` (surgical).** Use only when a single
  ingest bundled **several events and you must keep some**: check the good version of just
  the log file out of an earlier commit, hand-remove only the bad line, and re-commit. This
  rewrites the file rather than inverting a commit — reserve it for the mixed-batch case.

In the common single-bad-append case, **prefer `revert`.**

## 3. Go back — revert the bad commit

```sh
git revert --no-edit <bad-sha>
```

This removes the bad event line from `data/events.jsonl` and restores
`data/head-digest.json` to its pre-bad content in a new reversing commit. If the bad
ingest was not the tip, git may report a conflict on `events.jsonl` (an append after it);
resolve by keeping every surviving line **except** the reverted one, then
`git revert --continue`.

**The daily wrapper's commit is per-run, not per-file.** `run-daily-fetch.sh` stages
and commits every tracked sidecar that changed in the same commit as the price marks
(`events.jsonl`, `genesis.json`, `preferences.jsonl`, `orders.jsonl`) — whatever
changed that run rides in together. If an `orders:import` or a preferences change
landed the same day as the bad mark, `git revert` on that commit undoes **all of
it**, not just the price mark: the `OrderRecord`s and any preferences edits from that
run disappear too, silently — no skip, no warning, nothing in `available-capital`
naming what left. Before reverting, run `git show <bad-sha> --stat` and read the diff
of every changed file, not just `events.jsonl`; if the commit also touched
`orders.jsonl` or `preferences.jsonl`, either accept losing those changes or use the
surgical `checkout` alternative below to keep them and hand-remove only the bad
event line.

(Surgical alternative for a mixed batch: `git checkout <good-sha> -- data/events.jsonl`,
delete only the bad line in your editor, `git add data/events.jsonl`.)

## 4. Re-fold — let the events re-derive the truth

The revert already restored the Head Digest, but **trust the fold, not the file**.
Re-derive the read model from the surviving events and confirm the NAV is correct again:

```sh
# From the numisma checkout, pointed at this <fund> store:
cd ~/Dev/numisma
NUMISMA_DATA_DIR=~/Dev/<fund>/data pnpm report
```

Confirm `fundValueUsd` matches the known-good value from step 1 (the value *before* the
bad commit). Because the Head Digest is derived from exactly this fold, the re-derived
digest equals the reverted one — the **go-back invariant**, locked as an automated test
(`apps/tui/src/go-back-invariant.test.ts`): after `git revert` + re-fold, the
re-derived Head Digest equals the pre-bad Head Digest.

## 5. Push — publish the reversal

```sh
cd ~/Dev/<fund>
git push
```

If the push is rejected (unreachable remote, locked keychain, missing credential), the
reversal is still **durable locally** — push again once connectivity/credentials are
restored. (The daily ingest hook degrades the same way: a failed push is a loud warning,
never a lost append.)

## 6. Verify — a real scheduled run still lands cleanly

The launchd non-interactive push path (osxkeychain binary-identity ACL) cannot be
reproduced in CI, so confirm it by kicking the real job and reading its log:

```sh
launchctl kickstart -k gui/$(id -u)/com.numisma.pricefeed.daily
tail -n 40 ~/Library/Logs/numisma/price-feed-*.log
```

Confirm the run fetches, ingests through the unchanged spine guard, and (in the `<fund>`
checkout) lands a fresh ingest commit whose Head Digest shows the **corrected** NAV. A
clean run here proves the store is healthy and the hands-off path is unblocked again.

### When the push auth is the thing that is broken

The non-interactive push credential (osxkeychain binary-identity ACL) and the
locked-keychain-at-fire-time trigger are **environmental state, not code** — they stay
manual/runbook (they were last verified 2026-07-07). If the scheduled push fails while a
manual `git push` from your interactive shell succeeds, the ACL/keychain is the culprit:
re-authorize the credential helper for the launchd binary identity and unlock the login
keychain, then re-run the `launchctl kickstart` check above.
