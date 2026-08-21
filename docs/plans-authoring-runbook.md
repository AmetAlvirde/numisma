# Authoring a plan line: `plans.jsonl` by hand

A **plan** is your durable declaration of intent for one position: *this position is a
four-rung ladder*, *this position buys \$25 weekly*, *this position is done*. It lives
in `data/plans.jsonl` in the private sibling repo **`<fund>`** (`~/Dev/<fund>/data` by
default, or wherever `NUMISMA_DATA_DIR` points), beside the event log and the other
sidecars — durable, append-only, git-versioned, and **never folded**. Nothing you write
here can move NAV.

Throughout this page, `<fund>` stands for your own private data repository — the same
convention as `<dataDir>` — so substitute your actual repo name/path before running any
command below. Every figure on this page is **synthetic**; no real position, price or
size appears in the numisma checkout.

**The file is authored by hand, by you.** Agents never write it and never touch the
`<fund>` checkout. `pnpm plans` never appends a plan line and never touches git; it
reads and reports. It is not write-free, though, and the exception belongs to the
event log rather than to this file. See the first note at the foot of this page.

This page is the companion to three neighbours:
[`durable-log-ops.md`](./durable-log-ops.md) (the durable-file floor these lines rely
on), [`accumulus-restore-runbook.md`](./accumulus-restore-runbook.md) (going back when
a committed value is wrong), and [`local-data.md`](./local-data.md) (where the store
lives).

## Why the file needs a runbook at all

The durability chain proves a file is **committed**. It never proves the file **parses**,
which position a line attributed to, or which state it resolves to today. A plausible
stamp like `"08/10/2026"` is accepted by your editor, commits green, and — section 3
works this through — sorts *ahead of every ISO date in the file*. Nothing in the daily
run would tell you. `pnpm plans` is what tells you, at the desk, in one command.

## 0. Precondition: the durable-file floor

A new durable file in `<fund>` is **silently ephemeral** until the allowlist names it.
`plans.jsonl` was added to all three links of that chain (spec #267, slice 1), but the
first link lives in the `<fund>` checkout's own `.gitignore`, which is not in this
repository — so confirm it before you author anything:

```sh
cd ~/Dev/<fund>
git check-ignore -q --no-index -- data/plans.jsonl ; echo "ignored=$?"   # expect ignored=1
```

**The path is `data/plans.jsonl`, and the prefix is load-bearing.** The allowlist entry is
`!/data/plans.jsonl`, anchored at the repo root; a bare `plans.jsonl` evaluated from the
root matches nothing and falls through to the leading `*`, so it reports `ignored=0` on a
checkout that is *correctly* allowlisted. Ask about the path git will actually see.

`1` means git does **not** ignore it — the answer you want. A `0` means the allowlist is
still discarding the file, and every line you author would be written, ignored, and lost
with a green check over the loss. Add the `plans.jsonl` allowlist entry beside the other
durable files first, then re-run the check.

The other two links are code and are guarded by test
(`apps/tui/src/durable-log-guards.test.ts` asserts **three ends**: not `check-ignore`'d,
named in `TRACKED_FILES`, and named in the daily wrapper's `DURABLE_STRICT_FILES`). Run
`pnpm test` and confirm that file is green before you
trust the file to survive.

`data/reconciliations.jsonl` is on the same floor and needs the same allowlist entry.
Section 5a reads it; `pnpm orders:fill` writes it, and you never do. Run the
`check-ignore` above against it too while you are in the `<fund>` checkout.

## 1. The envelope

One JSON object per line, newline-terminated, appended and never edited. Three fields
are required on **every** line, whatever the kind:

| Field | Meaning |
| --- | --- |
| `kind` | `dcaLadder`, `dcaTime`, or `noPlan` (the terminator). |
| `positionId` | The position this plan is about. **Not validated against the fold.** |
| `effectiveAt` | The date this plan takes effect. Strict `YYYY-MM-DD` — see section 3. |

**A plan naming a position that does not exist yet is legal, and is the normal case.**
Declaring the ladder a position is *going to become* is precisely the fact you are
authoring; the position is born later, when the first fill lands. Until then the desk
renders that row `pending` — never `$0`. Zero is a measurement; pending is the absence of
one.

Identity for `dcaTime` and `noPlan` lines is `positionId` + `effectiveAt`; neither carries
an `id` field, and there is no line number in the file for either — line numbers are
read-side only, stamped by the loader so a diagnostic can tell you where to look.

A `dcaLadder` line is the one exception: it also carries its own **required** `id`,
covered in section 2.

## 2. The two kinds, worked

**A ladder** — resting rungs declared as one plan, which is the fact the orders sidecar
structurally cannot carry (it holds no `positionId` and no ladder id). Because that ladder
id is what a fill later points back at, the line declaring the ladder must carry one
itself: `id` is **required**, a UUID, non-empty, and unique across every `dcaLadder` line
in the file — the loader refuses the line otherwise, and refuses a second line that
repeats an id already claimed by an earlier, readable line. Generate one with `uuidgen`
at the shell, or `crypto.randomUUID()` from a Node/Bun REPL — never author one by hand;
it is a join key, not a label (see `packages/engine/src/plans.ts`'s note on why a UUID
and not an authored slug). (Don't confuse this `id` with `planId`, which is the name of
the *foreign* key that `OrderPlacedRecord` and `DcaPositionRow` use to point back at this
ladder — the ladder's own identity field is `id`.)

`tierOrder` is the order capital is drawn down in; it is closed and strict (`c1`, `c2`,
`c3`), non-empty, no repeats. Every rung needs a distinct `id` and a finite, positive
`priceUsd` and `sizeUsd`.

```json
{"kind":"dcaLadder","id":"3f1b7b9e-6c2a-4e3f-9d5a-2b7c8e1a4f60","positionId":"pos-demo-001","effectiveAt":"2026-08-10","tierOrder":["c1","c2"],"rungs":[{"id":"r1","priceUsd":90000,"sizeUsd":250},{"id":"r2","priceUsd":85000,"sizeUsd":250},{"id":"r3","priceUsd":80000,"sizeUsd":250},{"id":"r4","priceUsd":75000,"sizeUsd":250}]}
```

**A time plan** — buy `amountUsd` every `cadence` (`daily`, `weekly`, `monthly`).
`anchorAt` is the **cadence anchor**, not a first-buy date: `weekly` alone does not say
which weekday, and the anchor fixes the phase. An anchor in the past is normal after your
first supersession.

```json
{"kind":"dcaTime","positionId":"pos-demo-002","effectiveAt":"2026-08-10","cadence":"weekly","anchorAt":"2026-08-03","amountUsd":25,"tierOrder":["c1"]}
```

**The terminator** — this plan is over. `reason` is optional free prose for your own
record; it is never parsed and never rendered as fact.

```json
{"kind":"noPlan","positionId":"pos-demo-001","effectiveAt":"2026-09-01","reason":"ladder filled out"}
```

## 3. The date format is strict, and here is the trap it closes

`effectiveAt` must be `YYYY-MM-DD` **and a real calendar date**. This is the file
format's own rule, not a style preference, because **selection is string comparison**:
the desk picks the latest `effectiveAt` at or before the query date by comparing the
strings directly.

Work the trap through. Suppose you superseded a ladder on the 10th of August and typed
the date the way you say it out loud:

```json
{"kind":"dcaLadder","positionId":"pos-demo-001","effectiveAt":"2026-08-01", …}
{"kind":"dcaLadder","positionId":"pos-demo-001","effectiveAt":"08/10/2026", …}
```

`"08/10/2026"` starts with `"0"`; every ISO date in the file starts with `"1"` or `"2"`.
Under string comparison the *newer* line therefore sorts **below** the older one — behind
every date the file will ever hold. Ask the desk for today and the selection returns the
**August 1st ladder**: no throw, no warning, a perfectly plausible wrong answer that
would have been committed green by the daily run. `Date.parse` accepts that string
happily, which is exactly why a parse-based check would not have saved you.

The same reasoning rejects `"2026-02-30"`: `Date.parse` succeeds by rolling it over to
March 2nd, so a shape-only check would accept a string that **sorts as February and means
March**. The loader re-renders the date and compares it back, so a genuine end-of-month
date like `"2026-01-31"` passes and the overflow does not.

**What you actually see today.** Because the rule is enforced at load, the bad line above
is not selected — it is **skipped**, and because it is the newest thing known about that
position, `pnpm plans` renders the row `unreadable` and exits non-zero. That is the
designed outcome: an unreadable row and a failing exit code, never a confident wrong
ladder. Fix it by appending a corrected line (section 4).

## 4. Editing is supersession. There is no edit and no delete

To change a plan, **append a new line** for the same `positionId` with a later
`effectiveAt`. The later line wins; two lines sharing a date are broken by file order,
last one wins. Never go back and modify a line you have already committed — as-of replay
reads this file as history, and rewriting history changes answers to questions that were
already asked.

To stop a plan, append the `noPlan` terminator. **Pause and end are the same act**:
resumption is simply a later plan line. Without a terminator the last plan stays in force
forever, because selection is "latest line at or before the query date" and an absence is
not an ending.

Append with your editor, or from the shell:

```sh
cd ~/Dev/<fund>
$EDITOR data/plans.jsonl        # one object per line, newline at the end of the file
```

## 5. Verify — the rendered row and the exit code

**Reading the warnings is not the verification step.** A loud warning printed into a
launchd log reaches no one; that is the whole reason the desk command carries an exit
code. Verify these two things, in this order.

### 5a. The row renders as you authored it, and the command exits 0

```sh
cd ~/Dev/numisma
pnpm plans ; echo "EXIT=$?"
```

The page opens with the two paths it read, `Plans — …` and `Trail — …`, and the
date it read them at. With no `--as-of` that date is **today in the fund's own
trading-day timezone**, never the machine's idea of a date.

Read the row for the position you just authored and confirm four facts:

- **the state** — `pending` for a position not yet born (declared, not yet realized),
  `active` once it exists on the book, `ended` after a terminator, `none` when no line is
  in force at this date, and `unreadable` when the newest line for it could not be read;
- **the `effectiveAt` that was selected** — it must be the date you authored, not an
  earlier one. A different date here is the section 3 trap, or a supersession that did not
  win;
- **the body** — the rung count for a ladder, the cadence and anchor for a time plan;
- **the trail marker, on an `active` row only.** The command also reads
  `reconciliations.jsonl`, the trail `pnpm orders:fill` appends a verdict to, so an
  `active` row can say whether its most recent fill agreed with the plan. A clean
  verdict prints **nothing extra**, and it may do so only because every other outcome
  prints an explicit qualifier: `!! FILL <date> DISAGREED` naming the mismatch kinds, or
  one of four `??` qualifiers saying why the answer is unknown (no trail file, no line
  for this position, an unreadable trail line, or a fill recorded while the sidecar
  itself was unreadable). A bare `active` row therefore means *checked and clean*, not
  *not checked*. Markers carry no figures, only a kind and the fill's own date.
  `pending` rows are deliberately unmarked: a position that does not exist has no fills,
  and a `no-line` qualifier on every pending row is the noise that stops a marker being
  read.

Then confirm **`EXIT=0`**. The contract is exact and one-directional, and it now spans
**both** files: the command exits `0` **only if** each file was read and **every** line
in it was readable. Any skipped line in either exits non-zero after printing the
diagnostics, which name the line number, the bucket, and what to do — a corrupt line
(append a corrected one) against a line this checkout is too old to understand (pull and
retry). Both files' diagnostics land in the one block, under one heading, so a trail
message cannot hide behind a section you did not scroll to. The diagnostics never quote
the line itself, because plan bodies carry your figures; go and read line *N* in your
editor.

An **absent** trail is deliberately not a failure. Before your first recorded fill its
absence is the normal state, and a daily non-zero there would cry wolf. The `?? NO
TRAIL` qualifier on the row is how that case is said instead.

Two counts sit below the rows and are reported separately on purpose: `unattributable
line(s)` for the sidecar and `unattributable trail line(s)` for the trail. Each is a
line too broken to name a position at all, so it belongs to no row; the two are never
summed, because a plans typo and a torn machine write are different repairs.

**Do not read a non-zero exit backwards.** It does not mean your plan line is bad. The
command also exits `1` when it cannot read the *event log* — a quarantined log line, or an
`--as-of` earlier than genesis — and in that case it never reached the sidecar and printed
no plans diagnostics at all. So read the output, not just the code: **no diagnostics block
means the failure was upstream of `plans.jsonl`**, and `pnpm spine` is where to look.

A third kind of line can appear on stderr before the page, and it is neither of the
above: the **fold's discards**, every event the fold read and could not apply, named
one per line. It is printed here because born-ness is derived from that fold, so a
dropped `PositionOpened` or `PositionClosed` can move a row's state. It **never** moves
the exit code: the log is append-only, so a discard does not extinguish, and this code is
the plans report's own verdict.

An absent `plans.jsonl` is the normal starting state and exits `0` with no rows. Use
`--as-of YYYY-MM-DD` to ask what the file said on a prior date.

### 5b. Durability, confirmed by observation

A warning about a discarded file is exactly the thing nobody sees, so confirm durability
by looking at what git actually holds. After the next daily run (or after committing the
file yourself in the `<fund>` checkout):

```sh
git -C ~/Dev/<fund> log -- data/plans.jsonl
```

A commit must be listed. If the log is empty while the file is on disk with content, the
allowlist is discarding it — go back to section 0, fix the `.gitignore` entry, and commit
again. Nothing else on this page is worth anything until that log has an entry in it.

## Notes

- `pnpm plans` is standalone, and never writes what you authored. It never writes the
  sidecar and never touches git, and a plans failure never kills the NAV fold or
  withholds a push — the fold does not read this file at all. It is not, however, write-
  free: reading the fold maintains the event log's `events.jsonl.quarantine` lane (see
  the write-on-read invariant in `packages/event-store/README.md`). That lane is
  gitignored and belongs to the log, not to your plans; it is named here only so a
  vanished breadcrumb after a `pnpm plans` run is not a mystery.
- The plan **bodies** are provisional (they are parked on the fills export); the
  **envelope** is not. If a body shape changes later, the repair path is the file's own
  mechanism: supersede with a new line.
- Do not hand-edit `plans.jsonl` to "clean it up". Every line in it is a statement about
  what you intended on a date, and the file is only as trustworthy as its append-only
  discipline.
