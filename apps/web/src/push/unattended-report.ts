/**
 * THE UNATTENDED RUN'S OPERATOR CHANNEL (spec #320 seams C/D) — the place prose about
 * a run goes, as distinct from the projection payload, which is the fund's view rather
 * than the operator's. Nothing here ever reaches the wire.
 *
 * IT IS CO-TENANTED BY DESIGN, AND THAT IS WHY IT IS A COLLECTOR RATHER THAN A STRING.
 * The preferences discard report is the first tenant, not the only one: a run has more
 * than one thing that can go quietly wrong, and each of them is a KIND. Every line
 * enters under its kind and stays under it, which buys the two properties a shared
 * channel needs:
 *
 *  - **Reserved capacity.** PR #322's lesson, learned on the TUI's seven-line gap
 *    channel: a bounded surface that slices a CONCATENATION withholds whichever kind
 *    sorts last, and once a transient, recurring kind alone fills the bound, a
 *    permanent finding is starved out forever. Bounding is therefore PER KIND
 *    ({@link MAX_LINES_PER_KIND}), so no kind can take the whole budget and none can
 *    be starved by a co-tenant. The reserving requires the kinds to arrive separately;
 *    that is the whole reason `add` takes one.
 *  - **Dedup within a kind, once per RUN.** The backfill derives a glance per anchor
 *    and re-reads every sidecar on each one, so a naive report prints the same finding
 *    once per backfilled day. Identical prose from the same kind collapses to one
 *    line. For a preferences discard the prose is a pure function of `(line, reason)`
 *    — `detail` is a pure function of `reason` — so collapsing by text can never merge
 *    two genuinely different discards.
 *
 * IT DOES NOT DECIDE EXIT CODES, and must not grow the ability. Kinds sharing this
 * channel do NOT share an exit policy: a discarded policy line marks the run non-zero
 * (an unread stderr log is not a report), while a diagnostic that points into an
 * append-only log and can never extinguish is prose-only and exits zero. A collector
 * that also summed exit codes would force one policy on every tenant. Each caller
 * composes prose here and exit codes beside it, from the same per-kind verdict.
 */

/**
 * Per-kind line budget. Generous — this is stderr, not a phone screen — and it exists
 * for the pathological sidecar, where thousands of discards from one kind would bury
 * every other kind's single, permanent finding.
 */
export const MAX_LINES_PER_KIND = 20;

/** The run's operator channel: prose, grouped by kind, deduped within each kind. */
export class RunReport {
  /** Insertion-ordered by kind, and by first appearance within a kind. */
  readonly #byKind = new Map<string, string[]>();

  /**
   * File `messages` under `kind`. Repeats of a line already filed under that kind are
   * dropped; a kind with nothing to say files nothing and leaves no trace.
   */
  add(kind: string, messages: readonly string[]): void {
    if (messages.length === 0) {
      return;
    }
    const lines = this.#byKind.get(kind) ?? [];
    for (const message of messages) {
      if (!lines.includes(message)) {
        lines.push(message);
      }
    }
    this.#byKind.set(kind, lines);
  }

  /** Every distinct line filed under `kind`, in first-appearance order. Unbounded. */
  linesFor(kind: string): string[] {
    return [...(this.#byKind.get(kind) ?? [])];
  }

  /** True when no kind has filed anything — the clean run. */
  get isEmpty(): boolean {
    return this.#byKind.size === 0;
  }

  /**
   * The channel rendered for a BOUNDED surface: each kind's lines up to `perKindLimit`,
   * and, when a kind was truncated, one further line saying so under its own name. The
   * truncation notice is what keeps a bound from reading as an all-clear.
   */
  lines(perKindLimit: number = MAX_LINES_PER_KIND): string[] {
    const rendered: string[] = [];
    for (const [kind, kindLines] of this.#byKind) {
      rendered.push(...kindLines.slice(0, perKindLimit));
      const withheld = kindLines.length - perKindLimit;
      if (withheld > 0) {
        rendered.push(
          `${kind}: ${withheld} further diagnostic(s) not shown (per-kind cap ${perKindLimit}).`,
        );
      }
    }
    return rendered;
  }

  /**
   * Write the channel to `sink`, one call per line. Call it ONCE, at the end of a run
   * and after whatever output the run exists to produce has landed — that ordering is
   * the Discard Channel's fifth clause and is asserted at the call site, not here.
   */
  emit(sink: (line: string) => void, perKindLimit: number = MAX_LINES_PER_KIND): void {
    for (const line of this.lines(perKindLimit)) {
      sink(line);
    }
  }
}
