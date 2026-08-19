// The ONE pure resolver for the durable ledger's data root, shared by every
// runtime plane (the tui event-store, the price-feed config, the preferences
// sidecar). It was byte-identical duplicated across `event-store.ts` and
// `config.ts` — the exact duplication ADR-001's realized note (#58) celebrated
// removing with a contract test — so it lives here as the single copy.
//
// It also holds the ONE implementation of the rule itself
// (`normalizeDataDirOverride`), which the four caller-supplied data-dir doors in
// the other packages route through. #369 filed those four for having four
// hand-written copies of one contract that had already drifted apart on two of
// its four inputs.
//
// This is pure string/env computation: `homedir()` reads a process-derived value
// (like `$HOME`) and the `node:path` helpers are pure — no fs, no clock, no IO —
// so it belongs in the engine alongside `INBOX_PATH_SEGMENTS` /
// `PRICE_STORE_DIR_SEGMENT` without violating ADR-001's IO boundary.
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

/**
 * The durable log's default home: the sibling private `accumulus` repo's `data/`.
 * Per the grill decision (the durable log lives in the sibling `accumulus` repo,
 * not the numisma checkout), the DEFAULT data root is `~/Dev/accumulus/data`,
 * derived from `os.homedir()` — ABSOLUTE and homedir-derived, NEVER a hardcoded
 * `/Users/...` literal and NEVER a CWD-relative `"data"`.
 */
function accumulusDataDirDefault(): string {
  return join(homedir(), "Dev", "accumulus", "data");
}

/**
 * The wording each door uses when it refuses a value. The RULE is shared and lives in
 * `normalizeDataDirOverride` below; only the VOICE is per-door, because the cost of the
 * mistake genuinely differs by door and #348 deliberately spent that difference — the
 * preferences resolver names a Reserve floor served from a file nothing writes, the
 * event-store resolver names a SECOND genesis seeded beside the job's CWD. An operator
 * reading either message has to be able to tell which artifact is at stake, so the
 * message is parameterised and the predicate is not.
 */
export interface DataDirVoice {
  /**
   * How this door names the knob when it refuses a RELATIVE value: `NUMISMA_DATA_DIR`,
   * `a sidecar data directory`.
   */
  subject: string;
  /** The BLANK refusal's opening clause, in this door's own voice. */
  blankHeadline: string;
  /** What silently accepting a blank would have cost HERE, in this door's own terms. */
  blankConsequence: string;
  /**
   * How the caller deliberately reaches the default instead — omitted by the one door
   * (`resolvePriceFeedPaths`) whose `dataDir` is REQUIRED and therefore has no
   * `undefined` → default arm to point at.
   */
  blankRemedy?: string;
}

/**
 * The ONE implementation of ADR-006's `dataDir` rule, applied to a value that is
 * PRESENT. Five doors take a data root — the `NUMISMA_DATA_DIR` env knob and four
 * caller-supplied arguments — and #369 filed them for disagreeing about two of the
 * four inputs. They now disagree about none, because there is one predicate.
 *
 * The table, whole:
 *
 *   | input                  | outcome                                      |
 *   | ---------------------- | -------------------------------------------- |
 *   | `undefined`            | the door's own default (NOT this function)    |
 *   | `""` / whitespace-only | THROW — misconfigured, not absent (#348)      |
 *   | `~` or `~/…`           | expand against `homedir()`, then `resolve()`  |
 *   | an absolute path       | `resolve()`                                   |
 *   | a relative path        | THROW — CWD-dependent, split-brain (#369)     |
 *
 * `undefined` is deliberately NOT handled here: the five doors have genuinely different
 * defaults (the engine's is the accumulus root; the sidecar/store doors' is
 * `resolveDataDir()`; price-feed's argument is required and has no default at all), and
 * folding that difference in would mean a parameter whose value varies per door — which
 * is the drift seam this function exists to close, rebuilt one level up. Each door keeps
 * its own `undefined` arm and routes every PRESENT value through here.
 *
 * WHY `~` EXPANDS AT EVERY DOOR AND NOT ONLY AT THE ENV KNOB (#369's ruling). The hazard
 * the rule guards is CWD-DEPENDENCE, and `~/scratch` has none: it is absolute and
 * homedir-derived, verbatim the invariant ADR-006 states. The counter-argument — `~` is a
 * shell affordance, `node:path` has no notion of it, so a TypeScript caller writing it is
 * likelier confused than deliberate — is real but loses, for two reasons. First, the
 * argument boundary is not purely programmatic: `resolvePriceFeedPaths(config.dataDir)`
 * is fed a value that ORIGINATED as `NUMISMA_DATA_DIR` in a launchd plist, which cannot
 * expand `~` itself (ADR-006); it arrives pre-expanded today only because of the order
 * the plumbing happens to run in, not because of any contract. Second, and decisively:
 * an env-only tilde rule would need an `allowTilde` flag here, making one function carry
 * two behaviours and splitting the contract table into a column that varies per door.
 * That is #369's defect rebuilt inside #369's fix.
 *
 * Before this, `~/scratch` at the three permissive doors produced
 * `<cwd>/~/scratch` — a directory literally NAMED `~`, beside wherever the process
 * started. No door wanted that arm; it was what "call `resolve()` and hope" happened
 * to do.
 *
 * WHAT THE TRIM RETARGETS, AND WHY THAT IS NOT A REFUSAL. The `trim()` is not only the
 * blank predicate's input — the trimmed string is what gets resolved, so surrounding
 * whitespace is stripped from every accepted value too. At the env knob that has always
 * been true; at the four ARGUMENT doors it is new reach, and it changes one pathological
 * but legal case rather than rejecting it: `resolveEventStorePaths("/tmp/a b ")` used to
 * yield `/tmp/a b /events.jsonl` — a SIBLING directory whose name ends in a space, beside
 * the one the caller plainly meant — and now yields `/tmp/a b/events.jsonl`. The value is
 * RETARGETED, not refused, and that is the right call for the same reason the rest of
 * this function exists: a trailing-space directory is never what a caller or a launchd
 * plist intends, the env knob already silently landed on the intended root, and a door
 * that refused a value the knob accepts would be a fifth disagreement in the very
 * function written to leave none. Interior whitespace is untouched — `/tmp/a b` is a real
 * macOS path and stays one.
 *
 * Expansion is `os.homedir()` at RUNTIME. Never a `/Users/...` literal, in this file or
 * in any test that pins it — ADR-006 forbids the literal, and a committed one would leak
 * the operator's real directory layout into a public repo.
 */
export function normalizeDataDirOverride(raw: string, voice: DataDirVoice): string {
  const trimmed = raw.trim();
  if (trimmed === "") {
    const remedy =
      voice.blankRemedy === undefined
        ? "Pass an absolute path."
        : `${voice.blankRemedy}, or pass an absolute path.`;
    throw new Error(
      `${voice.blankHeadline} (got "${raw}"). ` +
        `An empty value is not "unset": ${voice.blankConsequence} ${remedy}`,
    );
  }
  if (trimmed === "~" || trimmed.startsWith("~/")) {
    return resolve(join(homedir(), trimmed.slice(1)));
  }
  if (!isAbsolute(trimmed)) {
    throw new Error(
      `${voice.subject} must be an absolute path or start with "~/" (got "${trimmed}"). ` +
        `A relative value resolves differently depending on the working directory, ` +
        `so it is rejected to prevent a split-brain ledger.`,
    );
  }
  return resolve(trimmed);
}

/**
 * Resolve the durable ledger's data root, honoring the `NUMISMA_DATA_DIR` env var —
 * the SINGLE knob that moves EVERY plane (the tui event-store, the price-feed
 * config, and the preferences sidecar), so one override steers them all and no
 * plane can drift onto a divergent ghost ledger.
 *
 * The `undefined` arm is this function's own: nobody configured the knob, so the
 * accumulus default is the answer. Every PRESENT value goes through the shared
 * `normalizeDataDirOverride` above — blank refused (#348), `~` expanded, absolute
 * normalized, relative refused (D6) — which is the same predicate the four
 * caller-supplied doors use, so the planes cannot drift apart on any input.
 *
 * `env` is injectable so callers (and the drift/contract test) can resolve against a
 * given environment without mutating the real `process.env`. price-feed reads at
 * import time and the tui reads per call; both are equivalent for a CLI process (D8).
 */
export function resolveDataDir(
  env: Record<string, string | undefined> = process.env,
): string {
  const fromEnv = env.NUMISMA_DATA_DIR;
  if (fromEnv === undefined) {
    return accumulusDataDirDefault();
  }
  return normalizeDataDirOverride(fromEnv, {
    subject: "NUMISMA_DATA_DIR",
    blankHeadline: "NUMISMA_DATA_DIR is set to an empty value",
    blankConsequence:
      "accepting it would silently send every write to the REAL default ledger " +
      "instead of the store this deployment meant to configure.",
    blankRemedy: "Unset NUMISMA_DATA_DIR to choose the default deliberately",
  });
}
